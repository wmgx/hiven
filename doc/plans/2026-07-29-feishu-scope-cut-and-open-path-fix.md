# 飞书插件范围收敛与打开路径修复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 逐任务实施，每个 Task 内的 Step 按顺序执行，用 checkbox (`- [ ]`) 跟踪。本文假定执行者对本代码库零了解，所有路径、代码、命令均为可直接执行的完整内容。

**Goal:** 把飞书插件从「19 个命令各 60% 可靠」收敛为「8 个高频命令 + 一条 100% 可靠的打开路径」。

**Architecture:** 分两部分。Part B（打开路径）优先，因为它是当前唯一阻塞日常使用的问题：把不可测的 shell 投递逻辑拆成「纯决策函数 + 薄执行层」，消除重复投递。Part A（范围收敛）通过新增一个 `advancedToolsEnabled` 设置开关过滤命令数组，代码全部保留、默认关闭，随时可回退。

**Tech Stack:** TypeScript + React（插件层）、Tauri/Rust（host openUrl）、Node.js 原生断言脚本（测试，非 vitest）、`lark-cli`（外部 CLI 依赖）。

---

## 0. 执行前必读：这个项目的基本事实

执行者请先花 3 分钟读完本节，能避免 80% 的踩坑。

### 0.1 仓库与分支

- 仓库根目录：本仓库根目录
- 当前分支：`feat/launcher-intelligence-package-1`
- **不要在 `main` 上做实现。** 如果 `git branch --show-current` 显示 `main`，先创建分支。

### 0.2 飞书插件的结构

```text
src/plugins/feishu/
├── index.tsx                  # 插件入口：组装 settings / tools / hooks，不写业务逻辑
├── manifest.json              # 插件元数据 + 版本号（改行为必须升版本）
├── runtime.ts                 # 模块级绑定 shell / settings / openUrl / t，并按设置注册 L1 provider
├── tools.ts                   # 19 个 L2 命令的定义数组（1200+ 行）
├── settings/model.ts          # FeishuSettings 类型 + 默认值
├── settings/FeishuSettingsBody.tsx   # 设置面板 UI
├── domains/                   # 业务域：docs / im / calendar / contact / write / windowFocus / links …
├── provider/                  # L1 混排的三个 DesktopTargetProvider（docs / chats / contacts）
├── cli/                       # lark-cli 子进程封装与错误格式化
├── search/l1Cache.ts          # L1 多层缓存
└── locales/{zh,en}.json       # i18n 文案（173 个 key）
```

### 0.3 测试怎么跑（重要，这里和常规项目不一样）

**本项目没有 vitest / jest。** 测试是 Node 原生脚本，位于 `scripts/`，用 `node:assert/strict`。

飞书相关的两个测试脚本：

```bash
node scripts/test-feishu-cli-logic.mjs    # 纯逻辑契约：静态源码断言 + 可选 TS 转译执行
node scripts/test-feishu-plugin.mjs       # 插件契约：manifest / provider / locales / 目录结构
```

它们的工作方式有两种，你两种都会用到：

1. **静态源码断言**：`assert.match(读到的源码字符串, /正则/, '说明')`。用来锁定「某文件必须导出某函数」这类契约。
2. **TS 转译执行**（`scripts/test-feishu-cli-logic.mjs:331` 的 `tryRunPureHelpers`）：用 `typescript` 包把 `.ts` 转译成 `.mjs` 写进临时目录再动态 import，从而**真实调用函数验证行为**。

> ⚠️ **转译测试有一条硬约束**：`scripts/test-feishu-cli-logic.mjs:357` 会跳过任何含相对 import 的文件——
> ```js
> const hasRelativeImport = /from\s+['"]\.\.?\/[^'"]+['"]/.test(source)
> if (hasRelativeImport) continue
> ```
> 这就是 Task 1 要把纯决策逻辑抽到一个**没有任何相对 import 的新文件**的原因。放错地方，行为测试会被静默跳过，你会以为测试通过了其实根本没跑。

### 0.4 全量验证命令

每个 Task 结束前跑对应测试；全部完成后跑完整套：

```bash
node scripts/test-feishu-cli-logic.mjs
node scripts/test-feishu-plugin.mjs
npm run check:architecture
npm run build
```

`npm run lint` 可选：仓库存在历史 lint 问题，若报错需区分「历史问题」与「本次新增」，只对后者负责。

### 0.5 i18n 硬规则（违反会被拒收）

项目规则（`CLAUDE.md`）：**所有用户可见文案必须走 i18n，禁止硬编码中文/英文。**

新增任何用户可见文案，必须同时在两个文件加 key：
- `src/plugins/feishu/locales/zh.json`
- `src/plugins/feishu/locales/en.json`

两个文件的 key 必须完全一致（`scripts/test-feishu-plugin.mjs` 会校验）。

### 0.6 提交规范

格式 `<type>: <description>`，type 取 `feat|fix|refactor|docs|test|chore|perf`。
**不要加 Co-Authored-By 或任何 AI 署名**（项目已全局关闭署名）。

---

## Part B：打开路径修复（优先做，Task 1-3）

### 背景：为什么这是根因

`src/plugins/feishu/domains/windowFocus.ts` 的 `openFeishuClientOrUrl` 现有逻辑：

```js
const candidates = [
  `open ${shellQuote(url)}`,                                    // 候选 1
  `open -a ${shellQuote('/Applications/Lark.app')} ${shellQuote(url)}`,  // 候选 2
  `open -b com.electron.lark ${shellQuote(url)}`,               // 候选 3
]
let accepted = false
for (const command of candidates) {
  const result = await options.shell.run({ command, timeoutMs: 2500 })
  if (!result.timedOut && (result.exitCode === 0 || result.exitCode == null)) {
    accepted = true
    if (command.includes('Lark.app') || command.includes('com.electron.lark')) {
      return
    }
  }
}
```

三个缺陷，按严重度排序：

| # | 缺陷 | 后果 |
|---|------|------|
| B-1 | **候选 1 成功后不 return**，继续投递候选 2 → 同一 deep link 被投递 2 次 | 客户端二次处理 URL，可能把已跳转的会话窗口重置回默认页 → 表现为「有时跳转有时不跳转」 |
| B-2 | 用 `exitCode === 0` 当作「跳转成功」 | `open` 返回 0 只代表 LaunchServices 收下了 URL，不代表客户端内部完成路由。这是「必要非充分」条件，被当成充分条件用了 |
| B-3 | 硬编码 `/Applications/Lark.app` | 装的是「飞书」(`Feishu.app`)、或装在 `~/Applications` 的用户，候选 2 永远失败 |

**修复策略**：先修 B-1（确定是 bug、修复成本最低、最可能直接解决问题），同时用 B-3 的动态解析替掉硬编码。**不引入窗口轮询来验证 B-2**——那会给关键路径加 ~600ms 延迟，属于 YAGNI。B-2 保留为观察项：如果单次投递后仍有 no-op，用已有的 `feishu.debug-open` 命令收集日志再决策（见 §Part B 收尾）。

---

### Task 1: 抽出纯投递决策函数（TDD）

把「选哪个候选、投递后是否继续」的决策逻辑，从带副作用的 `openFeishuClientOrUrl` 里抽成纯函数，放进一个**无相对 import** 的新文件，使其可被转译测试真实调用。

**Files:**
- Create: `src/plugins/feishu/domains/openPlan.ts`
- Test: `scripts/test-feishu-cli-logic.mjs`（在 `tryRunPureHelpers` 的 candidates 中追加，并新增行为断言）

- [ ] **Step 1: 写失败的测试**

打开 `scripts/test-feishu-cli-logic.mjs`，找到 `async function tryRunPureHelpers() {` 内的 `const candidates = [` 数组（约 342 行），把 `'src/plugins/feishu/domains/openPlan.ts'` 加进去：

```js
  const candidates = [
    'src/plugins/feishu/cli/parse.ts',
    'src/plugins/feishu/cli/errors.ts',
    'src/plugins/feishu/cli/formatError.ts',
    'src/plugins/feishu/domains/docs.ts',
    'src/plugins/feishu/domains/openPlan.ts',
    'src/plugins/feishu/search/l1Cache.ts',
    'src/plugins/feishu/domains/icons.ts',
  ].filter((p) => existsSync(join(root, p)))
```

然后在同一函数内、`if (rel.endsWith('l1Cache.ts')) {` 那个 if 块**之前**，插入 openPlan 的行为断言：

```js
      // Behavioral checks for open plan (single-delivery contract)
      if (rel.endsWith('openPlan.ts')) {
        // 1) 客户端 scheme 识别
        assert.equal(mod.isClientScheme('lark://applink.feishu.cn/client/chat/open?openChatId=oc_1'), true, 'lark:// is client scheme')
        assert.equal(mod.isClientScheme('https://applink.feishu.cn/client/chat/open?openChatId=oc_1'), false, 'https is not client scheme')

        // 2) 候选顺序：解析到 app 路径时优先用它，且不含硬编码 /Applications/Lark.app
        const withApp = mod.buildDeliveryCandidates('lark://x/y', { appPath: '/Users/me/Applications/Feishu.app' })
        assert.ok(withApp.length >= 1, 'must produce at least one candidate')
        assert.match(withApp[0].command, /Feishu\.app/, 'resolved app path must be preferred first')
        assert.ok(
          !withApp.some((c) => c.command.includes('/Applications/Lark.app')),
          'must not hardcode /Applications/Lark.app when app path resolved',
        )

        // 3) 未解析到 app 路径时，回退候选仍可用
        const noApp = mod.buildDeliveryCandidates('lark://x/y', {})
        assert.ok(noApp.length >= 1, 'fallback candidates must exist without appPath')

        // 4) 核心契约：投递成功后必须停止，不得重复投递
        assert.equal(
          mod.shouldStopAfterDelivery({ exitCode: 0, timedOut: false }),
          true,
          'exit 0 must stop delivery loop (no double open)',
        )
        assert.equal(
          mod.shouldStopAfterDelivery({ exitCode: null, timedOut: false }),
          true,
          'null exit code must also stop (open returned without error)',
        )
        assert.equal(
          mod.shouldStopAfterDelivery({ exitCode: 1, timedOut: false }),
          false,
          'non-zero exit must fall through to next candidate',
        )
        assert.equal(
          mod.shouldStopAfterDelivery({ exitCode: 0, timedOut: true }),
          false,
          'timeout must not count as success even with exit 0',
        )

        // 5) https 链接不进客户端投递通道
        assert.deepEqual(
          mod.buildDeliveryCandidates('https://example.feishu.cn/docx/abc', {}),
          [],
          'https must produce no client candidates (host openUrl handles it)',
        )
      }
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
node scripts/test-feishu-cli-logic.mjs
```

Expected: **FAIL**。因为 `openPlan.ts` 还不存在，`candidates` 的 `.filter(existsSync)` 会把它滤掉，断言块不执行——所以这一步你会看到**测试通过但断言没跑**。

为确认测试真的在跑，临时把 filter 那行的 `.filter((p) => existsSync(join(root, p)))` 改成 `.filter((p) => { const ok = existsSync(join(root, p)); if (!ok) throw new Error('missing candidate: ' + p); return ok })`，重跑，应看到：

```
Error: missing candidate: src/plugins/feishu/domains/openPlan.ts
```

确认后**把 filter 改回原样**（保留 `existsSync` 过滤，这是脚本原有的容错设计）。

- [ ] **Step 3: 写最小实现**

创建 `src/plugins/feishu/domains/openPlan.ts`。**注意：此文件禁止出现任何相对 import**（`from './x'` 或 `from '../x'`），否则转译测试会跳过它。所有类型就地定义。

```ts
/**
 * Pure decision layer for Feishu deep-link delivery.
 *
 * Split out of windowFocus.ts so the "which command, and when to stop"
 * decisions are testable without spawning shells.
 *
 * IMPORTANT: this file must stay free of relative imports — the contract test
 * (scripts/test-feishu-cli-logic.mjs) skips transpiling any file that has them.
 */

/** Result shape we care about from a shell command run. */
export type DeliveryOutcome = {
  exitCode?: number | null
  timedOut?: boolean
}

/** One delivery attempt: a shell command plus why we chose it. */
export type DeliveryCandidate = {
  command: string
  /** Diagnostic label surfaced in [feishu:open] logs. */
  reason: 'resolved-app' | 'launch-services' | 'bundle-id'
}

export type DeliveryOptions = {
  /** Absolute path to the installed Feishu/Lark .app, when resolvable. */
  appPath?: string
  /** Bundle identifier fallback. */
  bundleId?: string
}

const DEFAULT_BUNDLE_ID = 'com.electron.lark'

/** True if URL uses a Feishu/Lark native client scheme. */
export function isClientScheme(url: string): boolean {
  return /^(lark|feishu|x-feishu|x-lark):\/\//i.test(url.trim())
}

/** POSIX-safe single-quoting for shell arguments. */
export function shellQuote(arg: string): string {
  if (arg.length === 0) return "''"
  if (/^[a-zA-Z0-9_./:=+@%,-]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

/**
 * Build the ordered delivery attempts for a client-scheme URL.
 *
 * Order matters: the most specific target goes first so the deep link is
 * handed to the exact installed client instead of whatever LaunchServices
 * happens to have registered (a BOE / staging build can otherwise swallow it).
 *
 * Non-client URLs return [] — https is the host openUrl's job.
 */
export function buildDeliveryCandidates(
  url: string,
  options: DeliveryOptions,
): DeliveryCandidate[] {
  const target = url.trim()
  if (!target || !isClientScheme(target)) return []

  const candidates: DeliveryCandidate[] = []
  const quotedUrl = shellQuote(target)

  const appPath = options.appPath?.trim()
  if (appPath) {
    candidates.push({
      command: `open -a ${shellQuote(appPath)} ${quotedUrl}`,
      reason: 'resolved-app',
    })
  }

  candidates.push({
    command: `open ${quotedUrl}`,
    reason: 'launch-services',
  })

  candidates.push({
    command: `open -b ${shellQuote(options.bundleId?.trim() || DEFAULT_BUNDLE_ID)} ${quotedUrl}`,
    reason: 'bundle-id',
  })

  return candidates
}

/**
 * Whether delivery succeeded and the loop must stop.
 *
 * Deliberately stops on the FIRST accepted attempt. Delivering the same deep
 * link twice makes the client re-handle the URL, which can reset an
 * already-navigated window back to its default page — the root cause of the
 * intermittent "opened but did not jump" behaviour.
 *
 * Note: exit 0 only proves LaunchServices accepted the URL, not that the
 * client finished routing. It is the strongest signal available without
 * polling window titles, and polling would add latency to the critical path.
 */
export function shouldStopAfterDelivery(outcome: DeliveryOutcome): boolean {
  if (outcome.timedOut) return false
  const code = outcome.exitCode
  return code === 0 || code === null || code === undefined
}
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
node scripts/test-feishu-cli-logic.mjs
```

Expected: **PASS**，输出末尾应有脚本原有的成功日志，且不再有 `missing candidate` 报错。

- [ ] **Step 5: 提交**

```bash
git add src/plugins/feishu/domains/openPlan.ts scripts/test-feishu-cli-logic.mjs
git commit -m "refactor(feishu): extract pure delivery plan with single-delivery contract"
```

---

### Task 2: 解析真实客户端路径，替换硬编码

`/Applications/Lark.app` 是硬编码，装「飞书」或装在别处的用户永远命中不到。改为运行时解析一次并缓存。

**Files:**
- Modify: `src/plugins/feishu/domains/windowFocus.ts`（新增解析函数，导出供测试断言）
- Test: `scripts/test-feishu-cli-logic.mjs`（静态断言）

- [ ] **Step 1: 写失败的测试**

在 `scripts/test-feishu-cli-logic.mjs` 中，找到已有的静态断言区（文件中部，形如 `assert.match(runSrc, /.../, '...')` 的连续块），在其后追加：

```js
// --- open path: no hardcoded app path, single delivery ---
const windowFocusSrc = read('src/plugins/feishu/domains/windowFocus.ts')
assert.ok(
  !windowFocusSrc.includes('/Applications/Lark.app'),
  'windowFocus must not hardcode /Applications/Lark.app; resolve the installed client instead',
)
assert.match(
  windowFocusSrc,
  /resolveFeishuAppPath/,
  'windowFocus must resolve the installed Feishu/Lark app path at runtime',
)
assert.match(
  windowFocusSrc,
  /buildDeliveryCandidates|shouldStopAfterDelivery/,
  'windowFocus must delegate delivery decisions to openPlan',
)
assert.ok(
  existsSync(join(root, 'src/plugins/feishu/domains/openPlan.ts')),
  'openPlan.ts must exist',
)
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
node scripts/test-feishu-cli-logic.mjs
```

Expected: **FAIL**，报错信息为：
```
AssertionError: windowFocus must not hardcode /Applications/Lark.app; resolve the installed client instead
```

- [ ] **Step 3: 写最小实现**

编辑 `src/plugins/feishu/domains/windowFocus.ts`。

**3a.** 在文件顶部的 import 区（`import type { LarkCliShell } from '../cli/run'` 那行之后）加入：

```ts
import {
  buildDeliveryCandidates,
  isClientScheme,
  shouldStopAfterDelivery,
} from './openPlan'
```

**3b.** 在 `FEISHU_WINDOW_APP_NAMES` 常量定义之后，加入解析逻辑：

```ts
/** Bundle ids that may own the Feishu / Lark desktop client. */
const FEISHU_BUNDLE_IDS = [
  'com.electron.lark',
  'com.bytedance.ee.lark',
  'com.larksuite.desktop',
] as const

/** Cached resolution so we spawn `mdfind` at most once per session. */
let resolvedAppPath: string | null | undefined

/**
 * Resolve the installed Feishu / Lark .app path.
 *
 * Returns undefined when nothing resolves, in which case delivery falls back
 * to plain LaunchServices + bundle id. Never throws.
 */
export async function resolveFeishuAppPath(shell: LarkCliShell): Promise<string | undefined> {
  if (resolvedAppPath !== undefined) return resolvedAppPath ?? undefined

  for (const bundleId of FEISHU_BUNDLE_IDS) {
    try {
      // No pipes / redirects: LarkCliShell.run only guarantees a command string,
      // not a full shell. Take the first line in JS instead.
      const result = await shell.run({
        command: `mdfind kMDItemCFBundleIdentifier=${bundleId}`,
        timeoutMs: 1500,
      })
      const path = (result.stdout ?? '')
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.endsWith('.app'))
      if (path) {
        logFeishuOpen('resolveApp:hit', { bundleId, path })
        resolvedAppPath = path
        return path
      }
    } catch {
      // try next bundle id
    }
  }

  logFeishuOpen('resolveApp:miss', { tried: FEISHU_BUNDLE_IDS.length })
  resolvedAppPath = null
  return undefined
}

/** Test seam: drop the cached app path so the next open re-resolves. */
export function resetFeishuAppPathCache(): void {
  resolvedAppPath = undefined
}
```

**3c.** 把 `openFeishuClientOrUrl` 函数**整体替换**为下面的版本（保留原有的日志 step 名，便于对照历史日志）：

```ts
async function openFeishuClientOrUrl(options: {
  shell?: LarkCliShell | null
  openUrl?: ((url: string) => Promise<void>) | null
  url: string
}): Promise<void> {
  const url = options.url.trim()
  if (!url) {
    logFeishuOpen('openFeishuClientOrUrl:empty-url')
    return
  }
  const isClient = isClientScheme(url)
  logFeishuOpen('openFeishuClientOrUrl:dispatch', {
    url,
    isClient,
    hasShell: Boolean(options.shell),
    hasOpenUrl: Boolean(options.openUrl),
  })

  // Client schemes: deliver via shell so the deep link reaches the desktop
  // client. Host openUrl is a generic OS open and may only activate the app.
  if (isClient && options.shell) {
    const appPath = await resolveFeishuAppPath(options.shell)
    const candidates = buildDeliveryCandidates(url, { appPath })

    for (const candidate of candidates) {
      try {
        logFeishuOpen('shell.run:try', { command: candidate.command, reason: candidate.reason })
        const result = await options.shell.run({
          command: candidate.command,
          timeoutMs: 2500,
        })
        logFeishuOpen('shell.run:result', {
          command: candidate.command,
          reason: candidate.reason,
          exitCode: result.exitCode ?? null,
          timedOut: Boolean(result.timedOut),
          stdout: (result.stdout ?? '').slice(0, 200),
          stderr: (result.stderr ?? '').slice(0, 200),
        })

        // Stop on first success: delivering the same deep link twice makes the
        // client re-handle the URL and can reset an already-navigated window.
        if (shouldStopAfterDelivery(result)) {
          logFeishuOpen('shell.run:accepted', {
            command: candidate.command,
            reason: candidate.reason,
          })
          return
        }
      } catch (error) {
        logFeishuOpen('shell.run:throw', {
          command: candidate.command,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    logFeishuOpen('shell.run:all-failed', { url, candidateCount: candidates.length })
  } else if (isClient && !options.shell) {
    logFeishuOpen('shell.missing-for-client-scheme', { url })
  }

  // Host openUrl: registered custom schemes → open_system_url; https → shell.open.
  if (options.openUrl) {
    try {
      logFeishuOpen('host.openUrl:try', { url })
      await options.openUrl(url)
      logFeishuOpen('host.openUrl:ok', { url })
      return
    } catch (error) {
      logFeishuOpen('host.openUrl:error', {
        url,
        message: error instanceof Error ? error.message : String(error),
      })
      if (!isClient) throw error
    }
  }

  logFeishuOpen('abort:no-openUrl-no-shell', { url })
  throw new Error('No openUrl / shell available to open Feishu link')
}
```

**3d.** 消除本次改动引入的重复。

`openPlan.ts` 现在导出了 `shellQuote`，而 `windowFocus.ts` 文件底部本来就有一份同名的私有实现（两者逻辑完全相同）。既然 `windowFocus.ts` 已经 import 了 `openPlan`，复用是零成本的。

先确认剩余使用点：

```bash
grep -n "shellQuote" src/plugins/feishu/domains/windowFocus.ts
```

替换后应只剩 `tryFocusFeishuWindowByTitle` 中 osascript 那一处调用。操作：

1. 把 3a 的 import 补上 `shellQuote`：

```ts
import {
  buildDeliveryCandidates,
  isClientScheme,
  shellQuote,
  shouldStopAfterDelivery,
} from './openPlan'
```

2. **删除** `windowFocus.ts` 文件底部的私有实现：

```ts
function shellQuote(arg: string): string {
  if (arg.length === 0) return "''"
  if (/^[a-zA-Z0-9_./:=+@%,-]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, `'\\''`)}'`
}
```

> 只删这一个函数。`src/plugins/feishu/cli/run.ts` 里还有一份 `shellQuote`——**不要动它**，那是 CLI 层的独立关注点，与本次改动无关（项目规则：不清理不是自己造成的重复）。

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
node scripts/test-feishu-cli-logic.mjs && npm run build
```

Expected: 测试 PASS；`npm run build` 成功，无 TypeScript 报错。

- [ ] **Step 5: 提交**

```bash
git add src/plugins/feishu/domains/windowFocus.ts scripts/test-feishu-cli-logic.mjs
git commit -m "fix(feishu): deliver deep link once and resolve real client path"
```

---

### Task 3: 手工验证打开路径

代码改完必须真机验证——这是整个方案的验收点，**不能只看构建通过**。

**Files:** 无代码改动（仅验证；如发现问题回到 Task 2 调整）

- [ ] **Step 1: 启动应用**

```bash
npm run dev
```

另开终端启动桌面壳（若项目用 tauri dev，按仓库既有方式启动；`npm run dev` 已足够验证 launcher 时可跳过）。

- [ ] **Step 2: 清空日志并执行一次打开**

1. 唤起 Global Launcher
2. 运行命令 `feishu.debug-open`（在 launcher 输入 `debug` 可找到），先执行其清空日志的动作
3. 输入一个会话名，回车打开
4. 再次运行 `feishu.debug-open`，查看日志输出

- [ ] **Step 3: 核对日志，确认单次投递**

日志中 `shell.run:try` **必须只出现一次**，紧跟一条 `shell.run:accepted`。

✅ 正确：
```
shell.run:try {"command":"open -a '/Applications/Feishu.app' 'lark://…'","reason":"resolved-app"}
shell.run:result {"exitCode":0,"timedOut":false,…}
shell.run:accepted {"command":"open -a …","reason":"resolved-app"}
```

❌ 错误（说明 Task 2 没生效）：出现两条及以上 `shell.run:try`。

同时确认有一条 `resolveApp:hit`，且 `path` 是你机器上真实的客户端路径。

- [ ] **Step 4: 重复 10 次一致性测试**

连续打开 10 个不同会话，记录成功跳转次数。

- **10/10 成功** → Part B 完成，进入 Part A。
- **仍有失败** → 说明 B-2（exitCode 不足以判定跳转）是真实存在的，**停止**，把 `debug-open` 日志贴出来讨论下一步。此时可选方案是投递后轮询窗口标题验证，但那要加延迟，需要先确认值得。**不要自行加轮询**。

- [ ] **Step 5: 提交验证结论**

把结果记录进回归清单（Task 7 会统一更新），本步无需单独提交。

---

## Part A：范围收敛（Task 4-6）

### 设计说明

保留 6 个高频命令 + 2 个运维命令，其余默认关闭。

| 保留（默认可见） | 关闭（默认隐藏，设置里可开） |
|---|---|
| `feishu.docs-search` 搜文档 | `feishu.create-event` 建日程 |
| `feishu.chat-search` 搜会话 | `feishu.send-message` 发消息 |
| `feishu.contact-search` 找人 | `feishu.docs-fetch` 取文档正文 |
| `feishu.calendar-agenda` 看日程 | `feishu.messages-search` 搜消息 |
| `feishu.create-doc` 建文档 | `feishu.chat-list` 会话列表 |
| `feishu.create-sheet` 建表格 | `feishu.calendar-search` 搜日程 |
| `feishu.status` 状态（运维） | `feishu.my-tasks` 我的任务 |
| `feishu.login` 登录（运维） | `feishu.minutes-search` 搜妙记 |
| | `feishu.debug-open` 打开诊断 |

**代码全部保留**，只做运行时过滤——随时可通过一个开关全量恢复，零风险。

**关于保留两个写命令的判断依据**（避免执行者误以为是遗漏）：

保留标准不是「读 vs 写」，而是「是否需要切换上下文才能完成」。
`create-doc` / `create-sheet` 是**一次性动作**，敲一下就拿到链接，且 `src/plugins/feishu/tools.ts:722` 会把当前选区 / 输入（`ctx.input?.text`）直接作为文档正文——选中一段文字建文档，内容已经填好。这属于典型的「不离开当前工作」场景。

被关掉的 `send-message` 形式上同为写操作，但发完消息必然要看对方回复，注定要切到飞书，launcher 只是多绕一步。

两个 create 命令走 `ctx.output.choices()` 的 L2 确认流（`feishu.write:doc-confirm` / `feishu.write:sheet-confirm`），创建成功后调用 `openRuntimeUrl(created.url, …)` —— **与会话打开共用 `openFeishuTarget`**，因此 Part B 的单次投递修复同样惠及它们。

### Task 4: 新增 advancedToolsEnabled 设置与命令过滤（TDD）

**Files:**
- Modify: `src/plugins/feishu/settings/model.ts`
- Create: `src/plugins/feishu/toolVisibility.ts`
- Modify: `src/plugins/feishu/index.tsx`
- Test: `scripts/test-feishu-plugin.mjs`

- [ ] **Step 1: 写失败的测试**

在 `scripts/test-feishu-plugin.mjs` 末尾追加：

```js
// --- scope cut: core tools visible by default, advanced ones gated ---
const modelSrc = read(`${pluginDir}/settings/model.ts`)
assert.match(modelSrc, /advancedToolsEnabled/, 'settings model must declare advancedToolsEnabled')
assert.match(
  modelSrc,
  /advancedToolsEnabled:\s*false/,
  'advancedToolsEnabled must default to false (scope cut is the default experience)',
)

assert.ok(
  existsSync(join(root, `${pluginDir}/toolVisibility.ts`)),
  'toolVisibility.ts must exist to gate advanced tools',
)
const visibilitySrc = read(`${pluginDir}/toolVisibility.ts`)

for (const coreId of [
  'feishu.docs-search',
  'feishu.chat-search',
  'feishu.contact-search',
  'feishu.calendar-agenda',
  'feishu.create-doc',
  'feishu.create-sheet',
  'feishu.status',
  'feishu.login',
]) {
  assert.ok(
    visibilitySrc.includes(coreId),
    `${coreId} must be listed as a core tool`,
  )
}

// Commands that stay hidden by default must NOT leak into the core list.
for (const gatedId of ['feishu.send-message', 'feishu.my-tasks', 'feishu.debug-open']) {
  assert.ok(
    !visibilitySrc.includes(gatedId),
    `${gatedId} must stay gated behind advancedToolsEnabled`,
  )
}

const indexSrc = read(`${pluginDir}/index.tsx`)
assert.match(
  indexSrc,
  /selectVisibleFeishuTools|visibleFeishuTools/,
  'index.tsx must filter tools through the visibility helper, not pass feishuTools raw',
)

// locale keys for the new setting must exist in BOTH languages
const zh = JSON.parse(read(`${pluginDir}/locales/zh.json`))
const en = JSON.parse(read(`${pluginDir}/locales/en.json`))
for (const key of ['settings.advancedTools', 'settings.advancedToolsHint']) {
  assert.ok(zh[key], `zh.json must define ${key}`)
  assert.ok(en[key], `en.json must define ${key}`)
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:
```bash
node scripts/test-feishu-plugin.mjs
```

Expected: **FAIL**：
```
AssertionError: settings model must declare advancedToolsEnabled
```

- [ ] **Step 3: 写最小实现**

**3a.** 编辑 `src/plugins/feishu/settings/model.ts`，在 `binaryPath` 字段**之前**加入新字段：

```ts
  /**
   * Show the full 19-tool surface (writes, fetch, tasks, minutes, debug).
   * Default false: the launcher only carries the high-frequency read commands.
   */
  advancedToolsEnabled: boolean
```

并在 `DEFAULT_FEISHU_SETTINGS` 中加入对应默认值（放在 `binaryPath` 之前保持顺序一致）：

```ts
  advancedToolsEnabled: false,
```

**3b.** 创建 `src/plugins/feishu/toolVisibility.ts`：

```ts
/**
 * Which Feishu tools the launcher surfaces by default.
 *
 * The plugin ships 19 tools, but only a few earn their place in the launcher.
 * The bar is not read-vs-write — it is whether the command completes WITHOUT
 * switching context. Searching for a doc and creating one both qualify:
 * you stay where you are and walk away with a link. Sending a message does
 * not: you will have to switch to Feishu to read the reply anyway.
 *
 * Everything else stays shipped but off by default.
 */

/** Tools always available: high-frequency actions plus the two ops commands. */
export const CORE_FEISHU_TOOL_IDS: readonly string[] = [
  'feishu.status',
  'feishu.login',
  'feishu.docs-search',
  'feishu.chat-search',
  'feishu.contact-search',
  'feishu.calendar-agenda',
  'feishu.create-doc',
  'feishu.create-sheet',
]

/** Filter a tool list down to what should be visible for the given settings. */
export function selectVisibleFeishuTools<T extends { id: string }>(
  tools: readonly T[],
  options: { advancedToolsEnabled?: boolean },
): T[] {
  if (options.advancedToolsEnabled) return [...tools]
  const core = new Set(CORE_FEISHU_TOOL_IDS)
  return tools.filter((tool) => core.has(tool.id))
}
```

**3c.** 编辑 `src/plugins/feishu/index.tsx`：

在 import 区加入（放在 `import { feishuTools } from './tools'` 之后）：

```ts
import { selectVisibleFeishuTools } from './toolVisibility'
```

把 `tools: feishuTools,` 这一行改为：

```ts
  tools: feishuTools,
  toolsFor: (settings: FeishuSettings) =>
    selectVisibleFeishuTools(feishuTools, {
      advancedToolsEnabled: settings?.advancedToolsEnabled === true,
    }),
```

> ⚠️ **执行者注意**：`definePlugin` 是否支持 `toolsFor` 回调，取决于宿主的插件契约。**先确认**：
> ```bash
> grep -rn "toolsFor\|tools:" src/workspace/pluginTypes.ts src/pluginHostSdk.ts | head -20
> ```
> - 如果 `PluginDefinition` **支持**按设置动态解析 tools（存在 `toolsFor` 或等价回调），用上面的写法。
> - 如果**不支持**（`tools` 只接受静态数组），改为在模块加载期无法读设置的情况下，退而在 `hooks.startup` 与 `settings.onChange` 中重新注册。此时**停下来**，把 `grep` 结果贴出来讨论——不要自行发明宿主 API，那会违反项目的插件边界规则（插件不得直接依赖 host 私有实现）。

**3d.** 补 i18n key。编辑 `src/plugins/feishu/locales/zh.json`，在 `settings.binaryPath` 之前加入：

```json
  "settings.advancedTools": "显示全部飞书命令",
  "settings.advancedToolsHint": "默认保留搜文档 / 搜会话 / 找人 / 看日程 / 建文档 / 建表格。开启后会显示发消息、搜妙记、我的任务等全部命令。",
```

编辑 `src/plugins/feishu/locales/en.json`，同位置加入：

```json
  "settings.advancedTools": "Show all Feishu commands",
  "settings.advancedToolsHint": "Defaults to docs / chats / people / agenda search plus doc and sheet creation. Enable to surface messaging, minutes, tasks and the rest.",
```

- [ ] **Step 4: 运行测试确认通过**

Run:
```bash
node scripts/test-feishu-plugin.mjs && npm run build
```

Expected: 测试 PASS，构建成功。

- [ ] **Step 5: 提交**

```bash
git add src/plugins/feishu/settings/model.ts src/plugins/feishu/toolVisibility.ts src/plugins/feishu/index.tsx src/plugins/feishu/locales scripts/test-feishu-plugin.mjs
git commit -m "feat(feishu): gate advanced tools behind a setting, keep 4 core reads"
```

---

### Task 5: 设置面板加入开关

**Files:**
- Modify: `src/plugins/feishu/settings/FeishuSettingsBody.tsx`

- [ ] **Step 1: 理解本文件的文案辅助函数**

该文件有一个本地 `label` 辅助函数（`src/plugins/feishu/settings/FeishuSettingsBody.tsx:29`）：

```ts
const label = (key: string, en: string, zhText: string) => {
  try {
    const translated = t(key)
    if (translated && translated !== key) return translated
  } catch {
    // ignore
  }
  return zh ? zhText : en
}
```

**三个参数**：i18n key、英文兜底、中文兜底。优先走 `t(key)`，locale 缺失时才用兜底。新增文案必须用这个函数，不能直接写字符串。

- [ ] **Step 2: 加入新开关**

定位 `preferWindowFocus` 那个 checkbox 的 `</label>` 结束标签，在它**之后**插入下面这段完整 JSX（结构与该文件既有开关完全一致，勿改样式值）：

```tsx
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <ui.Checkbox
            checked={value.advancedToolsEnabled === true}
            onChange={(event: { target: { checked: boolean } }) => {
              setValue({ ...value, advancedToolsEnabled: event.target.checked })
            }}
          />
          {label(
            'settings.advancedTools',
            'Show all Feishu commands',
            '显示全部飞书命令',
          )}
        </label>
        <ui.Text style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.45 }}>
          {label(
            'settings.advancedToolsHint',
            'Defaults to docs / chats / people / agenda search plus doc and sheet creation. Enable to surface messaging, minutes, tasks and the rest.',
            '默认保留搜文档 / 搜会话 / 找人 / 看日程 / 建文档 / 建表格。开启后会显示发消息、搜妙记、我的任务等全部命令。',
          )}
        </ui.Text>
```

> ⚠️ **注意取值方向**：这里用 `=== true`，而相邻开关用的是 `!== false`。因为本开关**默认关闭**，其它开关默认开启。写成 `!== false` 会导致默认全部命令可见，直接破坏本方案的核心目的。

- [ ] **Step 3: 验证构建**

Run:
```bash
npm run build
```

Expected: 构建成功。

- [ ] **Step 4: 真机验证**

启动 `npm run dev`，打开设置 → 飞书：

1. 新开关默认**未勾选**
2. 唤起 launcher 输入 `feishu`，应只看到 8 个命令（状态、登录、搜文档、搜会话、找人、看日程、建文档、建表格）
3. 勾选开关 → 再搜 `feishu`，19 个命令全部出现
4. 取消勾选 → 恢复 8 个
5. 切换语言到 English，确认新开关文案为英文（验证 i18n 生效）

- [ ] **Step 5: 提交**

```bash
git add src/plugins/feishu/settings/FeishuSettingsBody.tsx
git commit -m "feat(feishu): add advanced tools toggle to settings panel"
```

---

### Task 6: 升版本并更新回归清单

**Files:**
- Modify: `src/plugins/feishu/manifest.json`
- Modify: `doc/2026-07-27-feishu-launcher-regression-checklist.md`

- [ ] **Step 1: 升版本号**

项目规则：插件行为/命令/UI 变化必须升版本。编辑 `src/plugins/feishu/manifest.json`，把 `"version": "0.6.27"` 改为：

```json
  "version": "0.7.0",
```

（次版本号递增，因为这是行为变更而非补丁。）

- [ ] **Step 2: 更新回归清单**

编辑 `doc/2026-07-27-feishu-launcher-regression-checklist.md`：

把顶部的 `> 插件版本：` 行更新为 `feishu@0.7.0`。

在「## 2. 打开路径（官方 AppLink）」章节的表格**之后**追加：

```markdown
### 2.6 单次投递契约（0.7.0 新增）

| # | 场景 | 预期 |
|---|------|------|
| 2.6.1 | 打开任一会话后运行 `feishu.debug-open` | 日志中 `shell.run:try` **只出现一次**，紧跟一条 `shell.run:accepted` |
| 2.6.2 | 日志含 `resolveApp:hit` | `path` 为本机真实客户端路径，不是硬编码的 `/Applications/Lark.app` |
| 2.6.3 | 连续打开 10 个不同会话 | 10/10 跳转成功；若有失败，附 `debug-open` 日志复盘 |

> 背景：0.7.0 之前候选 1 `open <url>` 成功后不返回、继续投递候选 2，同一 deep link 被投递两次，
> 客户端二次处理 URL 会把已跳转的窗口重置回默认页——这是此前「有时跳转有时不跳转」的根因。
```

在文件末尾追加新章节：

```markdown
## 6. 命令范围（0.7.0 新增）

| # | 场景 | 预期 |
|---|------|------|
| 6.1 | 默认设置下 launcher 搜 `feishu` | 只出现 8 个命令：状态、登录、搜文档、搜会话、找人、看日程、建文档、建表格 |
| 6.2 | 设置勾选「显示全部飞书命令」 | 19 个命令全部出现 |
| 6.3 | 取消勾选 | 恢复 8 个 |
| 6.4 | 切换到 English | 新开关文案为英文，无硬编码中文 |
| 6.5 | 选中一段文字后运行「建文档」 | L2 确认卡显示正文预览；确认后创建成功并自动打开，正文即选中内容 |
| 6.6 | 直接运行「建表格」不带输入 | L2 确认卡出现；确认后创建成功并自动打开 |

> 设计依据：保留标准是「能否不切换上下文完成」，不是「读 vs 写」。
> 搜文档与建文档都符合——敲一下就拿到链接；建文档还能把选区直接作为正文。
> 发消息不符合：发完必然要切到飞书看回复。搜妙记 / 我的任务等在飞书原生里体验更好，
> 保留代码但默认关闭。
```

- [ ] **Step 3: 全量验证**

Run:
```bash
node scripts/test-feishu-cli-logic.mjs
node scripts/test-feishu-plugin.mjs
npm run check:architecture
npm run build
git diff --check
```

Expected: 四条命令全部成功，`git diff --check` 无空白字符错误输出。

- [ ] **Step 4: 提交**

```bash
git add src/plugins/feishu/manifest.json doc/2026-07-27-feishu-launcher-regression-checklist.md
git commit -m "docs(feishu): bump to 0.7.0 and record scope cut + single-delivery contract"
```

---

## 完成标准

全部 Task 完成后，以下每一条都必须为真：

- [ ] `node scripts/test-feishu-cli-logic.mjs` 通过
- [ ] `node scripts/test-feishu-plugin.mjs` 通过
- [ ] `npm run check:architecture` 通过
- [ ] `npm run build` 通过
- [ ] 真机：连续打开 10 个会话，`debug-open` 日志显示每次只有一条 `shell.run:try`
- [ ] 真机：默认设置下 launcher 只显示 8 个飞书命令
- [ ] 真机：选中文字 → 建文档，正文为选中内容且创建后自动打开
- [ ] 真机：中英文切换下新增文案均正确本地化
- [ ] `src/plugins/feishu/domains/openPlan.ts` 中无任何相对 import（否则行为测试被静默跳过）

## 需要停下来求助的情况

以下情况**不要自行发挥**，停下来说明现状：

1. **Task 4 Step 3c**：`definePlugin` 不支持按设置动态解析 tools。发明宿主 API 会违反项目插件边界规则。
2. **Task 3 Step 4**：单次投递修复后，10 次测试仍有失败。这意味着 `exitCode` 确实不足以判定跳转成功（缺陷 B-2），需要先讨论是否值得为此加窗口轮询延迟。
3. 任何需要修改 `src/workspace/` 或 `src-tauri/` 的情况。本方案设计为**纯插件层改动**；一旦需要动 host 或 Rust 层，说明范围判断有误，先对齐。

## 明确不做

- 不删除任何现有命令的实现代码（只做运行时过滤，保证可回退）
- 不引入窗口标题轮询来验证跳转（会给关键路径加延迟，先用单次投递修复验证）
- 不改 L1 混排的三个 provider（docs / chats / contacts 混排保持现状，它们是核心价值）
- 不动 `src-tauri/` 的 URL scheme 注册（`af497f7` 已修好）
- 不重构 `tools.ts`（1200 行虽长，但本次不碰其内部结构）
