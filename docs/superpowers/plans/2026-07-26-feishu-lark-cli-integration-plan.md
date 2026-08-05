# 飞书 / Lark CLI 接入实施计划（B0 + B1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Global Launcher 接入基于本机 `lark-cli` 的飞书能力：B0 底座（shell 运行时 + 状态/登录/设置）与 B1 文档导航（L1 Desktop Target 混排 + L2 搜索命令）。

**Architecture:** Host 提供通用 `shell.run`（权限 + Tauri 子进程 + 超时），不出现飞书产品 API。`src/plugins/feishu` 作为 first-party 插件：受控调用 `lark-cli … --json`，文档结果注册 `feishu.docs` DesktopTargetProvider，打开走系统 URL。写操作本批不做（B4）。

**Tech Stack:** TypeScript / Tauri 2 / `@hiven/plugin` SDK / 契约测试 scripts

**职责边界（TDD）:**

| 角色 | 职责 |
|------|------|
| 测试 agent | 写失败测试 / 契约脚本；禁止改生产代码迁就测试 |
| 实现 agent | 只改生产代码使测试转绿；禁止削弱断言 |
| 主 agent | 派发、复核、架构检查、build |

**范围：** 本计划覆盖 **B0 + B1**。B2–B5 见设计文分期，不在本批实现。

**关联设计:** `docs/superpowers/specs/2026-07-26-feishu-lark-cli-integration-design.md`

---

## 文件地图

### Host（shell 运行时）

| 路径 | 职责 |
|------|------|
| `src-tauri/src/lib.rs` | `plugin_shell_run` 命令：spawn shell、timeout、截断输出 |
| `src/workspace/pluginShell.ts` | `createPluginShell(permissions)` |
| `src/workspace/pluginTypes.ts` | `PluginShellApi` / `ShellRunOptions` / `ShellRunResult`；上下文注入 `shell` |
| `src/workspace/pluginPermissions.ts` | 已有 `shell.run`（确认 label） |
| `src/workspace/pluginHookManager.ts` | startup 上下文加 shell；权限补齐后重跑 startup |
| `src/workspace/pluginBackgroundManager.ts` | background 上下文加 shell |
| `src/components/PluginSettingsDialog.tsx` | settings host 加 shell |
| `src/components/pluginSurface/PluginSurfaceRenderer.tsx` | surface host 加 shell |
| `src/workspace/launcher/registry.ts` | dynamic / execute 上下文加 shell |
| `src/workspace/launcher/types.ts` | Dynamic / Suggest / Execution / Tool 上下文类型加 shell |
| `src/workspace/desktopTargets/types.ts` + `registry.ts` + `constants.ts` | 可选 `listTimeoutMs`；per-provider 超时 |
| `src/plugin-sdk.ts` | 导出 shell 类型 |

### 插件 feishu

| 路径 | 职责 |
|------|------|
| `src/plugins/feishu/manifest.json` | id/version/permissions |
| `src/plugins/feishu/index.tsx` | definePlugin：settings / tools / hooks |
| `src/plugins/feishu/cli/run.ts` | `runLarkCli` |
| `src/plugins/feishu/cli/parse.ts` | JSON / `_notice` |
| `src/plugins/feishu/cli/errors.ts` | 可读错误映射 |
| `src/plugins/feishu/cli/detect.ts` | binary 探测摘要 |
| `src/plugins/feishu/domains/auth.ts` | status / login split-flow |
| `src/plugins/feishu/domains/docs.ts` | search → 映射结果 |
| `src/plugins/feishu/provider/docsTargetProvider.ts` | `feishu.docs` provider |
| `src/plugins/feishu/runtime.ts` | 绑定 shell + settings 闭包 |
| `src/plugins/feishu/settings/model.ts` | enabled / docsMix / binaryPath |
| `src/plugins/feishu/settings/FeishuSettingsBody.tsx` | 状态 / 登录 / 开关 |
| `src/plugins/feishu/locales/{en,zh}.json` | 全量 i18n |

### 接线

| 路径 | 职责 |
|------|------|
| `src/workspace/pluginProductCatalog.ts` | 产品名 飞书 / Feishu |
| `src/builtin-plugins/index.json` | version +1（触发重释放） |
| `scripts/test-plugin-shell-runtime.mjs` | shell 契约 |
| `scripts/test-feishu-plugin.mjs` | feishu 契约 |
| `package.json` | 注册 test scripts |

---

### Task 1: Host shell 运行时（契约测试 + 实现）

**Files:**
- Create: `src/workspace/pluginShell.ts`
- Create: `scripts/test-plugin-shell-runtime.mjs`
- Modify: `src-tauri/src/lib.rs`（command + generate_handler）
- Modify: `src/workspace/pluginTypes.ts`
- Modify: 上下文注入点（hooks / background / settings / surface / launcher）
- Modify: `src/plugin-sdk.ts`、`package.json`

- [ ] **Step 1: 写失败契约测试** `scripts/test-plugin-shell-runtime.mjs`

断言：

1. `pluginTypes` 含 `PluginShellApi`、`ShellRunOptions`、`ShellRunResult`、`'shell.run'`
2. `pluginShell.ts` 存在且 `createPluginShell` 调用 `requirePluginPermissions(..., ['shell.run'])` 与 `invoke('plugin_shell_run'`
3. Tauri `plugin_shell_run` 在 `generate_handler!` 中
4. `PluginStartupHookContext` / `PluginBackgroundContext` / `PluginSurfaceHostApi` / `LauncherDynamicContext` 暴露 `shell`
5. `package.json` 有 `test:plugin-shell-runtime`

- [ ] **Step 2: 跑测试确认失败**

```bash
node scripts/test-plugin-shell-runtime.mjs
```

Expected: FAIL（缺类型/文件）

- [ ] **Step 3: 实现最小 shell 运行时**

Tauri（示意）:

```rust
#[derive(Deserialize)]
struct PluginShellRunRequest {
    command: String,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    #[serde(rename = "timeoutMs")]
    timeout_ms: Option<u64>,
    #[serde(rename = "maxOutputBytes")]
    max_output_bytes: Option<u64>,
    #[serde(rename = "shellProgram")]
    shell_program: Option<String>,
    #[serde(rename = "shellArgs")]
    shell_args: Option<Vec<String>>,
}

// spawn: program + args + command；timeout；截断 stdout/stderr
// 非 0 exit → 仍 Ok(result)，不 Err
```

TS:

```ts
export function createPluginShell(permissions: PluginPermissionSnapshot): PluginShellApi {
  return {
    async run(options) {
      requirePluginPermissions(permissions, ['shell.run'])
      return invoke('plugin_shell_run', { request: options })
    },
  }
}
```

注入：凡 `createPluginNetwork` 处同步加 `createPluginShell`。

权限 watcher：`pluginHookManager` 在权限从 missing→完整时重跑未完成的 startup（镜像 background）。

- [ ] **Step 4: 测试通过**

```bash
node scripts/test-plugin-shell-runtime.mjs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src/workspace/pluginShell.ts src/workspace/pluginTypes.ts \
  src/workspace/pluginHookManager.ts src/workspace/pluginBackgroundManager.ts \
  src/components/PluginSettingsDialog.tsx src/components/pluginSurface/PluginSurfaceRenderer.tsx \
  src/workspace/launcher/ src/plugin-sdk.ts scripts/test-plugin-shell-runtime.mjs package.json
git commit -m "feat(shell): add plugin shell.run host runtime"
```

---

### Task 2: Desktop Target per-provider 超时

**Files:**
- Modify: `src/workspace/desktopTargets/types.ts`（`listTimeoutMs?: number`）
- Modify: `src/workspace/desktopTargets/registry.ts`（provider 级超时优先）

- [ ] **Step 1: 实现**

```ts
const timeoutMs =
  provider.listTimeoutMs ?? options.timeoutMs ?? DESKTOP_TARGET_PROVIDER_TIMEOUT_MS
```

feishu.docs 将设 `listTimeoutMs: 8000`。

- [ ] **Step 2: Commit**

```bash
git commit -am "feat(desktop-targets): allow per-provider listTimeoutMs"
```

---

### Task 3: feishu CLI 纯逻辑（parse / errors / docs map）

**Files:**
- Create: `src/plugins/feishu/cli/{parse,errors,run,detect}.ts`
- Create: `src/plugins/feishu/domains/{auth,docs}.ts`
- Create: `src/plugins/feishu/runtime.ts`
- Create: `scripts/test-feishu-cli-logic.mjs`（transpile 纯函数或静态 + 样例 JSON）

- [ ] **Step 1: 失败测试**

覆盖：

- 合法 docs search JSON → 提取 title（去 highlight 标签）/ url / entity_type
- 空 query / 无 url 结果过滤
- 未登录 / 非 0 / 解析失败 → 错误码与 hint（不抛 token）
- 写路径：`runLarkCli` 在 `risk: 'write'` 且 `confirmed !== true` 时 **不调用** shell

- [ ] **Step 2: 最小实现**

`runLarkCli` 契约：

```ts
runLarkCli({
  shell,
  binaryPath?: string, // default 'lark-cli' or settings absolute path
  args: string[],
  timeoutMs?: number,
  signal?: AbortSignal,
  risk?: 'read' | 'write' | 'high-risk-write',
  confirmed?: boolean,
}): Promise<LarkCliResult>
```

规则：

- 自动追加 `--json`（若尚未包含）
- write 未确认 → 返回 `{ ok: false, code: 'confirmation_required' }`，零次 shell 调用
- 禁止在错误消息中附带 token/secret

- [ ] **Step 3: 测试通过 + Commit**

```bash
git commit -m "feat(feishu): add lark-cli adapter parse and run guards"
```

---

### Task 4: feishu 插件壳（settings + 状态/登录 + 注册）

**Files:**
- Create: `src/plugins/feishu/manifest.json`（permissions: `shell.run`）
- Create: `src/plugins/feishu/index.tsx`
- Create: `src/plugins/feishu/settings/*`
- Create: `src/plugins/feishu/locales/{en,zh}.json`
- Modify: `src/workspace/pluginProductCatalog.ts`
- Modify: `src/builtin-plugins/index.json`（version +1）

- [ ] **Step 1: 契约测试** `scripts/test-feishu-plugin.mjs`

- 文件存在；manifest `shell.run`；无 `../../workspace` 深 import
- 使用 `@hiven/plugin` / `getPluginHostSdk().desktopTargets`
- catalog 含 feishu
- 空 query provider 返回 `[]`
- settings 有启用 L1 / binary path / 登录引导文案 key
- tools/commands 含 status / login（或 tools 等价）

- [ ] **Step 2: 实现**

- settings: `enabled`, `docsMixEnabled`, `binaryPath`
- hooks.startup + settings.onChange：绑定 runtime shell，按开关 register/unregister `feishu.docs`
- tools：`feishu.status`、`feishu.login`（编排 `auth login --no-wait --json` → open verification_url → 用户确认后 device-code）
- 未授权 shell：命令返回引导文案；L1 未注册或 list 静默 `[]`

- [ ] **Step 3: 测试 + Commit**

```bash
git commit -m "feat(feishu): add plugin settings auth status and shell binding"
```

---

### Task 5: B1 文档 L1 + L2 搜索

**Files:**
- Create: `src/plugins/feishu/provider/docsTargetProvider.ts`
- Modify: domains/docs + index tools

- [ ] **Step 1: 契约扩展**

- provider `id === 'feishu.docs'`，`kind: 'document'`，`actionClass: 'open'`，`meta.url` 必填
- `listTimeoutMs >= 5000`
- activate → open URL（sdk / shell open / api.openUrl）
- L2 搜索 tool 存在，aliases 含 `飞书`/`lark`/`docs`

- [ ] **Step 2: 实现**

```text
list: surface global-launcher && docsMixEnabled && query.trim()
  → runLarkCli docs +search --query --as user --json
  → map → DesktopTarget[]
activate: open(meta.url)
```

- [ ] **Step 3: 测试 + Commit**

```bash
git commit -m "feat(feishu): L1 docs desktop targets and L2 search"
```

---

### Task 6: 全量验证

```bash
git status --short --ignored
npm run check:architecture
git diff --check
node scripts/test-plugin-shell-runtime.mjs
node scripts/test-feishu-cli-logic.mjs
node scripts/test-feishu-plugin.mjs
npm run build
```

更新路线图状态（可选同一 PR）：`doc/2026-07-19-launcher-intelligence-roadmap-design.md` 包⑧ → 设计已就绪 / 实现进行中。

---

## Spec 覆盖（B0/B1）

| 设计项 | 任务 |
|--------|------|
| S2 未装/未登录降级 | Task 3–4 |
| S3 单源失败 isolation | Task 2 + provider catch |
| S4 写确认（零写调用） | Task 3 guard（B4 再做写命令） |
| S5 无深 import / architecture | Task 4–6 |
| S6 i18n | Task 4 |
| S1 文档混排打开 | Task 5（真机手工） |
| shell 委托 / 不自管 token | Task 1 + 3 |
| L1 仅文档 | Task 5 |

## B2–B5（本计划不实现，仅索引）

- B2 日程只读、B3 会话联系人、B4 受控写、B5 fetch/妙记等 — 复用 `runLarkCli` + tools 树扩展。
