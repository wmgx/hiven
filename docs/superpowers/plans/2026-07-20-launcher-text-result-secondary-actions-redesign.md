# 文本结果次要动作重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **TDD 职责隔离（本仓库 CLAUDE.md 强制要求）：** Task 2 / Task 3 / Task 4 是行为改动，必须拆分为测试 agent（只写/改测试，确认先红）和实现 agent（只改生产代码，让测试转绿，禁止反向改测试迁就实现）；主 agent 负责最终独立复核（重跑测试、`tsc`、架构检查），不得直接采信子 agent 的"已通过"结论。Task 1 / Task 5 是纯类型声明与一行接线，用编译器验证即可，按 CLAUDE.md 例外条款单 agent 处理（一次性、机械、低风险的插件/接线改动）。

**Goal:** 让 Global Launcher 里文本结果的次要动作从"两个假动作，点了直接关闭并甩到另一个窗口"变成"一个真动作：带回 Launcher 变成 Object Block"；同时给 Pane 绑定语境（Quick Editor 命令面板）补上一直存在但没暴露的"插入"动作。

**Architecture:** `src/workspace/launcher/*`（多 host 共用的框架状态机层）新增一个语义方法名 `PluginLauncherApi.returnToLauncher`，但不知道 Object Block 是什么；真正会认识 Object Block 的实现放在 `src/launcher/clipboard/`（Global Launcher 专属产品层），通过已有的 `makeApi` 覆盖模式（`useLauncherSession` 参数）注入进 Global Launcher 的执行上下文。带回 Launcher 后"停留而不关闭"复用 `controller.ts` 里已经存在、未修改的 `keepOpen` 分支。

**Tech Stack:** TypeScript + React 19；无 DOM 测试框架，测试用项目既有的"`typescript.transpileModule` + `node:vm` 直接执行真实生产模块"手法（`scripts/test-launcher-registry.mjs` 之后的建立惯例）。

**依赖的设计文档：** `doc/2026-07-20-launcher-text-result-secondary-actions-redesign.md`（先读这个，里面有完整的证据链和决策记录，本计划不重复背景论证）。

---

### Task 1: `PluginLauncherApi` 新增 `returnToLauncher` 方法（类型 + 安全兜底实现）

**Files:**
- Modify: `src/workspace/launcher/types.ts:302-338`（`PluginLauncherApi` 类型定义）
- Modify: `src/workspace/launcher/pluginApi.ts:179-220` 附近（`createPluginLauncherApi` 函数体）

**执行者：** 单 agent 直接处理（纯类型声明 + 一行安全兜底实现，无行为分支需要测试；用 `tsc --noEmit` 验证即可，属 CLAUDE.md TDD 隔离例外）。

- [ ] **Step 1: 在 `PluginLauncherApi` 类型里新增方法签名**

打开 `src/workspace/launcher/types.ts`，找到：

```ts
  isPanePanelOpen(panelId: string): boolean
  getClipboardText(): Promise<string>
  replaceActiveText(text: string): Promise<void>
  insertText(text: string): Promise<void>
  copyText(text: string): Promise<void>
```

改成：

```ts
  isPanePanelOpen(panelId: string): boolean
  getClipboardText(): Promise<string>
  replaceActiveText(text: string): Promise<void>
  insertText(text: string): Promise<void>
  /**
   * Hand text back to the surface that can turn it into a first-class object
   * (e.g. Global Launcher's Object Block). Surfaces with no such concept (Quick
   * Editor command bar) fall back to the same behavior as insertText.
   */
  returnToLauncher(text: string): Promise<void>
  copyText(text: string): Promise<void>
```

- [ ] **Step 2: 在默认 `createPluginLauncherApi()` 里补安全兜底实现**

打开 `src/workspace/launcher/pluginApi.ts`，找到（约 L192-197）：

```ts
    replaceActiveText: async (text: string) => {
      await createQuickEditorPane({ text })
    },
    insertText: async (text: string) => {
      await createQuickEditorPane({ text })
    },
```

改成：

```ts
    replaceActiveText: async (text: string) => {
      await createQuickEditorPane({ text })
    },
    insertText: async (text: string) => {
      await createQuickEditorPane({ text })
    },
    // Real implementation lives in src/launcher/clipboard/globalLauncherApi.ts,
    // injected via useLauncherSession's makeApi for the global-launcher surface
    // (the only surface that ever calls this — see output.ts textResult()).
    // This fallback only exists so the interface is total; unreachable in practice.
    returnToLauncher: async (text: string) => {
      await createQuickEditorPane({ text })
    },
```

`createQuickEditorPane` 已经在文件顶部 import 了（L23），不需要新增 import。

- [ ] **Step 3: 编译验证**

Run: `npx tsc --noEmit`
Expected: `TypeScript compilation completed`，无错误（这一步会报错，因为 `quickEditorActions.ts` 的 `createQuickEditorLauncherApi` 用 `{...baseApi, ...}` 展开，`returnToLauncher` 会被自动继承，不需要改那个文件；如果报错提示别处缺 `returnToLauncher`，说明还有一个手写 `PluginLauncherApi` 字面量没展开 `baseApi`，需要在报错文件里补上同样的兜底实现）。

- [ ] **Step 4: Commit**

```bash
git add src/workspace/launcher/types.ts src/workspace/launcher/pluginApi.ts
git commit -m "feat(launcher): add returnToLauncher to PluginLauncherApi with safe fallback"
```

---

### Task 2: Object Block 工厂 `createToolResultObjectBlock`

**Files:**
- Modify: `src/launcher/clipboard/objectBlock.ts`
- Test: `scripts/test-object-block-tool-result-factory.mjs`（新建）

**执行者：** 测试 agent 写 Step 1-2（确认先红），实现 agent 做 Step 3-4（确认转绿），禁止同一 agent 兼任。

- [ ] **Step 1: 写失败测试**

新建 `scripts/test-object-block-tool-result-factory.mjs`：

```js
#!/usr/bin/env node
/**
 * test-object-block-tool-result-factory.mjs
 *
 * Regression test for createToolResultObjectBlock (src/launcher/clipboard/objectBlock.ts),
 * the factory that turns a launcher tool's text result (e.g. calculator "求和") into an
 * Object Block so it can be handed back to Global Launcher instead of vanishing into a
 * detached Quick Editor window. See doc/2026-07-20-launcher-text-result-secondary-actions-redesign.md.
 *
 * Loads the REAL production chain (objectBlock.ts -> clipboardSnapshot.ts -> detectContent.ts)
 * via ts.transpileModule + vm, same pattern as scripts/test-launcher-registry.mjs.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadModule(path, { stripImports = [], globals = {} } = {}) {
  let src = readFileSync(path, 'utf8')
  for (const re of stripImports) src = src.replace(re, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const stripTypeImports = [/import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g]

// --- src/kits/content/detectContent.ts (leaf, only type-only imports) ---
const detectContentModule = loadModule('src/kits/content/detectContent.ts', {
  stripImports: [...stripTypeImports],
})
assert.equal(typeof detectContentModule.detectContent, 'function', 'detectContent.ts must export detectContent')

// --- src/launcher/clipboard/clipboardSnapshot.ts (depends on kits/content/index -> detectContent) ---
const clipboardSnapshot = loadModule('src/launcher/clipboard/clipboardSnapshot.ts', {
  stripImports: [
    ...stripTypeImports,
    /import\s*\{\s*detectContent\s*\}\s*from\s*'\.\.\/\.\.\/kits\/content\/index'\s*;?\s*\n?/,
  ],
  globals: { detectContent: detectContentModule.detectContent },
})
assert.equal(typeof clipboardSnapshot.detectClipboardType, 'function', 'clipboardSnapshot.ts must export detectClipboardType')

// --- src/launcher/clipboard/objectBlock.ts (depends on clipboardSnapshot.ts) ---
const objectBlock = loadModule('src/launcher/clipboard/objectBlock.ts', {
  stripImports: [
    ...stripTypeImports,
    /import\s*\{[^}]*\}\s*from\s*'\.\/clipboardSnapshot'\s*;?\s*\n?/,
  ],
  globals: {
    detectClipboardFilePath: clipboardSnapshot.detectClipboardFilePath,
    detectClipboardType: clipboardSnapshot.detectClipboardType,
    fileNameFromPath: clipboardSnapshot.fileNameFromPath,
    shouldAutoAttachClipboard: clipboardSnapshot.shouldAutoAttachClipboard,
    shouldShowRecentClipboardHint: clipboardSnapshot.shouldShowRecentClipboardHint,
  },
})

// --- THE FUNCTION UNDER TEST (does not exist yet — this assertion is the red test) ---
assert.equal(
  typeof objectBlock.createToolResultObjectBlock,
  'function',
  'objectBlock.ts must export createToolResultObjectBlock (new factory for tool-result Object Blocks)',
)

const block = objectBlock.createToolResultObjectBlock('6')
assert.equal(block.source, 'tool-result', 'block.source must be the new tool-result source')
assert.equal(block.payloadText, '6', 'block.payloadText must be the raw result text (used for downstream actions)')
assert.equal(block.preview, '6', 'block.preview must show the result text in the token UI')
assert.equal(block.removable, true, 'user must be able to ⌫ remove the block')
assert.equal(block.kind, 'text', 'plain numeric text like "6" must be detected as kind "text"')

// A JSON-shaped result should be detected as such, same detection used for clipboard blocks.
const jsonBlock = objectBlock.createToolResultObjectBlock('{"a":1}')
assert.equal(jsonBlock.kind, 'json', 'JSON-shaped tool results must be detected as kind "json"')
assert.equal(jsonBlock.validity, 'valid', 'detected JSON must be marked valid, matching createClipboardObjectBlock behavior')

console.log('✓ test-object-block-tool-result-factory passed')
```

- [ ] **Step 2: 运行确认先红**

Run: `node scripts/test-object-block-tool-result-factory.mjs`
Expected: 抛 `AssertionError`，信息为 `objectBlock.ts must export createToolResultObjectBlock (new factory for tool-result Object Blocks)`（因为 `objectBlock.createToolResultObjectBlock` 还是 `undefined`）。如果失败原因是别的（比如模块加载报错），说明测试脚本本身写错了，先修脚本，不要往下走。

- [ ] **Step 3: 实现 `createToolResultObjectBlock`**

打开 `src/launcher/clipboard/objectBlock.ts`。

第一步，扩展 `ObjectBlockSource` 联合类型（约 L20-28）：

```ts
export type ObjectBlockSource =
  | 'clipboard'
  | 'editor-selection'
  | 'editor-pane'
  | 'editor-document'
  | 'multi-pane'
  | 'history-item'
  | 'query'
  | 'snapshot'
  | 'tool-result'
```

第二步，在 `SOURCE_LABELS`（约 L139-148）里加一条：

```ts
const SOURCE_LABELS: Record<ObjectBlockSource, string> = {
  clipboard: '剪贴板',
  'editor-selection': '当前选区',
  'editor-pane': '当前 pane',
  'editor-document': '当前文档',
  'multi-pane': '两个 pane',
  'history-item': '剪贴板历史',
  query: 'Query',
  snapshot: 'Snapshot',
  'tool-result': '计算结果',
}
```

第三步，在 `createQueryObjectBlock` 函数（约 L420-432）后面新增工厂函数：

```ts
export function createToolResultObjectBlock(text: string): LauncherObjectBlock {
  const kind = normalizeSecretKind(detectClipboardType(text))
  return createGenericObjectBlock({
    source: 'tool-result',
    kind,
    title: getSourceLabel('tool-result'),
    subtitle: getKindLabel(kind),
    text,
    masked: isSecretKind(kind),
    removable: true,
    validity: kind === 'json' ? 'valid' : 'unknown',
  })
}
```

- [ ] **Step 4: 运行确认转绿**

Run: `node scripts/test-object-block-tool-result-factory.mjs`
Expected: `✓ test-object-block-tool-result-factory passed`

- [ ] **Step 5: Commit**

```bash
git add src/launcher/clipboard/objectBlock.ts scripts/test-object-block-tool-result-factory.mjs
git commit -m "feat(launcher): add createToolResultObjectBlock factory for tool-result Object Blocks"
```

---

### Task 3: `createGlobalLauncherPluginApi`（Global Launcher 专属 `returnToLauncher` 实现）

**Files:**
- Create: `src/launcher/clipboard/globalLauncherApi.ts`
- Test: `scripts/test-global-launcher-plugin-api.mjs`（新建）

**依赖：** Task 1（`PluginLauncherApi.returnToLauncher` 类型已存在）、Task 2（`createToolResultObjectBlock` 已存在）必须先完成。

**执行者：** 测试 agent 写 Step 1-2，实现 agent 做 Step 3-4，禁止同一 agent 兼任。

- [ ] **Step 1: 写失败测试**

新建 `scripts/test-global-launcher-plugin-api.mjs`：

```js
#!/usr/bin/env node
/**
 * test-global-launcher-plugin-api.mjs
 *
 * Regression test for createGlobalLauncherPluginApi (src/launcher/clipboard/globalLauncherApi.ts):
 * verifies that calling the wrapped api's returnToLauncher(text) delivers a tool-result
 * Object Block through the REAL pending-object-block bridge (src/launcher/clipboard/pendingObjectBlock.ts),
 * the same bridge clipboard-history's "return to launcher" flow already uses.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadModule(path, { stripImports = [], globals = {} } = {}) {
  let src = readFileSync(path, 'utf8')
  for (const re of stripImports) src = src.replace(re, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const stripTypeImports = [/import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g]

// --- Real chain: detectContent -> clipboardSnapshot -> objectBlock ---
const detectContentModule = loadModule('src/kits/content/detectContent.ts', {
  stripImports: [...stripTypeImports],
})
const clipboardSnapshot = loadModule('src/launcher/clipboard/clipboardSnapshot.ts', {
  stripImports: [
    ...stripTypeImports,
    /import\s*\{\s*detectContent\s*\}\s*from\s*'\.\.\/\.\.\/kits\/content\/index'\s*;?\s*\n?/,
  ],
  globals: { detectContent: detectContentModule.detectContent },
})
const objectBlock = loadModule('src/launcher/clipboard/objectBlock.ts', {
  stripImports: [
    ...stripTypeImports,
    /import\s*\{[^}]*\}\s*from\s*'\.\/clipboardSnapshot'\s*;?\s*\n?/,
  ],
  globals: {
    detectClipboardFilePath: clipboardSnapshot.detectClipboardFilePath,
    detectClipboardType: clipboardSnapshot.detectClipboardType,
    fileNameFromPath: clipboardSnapshot.fileNameFromPath,
    shouldAutoAttachClipboard: clipboardSnapshot.shouldAutoAttachClipboard,
    shouldShowRecentClipboardHint: clipboardSnapshot.shouldShowRecentClipboardHint,
  },
})
assert.equal(typeof objectBlock.createToolResultObjectBlock, 'function', 'Task 2 must land first: createToolResultObjectBlock missing')

// --- Real pendingObjectBlock.ts (in-memory localStorage stub; module never requires persistence in this flow) ---
const memoryStorage = new Map()
const fakeLocalStorage = {
  getItem: (key) => (memoryStorage.has(key) ? memoryStorage.get(key) : null),
  setItem: (key, value) => { memoryStorage.set(key, value) },
  removeItem: (key) => { memoryStorage.delete(key) },
}
const pendingObjectBlock = loadModule('src/launcher/clipboard/pendingObjectBlock.ts', {
  stripImports: [...stripTypeImports],
  globals: { localStorage: fakeLocalStorage },
})
assert.equal(typeof pendingObjectBlock.consumePendingObjectBlock, 'function', 'pendingObjectBlock.ts must export consumePendingObjectBlock')

// --- THE MODULE UNDER TEST (does not exist yet — this require throws, which is the red test) ---
let globalLauncherApi
try {
  globalLauncherApi = loadModule('src/launcher/clipboard/globalLauncherApi.ts', {
    stripImports: [...stripTypeImports],
    globals: {
      createToolResultObjectBlock: objectBlock.createToolResultObjectBlock,
      setPendingObjectBlock: pendingObjectBlock.setPendingObjectBlock,
    },
  })
} catch (error) {
  console.error('Expected failure (red test): src/launcher/clipboard/globalLauncherApi.ts does not exist yet')
  throw error
}

assert.equal(typeof globalLauncherApi.createGlobalLauncherPluginApi, 'function', 'globalLauncherApi.ts must export createGlobalLauncherPluginApi')

// --- Fake base PluginLauncherApi (minimal shape; only fields the wrapper touches or spreads through) ---
const baseApi = {
  getActiveText: () => '',
  getSelectionText: () => '',
  copyText: async () => {},
  insertText: async () => { throw new Error('base insertText must not be called by returnToLauncher') },
  replaceActiveText: async () => { throw new Error('base replaceActiveText must not be called by returnToLauncher') },
  showMessage: () => {},
}

const wrapped = globalLauncherApi.createGlobalLauncherPluginApi(baseApi)
assert.equal(typeof wrapped.copyText, 'function', 'wrapped api must still expose base methods (spread-through)')
assert.equal(typeof wrapped.returnToLauncher, 'function', 'wrapped api must override returnToLauncher')

// Sanity: nothing pending before we call it.
assert.equal(pendingObjectBlock.consumePendingObjectBlock(), null, 'no pending block should exist before returnToLauncher runs')

await wrapped.returnToLauncher('6')

const delivered = pendingObjectBlock.consumePendingObjectBlock()
assert.ok(delivered, 'returnToLauncher must deliver a block through setPendingObjectBlock')
assert.equal(delivered.source, 'tool-result', 'delivered block must be source "tool-result"')
assert.equal(delivered.payloadText, '6', 'delivered block must carry the exact result text')

// Consuming again must return null (one-shot consume, per pendingObjectBlock.ts's own contract).
assert.equal(pendingObjectBlock.consumePendingObjectBlock(), null, 'pending block must be consumed exactly once')

console.log('✓ test-global-launcher-plugin-api passed')
```

- [ ] **Step 2: 运行确认先红**

Run: `node scripts/test-global-launcher-plugin-api.mjs`
Expected: 抛错，提示找不到文件 `src/launcher/clipboard/globalLauncherApi.ts`（`loadModule` 内部 `readFileSync` 抛 `ENOENT`），或断言 `globalLauncherApi.ts must export createGlobalLauncherPluginApi` 失败。两者都说明测试在为正确的原因失败（文件/导出还不存在）。

- [ ] **Step 3: 实现 `createGlobalLauncherPluginApi`**

新建 `src/launcher/clipboard/globalLauncherApi.ts`：

```ts
/**
 * Global Launcher's PluginLauncherApi override.
 *
 * Wraps the shared base api (src/workspace/launcher/pluginApi.ts) and gives
 * returnToLauncher its real, product-specific meaning for this one surface:
 * turn the text into a tool-result Object Block and deliver it through the
 * existing pending-object-block bridge (already used by clipboard-history's
 * "return to launcher" flow — see doc/2026-07-19-clipboard-history-return-to-launcher-design.md).
 *
 * Wired in via useLauncherSession's `makeApi` option, same pattern as Quick
 * Editor's command bar (src/workspace/quickEditor/quickEditorActions.ts
 * createQuickEditorLauncherApi).
 */

import { createToolResultObjectBlock } from './objectBlock'
import { setPendingObjectBlock } from './pendingObjectBlock'
import type { PluginLauncherApi } from '../../workspace/launcher/types'

export function createGlobalLauncherPluginApi(baseApi: PluginLauncherApi): PluginLauncherApi {
  return {
    ...baseApi,
    returnToLauncher: async (text: string) => {
      setPendingObjectBlock(createToolResultObjectBlock(text))
    },
  }
}
```

- [ ] **Step 4: 运行确认转绿**

Run: `node scripts/test-global-launcher-plugin-api.mjs`
Expected: `✓ test-global-launcher-plugin-api passed`

- [ ] **Step 5: Commit**

```bash
git add src/launcher/clipboard/globalLauncherApi.ts scripts/test-global-launcher-plugin-api.mjs
git commit -m "feat(launcher): add createGlobalLauncherPluginApi wiring returnToLauncher to Object Block"
```

---

### Task 4: 重写 `output.ts` 的次要动作集合（核心行为改动）

**Files:**
- Modify: `src/workspace/launcher/output.ts`
- Modify: `src/i18n/locales/palette.ts`
- Modify: `src/workflow/pipelineLauncher.ts`（第二个 `textResult` 调用方，见 Step 5）
- Modify (existing test, update assertions): `scripts/test-launcher-secondary-action-icons.mjs`
- Test: `scripts/test-surface-text-result.mjs`（新建，见 Step 5）

**依赖：** Task 1 必须先完成（`api.returnToLauncher` 类型必须存在，`textResult` 才能调用它）。

**执行者：** 测试 agent 改 Step 1-2（现有测试文件的断言要更新成新预期，先确认红），实现 agent 做 Step 3-4。

- [ ] **Step 1: 更新既有测试的断言，反映新的次要动作集合**

打开 `scripts/test-launcher-secondary-action-icons.mjs`。这个文件当前的内容是（本次会话早前写的，验证"次要动作有正确图标"）：

```js
#!/usr/bin/env node
/**
 * test-launcher-secondary-action-icons.mjs
 *
 * Regression test: the collect-input suggest row (GlobalLauncherCollectInputFrame.tsx)
 * renders every LauncherResultChoice.secondaryActions entry as a generic "×" glyph
 * button, regardless of what the action actually does. That glyph is correct for
 * genuinely destructive actions (close window, delete clipboard-history entry —
 * see src/plugins/web-open/index.tsx and src/workspace/desktopTargets/types.ts),
 * but output.ts's textResult()/replaceActiveTextResult() attach non-destructive
 * secondary actions ("replace active text", "insert", "copy") that also rendered
 * as "×", which reads as two delete buttons next to a calculator result.
 *
 * Fix: LauncherResultAction gains an optional `icon` field; textResult/
 * replaceActiveTextResult set it to a semantically matching lucide icon name.
 * Actions that don't set `icon` (window close, history delete, etc.) keep
 * rendering the literal "×" fallback in the component — untouched by this test.
 *
 * This loads the REAL src/workspace/launcher/output.ts module (same loader
 * pattern as scripts/test-launcher-registry.mjs) and asserts on the icon field
 * of each secondary action.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadModule(path, { stripImports = [], globals = {} } = {}) {
  let src = readFileSync(path, 'utf8')
  for (const re of stripImports) src = src.replace(re, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const stripTypeImports = [/import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g]
const stripI18nImport = /import\s*\{\s*translate,\s*type\s+Locale\s*\}\s*from\s*'[^']*\/i18n'\s*;?\s*\n?/
const translate = (locale, namespace, key) => key // titles aren't under test here

const output = loadModule('src/workspace/launcher/output.ts', {
  stripImports: [...stripTypeImports, stripI18nImport],
  globals: { translate },
})

const fakeApi = {
  replaceActiveText: async () => {},
  copyText: async () => {},
  insertText: async () => {},
  showMessage: () => {},
}

// --- textResult: primary = copy, secondary = [replace-active, insert] ---
const textChoice = output.textResult('6', fakeApi, 'zh').output.choices[0]
const byId = Object.fromEntries(textChoice.secondaryActions.map((a) => [a.id, a]))

assert.equal(byId['replace-active']?.icon, 'Replace', '"replace active text" secondary action must carry a Replace icon, not the generic × fallback')
assert.equal(byId['insert']?.icon, 'TextCursorInput', '"insert" secondary action must carry a TextCursorInput icon, not the generic × fallback')

// --- replaceActiveTextResult: primary = replace, secondary = [copy] ---
const replaceChoice = output.replaceActiveTextResult('6', fakeApi, 'zh').output.choices[0]
const copyAction = replaceChoice.secondaryActions.find((a) => a.id === 'copy')
assert.equal(copyAction?.icon, 'Copy', '"copy" secondary action must carry a Copy icon, not the generic × fallback')

console.log('✓ test-launcher-secondary-action-icons passed')
```

`textResult` 不再有 `replace-active`/`insert` 两个动作（改成唯一的 `return-to-launcher`），`replaceActiveTextResult` 新增 `insert`。把文件中间 `fakeApi` 及往后的部分（保留上面所有 `import`/`loadModule`/`stripTypeImports`/`stripI18nImport`/`translate`/`output` 这些不变的部分）替换成：

```js
const fakeApi = {
  replaceActiveText: async () => {},
  copyText: async () => {},
  insertText: async () => {},
  returnToLauncher: async () => {},
  showMessage: () => {},
}

// --- textResult (Global Launcher): primary = copy, secondary = [return-to-launcher] only ---
const textChoice = output.textResult('6', fakeApi, 'zh').output.choices[0]
assert.equal(textChoice.secondaryActions.length, 1, 'textResult must expose exactly one secondary action (no more fake replace/insert duo)')
const returnAction = textChoice.secondaryActions[0]
assert.equal(returnAction.id, 'return-to-launcher', 'the single secondary action must be return-to-launcher')
assert.equal(returnAction.icon, 'CornerDownLeft', 'return-to-launcher must carry a CornerDownLeft icon, not the generic × fallback')

// run() must call api.returnToLauncher with the result text, and signal the
// controller to stay open (popped back to the root list, not closed) —
// see controller.ts's keepOpen handling for collect-input frames without `suggest`.
let returnToLauncherCalledWith
const spyApi = { ...fakeApi, returnToLauncher: async (text) => { returnToLauncherCalledWith = text } }
const spiedChoice = output.textResult('6', spyApi, 'zh').output.choices[0]
const runResult = await spiedChoice.secondaryActions[0].run()
assert.equal(returnToLauncherCalledWith, '6', 'return-to-launcher action must call api.returnToLauncher(text) with the result text')
assert.deepEqual(runResult, { ok: true, keepOpen: true }, 'return-to-launcher action must return { ok: true, keepOpen: true } so the launcher stays open')

// --- replaceActiveTextResult (pane-bound): primary = replace, secondary = [copy, insert] ---
const replaceChoice = output.replaceActiveTextResult('6', fakeApi, 'zh').output.choices[0]
assert.equal(replaceChoice.secondaryActions.length, 2, 'replaceActiveTextResult must expose copy + insert')
const byId = Object.fromEntries(replaceChoice.secondaryActions.map((a) => [a.id, a]))
assert.equal(byId['copy']?.icon, 'Copy', '"copy" secondary action must carry a Copy icon')
assert.equal(byId['insert']?.icon, 'TextCursorInput', '"insert" secondary action must carry a TextCursorInput icon (newly exposed, real insertText behavior)')

let insertCalledWith
const spyApi2 = { ...fakeApi, insertText: async (text) => { insertCalledWith = text } }
const spiedReplaceChoice = output.replaceActiveTextResult('6', spyApi2, 'zh').output.choices[0]
await spiedReplaceChoice.secondaryActions.find((a) => a.id === 'insert').run()
assert.equal(insertCalledWith, '6', '"insert" action must call api.insertText(text) with the result text')

console.log('✓ test-launcher-secondary-action-icons passed')
```

- [ ] **Step 2: 运行确认先红**

Run: `node scripts/test-launcher-secondary-action-icons.mjs`
Expected: 抛 `AssertionError`，信息为 `textResult must expose exactly one secondary action (no more fake replace/insert duo)`（当前 `output.ts` 还是两个动作）。

- [ ] **Step 3: 实现 `output.ts` 改动**

打开 `src/i18n/locales/palette.ts`，找到英文块（约 L30-34）：

```ts
    'copied': 'Copied',
    'copy': 'Copy',
    'enterToCopy': 'Enter to copy',
    'insert': 'Insert',
    'replaceActiveText': 'Replace active text',
```

改成：

```ts
    'copied': 'Copied',
    'copy': 'Copy',
    'enterToCopy': 'Enter to copy',
    'insert': 'Insert',
    'replaceActiveText': 'Replace active text',
    'returnToLauncher': 'Return to Launcher',
```

再找到中文块（约 L106-110）：

```ts
    'copied': '已复制',
    'copy': '复制',
    'enterToCopy': '回车复制',
    'insert': '插入',
    'replaceActiveText': '替换当前文本',
```

改成：

```ts
    'copied': '已复制',
    'copy': '复制',
    'enterToCopy': '回车复制',
    'insert': '插入',
    'replaceActiveText': '替换当前文本',
    'returnToLauncher': '带回 Launcher',
```

（`replaceActiveText` 键保留不删——虽然 `textResult` 不再用它，但它仍是通用 palette 词条，`replaceActiveTextResult` 的主操作等其它地方的文案含义不依赖这个 key 本身；不在本次任务里做无关清理。）

打开 `src/workspace/launcher/output.ts`，把 `textResult` 函数（当前 L32-61）整个替换成：

```ts
export function textResult(text: string, api: PluginLauncherApi, locale: Locale = 'en'): LauncherExecuteResult {
  const choice: LauncherResultChoice = {
    id: TEXT_OUTPUT_CHOICE_ID,
    title: text,
    preview: text,
    primaryAction: async () => {
      await api.copyText(text)
      api.showMessage(palette(locale, 'copied'), 'success')
    },
    secondaryActions: [
      {
        id: 'return-to-launcher',
        title: palette(locale, 'returnToLauncher'),
        icon: 'CornerDownLeft',
        run: async () => {
          await api.returnToLauncher(text)
          return { ok: true, keepOpen: true }
        },
      },
    ],
  }
  return { ok: true, output: { choices: [choice] } }
}
```

再把 `replaceActiveTextResult` 函数（当前 L67-88）整个替换成：

```ts
export function replaceActiveTextResult(text: string, api: PluginLauncherApi, locale: Locale = 'en'): LauncherExecuteResult {
  const choice: LauncherResultChoice = {
    id: REPLACE_ACTIVE_TEXT_OUTPUT_CHOICE_ID,
    title: text,
    preview: text,
    primaryAction: async () => {
      await api.replaceActiveText(text)
    },
    secondaryActions: [
      {
        id: 'copy',
        title: palette(locale, 'copy'),
        icon: 'Copy',
        run: async () => {
          await api.copyText(text)
          api.showMessage(palette(locale, 'copied'), 'success')
        },
      },
      {
        id: 'insert',
        title: palette(locale, 'insert'),
        icon: 'TextCursorInput',
        run: async () => {
          await api.insertText(text)
        },
      },
    ],
  }
  return { ok: true, output: { choices: [choice] } }
}
```

- [ ] **Step 4: 运行确认转绿**

Run: `node scripts/test-launcher-secondary-action-icons.mjs`
Expected: `✓ test-launcher-secondary-action-icons passed`

- [ ] **Step 5: 新增 `surfaceTextResult` 共享语境选择函数（Task 1 代码复核时发现的第二个调用方问题，见设计文档 §3.3.1）**

`textResult`/`replaceActiveTextResult` 不是只有 `toolAdapter.ts` 一个调用方。`src/workflow/pipelineLauncher.ts:74` 也会调用 `textResult`，且不看 `surfaceId`——如果不修，pipeline 结果在 Quick Editor 命令面板等 Pane 语境会从"能用的复制+插入"退化成"点了只会再开一个新 Quick Editor pane"。

先写失败测试。新建 `scripts/test-surface-text-result.mjs`：

```js
#!/usr/bin/env node
/**
 * test-surface-text-result.mjs
 *
 * Regression test for output.ts's surfaceTextResult(text, api, locale, surfaceId):
 * the shared surface-aware picker between textResult (Global Launcher, no bound
 * pane) and replaceActiveTextResult (pane-bound surfaces). Exists because
 * src/workflow/pipelineLauncher.ts calls this across three different surfaces
 * (global-launcher, editor-command-bar, quick-editor-command) and must pick the
 * right one per surface, same as toolAdapter.ts's makeOutput() already does
 * internally for plugin tools. See doc/2026-07-20-launcher-text-result-secondary-actions-redesign.md §3.3.1.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadModule(path, { stripImports = [], globals = {} } = {}) {
  let src = readFileSync(path, 'utf8')
  for (const re of stripImports) src = src.replace(re, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const stripTypeImports = [/import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g]
const stripI18nImport = /import\s*\{\s*translate,\s*type\s+Locale\s*\}\s*from\s*'[^']*\/i18n'\s*;?\s*\n?/
const translate = (locale, namespace, key) => key

const output = loadModule('src/workspace/launcher/output.ts', {
  stripImports: [
    ...stripTypeImports,
    stripI18nImport,
    /import\s*\{\s*normalizeLauncherSurfaceId\s*\}\s*from\s*'\.\/types'\s*;?\s*\n?/,
  ],
  globals: {
    translate,
    normalizeLauncherSurfaceId: (surfaceId) => surfaceId === 'command-palette' ? 'editor-command-bar' : surfaceId,
  },
})

assert.equal(typeof output.surfaceTextResult, 'function', 'output.ts must export surfaceTextResult')

const fakeApi = {
  copyText: async () => {},
  replaceActiveText: async () => {},
  insertText: async () => {},
  returnToLauncher: async () => {},
  showMessage: () => {},
}

const globalChoice = output.surfaceTextResult('6', fakeApi, 'zh', 'global-launcher').output.choices[0]
assert.equal(globalChoice.secondaryActions[0].id, 'return-to-launcher', 'global-launcher surface must resolve to textResult (return-to-launcher secondary action)')

for (const surfaceId of ['editor-command-bar', 'quick-editor-command', 'command-palette']) {
  const choice = output.surfaceTextResult('6', fakeApi, 'zh', surfaceId).output.choices[0]
  const ids = choice.secondaryActions.map((a) => a.id)
  assert.deepEqual(ids, ['copy', 'insert'], `surface "${surfaceId}" must resolve to replaceActiveTextResult (copy+insert), got [${ids.join(', ')}]`)
}

console.log('✓ test-surface-text-result passed')
```

Run: `node scripts/test-surface-text-result.mjs`
Expected: 抛 `AssertionError`，信息为 `output.ts must export surfaceTextResult`（函数还不存在）。

再实现。打开 `src/workspace/launcher/output.ts`，把顶部 import 块：

```ts
import type {
  LauncherExecuteResult,
  LauncherOutput,
  LauncherResultChoice,
  PluginLauncherApi,
} from './types'
import { translate, type Locale } from '../../i18n'
```

改成：

```ts
import type {
  LauncherExecuteResult,
  LauncherOutput,
  LauncherResultChoice,
  PluginLauncherApi,
} from './types'
import { normalizeLauncherSurfaceId } from './types'
import { translate, type Locale } from '../../i18n'
```

在 `replaceActiveTextResult` 函数（Step 3 刚替换完的那个）后面、`errorResult` 函数前面，新增：

```ts
/**
 * Pick the surface-appropriate text-output builder for a plain text result.
 * Global Launcher has no bound pane, so it gets textResult (primary=copy,
 * secondary=return-to-launcher); pane-bound surfaces (editor-command-bar,
 * quick-editor-command) get replaceActiveTextResult (primary=replace,
 * secondary=copy+insert). Shared by any host-owned launcher item that
 * produces text output across multiple surfaces (e.g. pipelineLauncher.ts).
 * toolAdapter.ts's per-tool makeOutput() has its own equivalent inline branch
 * and is intentionally left as-is (not this task's scope).
 */
export function surfaceTextResult(
  text: string,
  api: PluginLauncherApi,
  locale: Locale,
  surfaceId: string,
): LauncherExecuteResult {
  return normalizeLauncherSurfaceId(surfaceId) === 'global-launcher'
    ? textResult(text, api, locale)
    : replaceActiveTextResult(text, api, locale)
}
```

再打开 `src/workflow/pipelineLauncher.ts`，找到顶部（L2）：

```ts
import { textResult, errorResult } from '../workspace/launcher/output'
```

改成：

```ts
import { surfaceTextResult, errorResult } from '../workspace/launcher/output'
```

找到 `execute` 里（约 L74）：

```ts
        return textResult(output, ctx.api, ctx.locale as Locale)
```

改成：

```ts
        return surfaceTextResult(output, ctx.api, ctx.locale as Locale, ctx.surfaceId)
```

Run: `node scripts/test-surface-text-result.mjs`
Expected: `✓ test-surface-text-result passed`

Run: `npx tsc --noEmit`
Expected: `TypeScript compilation completed`，无错误（`ctx.surfaceId` 类型是 `LauncherSurfaceId`，赋给 `surfaceTextResult` 的 `surfaceId: string` 参数是合法的隐式收窄到更宽类型，方向和 `toolAdapter.ts` 现有的 `normalizeLauncherSurfaceId(surfaceId)` 用法一致）。

- [ ] **Step 6: Commit**

```bash
git add src/workspace/launcher/output.ts src/i18n/locales/palette.ts src/workflow/pipelineLauncher.ts scripts/test-launcher-secondary-action-icons.mjs scripts/test-surface-text-result.mjs
git commit -m "feat(launcher): textResult returns to launcher as Object Block; replaceActiveTextResult exposes insert; add surfaceTextResult for pipelineLauncher"
```

---

### Task 5: 接线 `GlobalLauncherHost.tsx` 的 `makeApi`

**Files:**
- Modify: `src/launcher/hosts/GlobalLauncherHost.tsx`

**依赖：** Task 3 必须先完成（`createGlobalLauncherPluginApi` 必须存在）。

**执行者：** 单 agent 直接处理（一行 hook 参数接线，React 组件层面在本仓库没有 DOM 测试基础设施可用，用 `tsc` + 架构检查 + 之后的手工验收替代；属 CLAUDE.md TDD 隔离例外，需在提交说明中显式声明降级）。

- [ ] **Step 1: 加 import**

打开 `src/launcher/hosts/GlobalLauncherHost.tsx`，找到现有 import 块里这一行（当前在文件顶部 import 区域）：

```ts
import { createPluginClipboard, writeClipboardText } from '../../workspace/pluginClipboard'
```

在它下面新增一行：

```ts
import { createGlobalLauncherPluginApi } from '../clipboard/globalLauncherApi'
```

（`GlobalLauncherHost.tsx` 位于 `src/launcher/hosts/`，`globalLauncherApi.ts` 位于 `src/launcher/clipboard/`，相对路径是 `../clipboard/globalLauncherApi`。）

- [ ] **Step 2: 传入 `makeApi`**

找到 `useLauncherSession({...})` 调用（约 L89-96）：

```ts
  } = useLauncherSession({
    hostId: 'global-launcher',
    open,
    requestClose: () => closeAfterActionRef.current(),
    collectDynamicWhenEmpty: true,
    objectBlockText,
    foregroundApp,
  })
```

改成：

```ts
  } = useLauncherSession({
    hostId: 'global-launcher',
    open,
    requestClose: () => closeAfterActionRef.current(),
    collectDynamicWhenEmpty: true,
    objectBlockText,
    foregroundApp,
    makeApi: createGlobalLauncherPluginApi,
  })
```

（`useLauncherSession` 的 `makeApi` 签名是 `(api: PluginLauncherApi, item?: LauncherItem) => PluginLauncherApi`；`createGlobalLauncherPluginApi(baseApi: PluginLauncherApi): PluginLauncherApi` 忽略多余的 `item` 参数，和 `QuickEditorCommandOverlay.tsx:48` 的 `makeApi: createQuickEditorLauncherApi` 是同一种写法，直接把函数引用传进去即可，不需要包一层箭头函数。）

- [ ] **Step 3: 编译验证**

**重要：不要用 `npx tsc --noEmit`。** 根目录 `tsconfig.json` 是 `"files": []` + `references` 的 solution 式配置，不带 `-b` 时它不检查任何文件，永远静默成功——Task 4 实施时才发现这个坑（此前整个会话一直在跑这个空检查，还以为通过）。真正会检查 `src/**` 的是 `tsconfig.app.json`。

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.app.json 2>&1 | grep -c "error TS"`
Expected: 输出一个数字，应该是 **246**（这是本计划开工前就存在的历史基线错误数，和本任务无关，不需要也不应该去修）。如果比 246 大，说明这次改动引入了新的类型错误，需要用不带 `grep -c` 的完整命令（`./node_modules/.bin/tsc --noEmit -p tsconfig.app.json`）看输出，确认新增的那几行是不是提到了 `src/launcher/hosts/GlobalLauncherHost.tsx`——如果是，修掉；如果新增错误在这次任务完全没碰过的文件里，说明基线数字本身随其它并行改动漂移了，属于既有债务，不是本任务引入的，可以放行但要在报告里说明白。

- [ ] **Step 4: Commit**

```bash
git add src/launcher/hosts/GlobalLauncherHost.tsx
git commit -m "feat(launcher): wire createGlobalLauncherPluginApi into GlobalLauncherHost's useLauncherSession"
```

---

### Task 6: 仓库级验证 + 全量回归

**Files:** 无新改动，只跑验证命令。

**执行者：** 主 agent / 验收 agent（不得是 Task 2-4 的实现 agent 本人签字确认；如果单 agent 执行本计划全过程，本任务必须作为独立最后一步，重新完整跑一遍，不得复用之前任务里跑过一次就当数）。

- [ ] **Step 1: 类型检查**

同 Task 5 Step 3 的重要提示——**不要用 `npx tsc --noEmit`**（根 `tsconfig.json` 是空的 solution 配置，永远静默通过，检查不到任何文件）。

Run: `./node_modules/.bin/tsc --noEmit -p tsconfig.app.json 2>&1 | tee /tmp/tsc-task6.txt | grep -c "error TS"`
Expected: 数字应该 ≤ 246（本计划开工前就存在的历史基线，见 Task 5 Step 3 的说明；Task 5 如果新增了 `GlobalLauncherHost.tsx` 相关错误，数字会比 246 大，需要先在 Task 5 修掉才能到这一步）。

再跑：`grep -E "src/workspace/launcher/(output|pluginApi|types)\.ts|src/launcher/clipboard/(objectBlock|globalLauncherApi|pendingObjectBlock)\.ts|src/workflow/pipelineLauncher\.ts|src/launcher/hosts/GlobalLauncherHost\.tsx" /tmp/tsc-task6.txt`
Expected: 只应该看到 `src/workspace/launcher/pluginApi.ts(211,5): error TS2322: Type '() => Promise<void>' is not assignable to type '() => Promise<string | undefined>'.` 这一条——这是 `showEditorWindow` 字段的历史遗留错误（`git show 748a9d9:src/workspace/launcher/pluginApi.ts` 可以确认这行在本计划开工前就已经这样），和本计划任何一个任务都无关，不用修。如果这个 grep 出现了任何其它行，说明本计划的某个任务引入了未被发现的新类型错误，需要停下来定位是哪个任务、回去修，不要在 Task 6 里顺手改。

- [ ] **Step 2: 架构边界检查**

Run: `npm run check:architecture`
Expected: `Architecture boundary check passed.`

- [ ] **Step 3: 空白/换行检查**

Run: `git diff --check`
Expected: 无输出（无尾随空白等问题）

- [ ] **Step 4: 构建**

Run: `npm run build`
Expected: 以 `✓ built in` 结尾，无报错（chunk size 警告是既有噪音，忽略）

- [ ] **Step 5: 重跑本次新增/修改的回归脚本**

Run:
```bash
node scripts/test-object-block-tool-result-factory.mjs
node scripts/test-global-launcher-plugin-api.mjs
node scripts/test-launcher-secondary-action-icons.mjs
node scripts/test-surface-text-result.mjs
```
Expected: 四行 `✓ ... passed`

- [ ] **Step 6: 重跑本会话之前已经建好的相邻回归脚本，确认没有连带破坏**

Run:
```bash
node scripts/test-launcher-resize-key-preview-signal.mjs
node scripts/test-launcher-registry.mjs
node scripts/test-app-launcher-contract.mjs
node scripts/test-calculator-command-mode.mjs
```
Expected: 四行通过（各自的具体 `passed` 文案不同，但都必须是成功输出，非 `Error`/非 exit 1）

- [ ] **Step 7: `git log` 核对本计划的 6 个 commit 都落地了，且各自改动面不缺东西**

这个仓库在本计划开工前，工作区里已经有大量和本计划无关的、更早会话产生的未提交改动（resize-key 修复、次要动作图标修复、Tooltip 组件等）——Task 1 实施时就发现过一次（`types.ts` 的 commit 顺带带上了一个不相关的 `icon?: IconRef` 字段）。所以**不要**用"`git status --short` 应该为空"或"只应该看到这几个文件"来验收，那个假设不成立。

正确的核对方式：

Run: `git log --oneline -8`
Expected: 从新到旧能看到本计划 Task 1-5 的 5 个 commit（信息分别对应各任务 Step "Commit" 里写的 message），往下接回 `748a9d9 feat(launcher): switch-window L2 command...`（本计划开工前的 HEAD）。

对每个 commit 用 `git show --stat <sha>` 核对它至少包含该任务 Files 列表里要求的文件（允许因为工作区其它未提交改动被顺带带上几个不在列表里的文件——这是已知的、可接受的既有状况，不是本计划的缺陷；但**不允许**缺少列表里要求的文件）。

---

## 验收对照设计文档 §7

Task 6 全部通过后，逐条对照 `doc/2026-07-20-launcher-text-result-secondary-actions-redesign.md` §7 验收标准第 1-4 条和第 7 条（token 悬停提示、点击后不关闭且出现 Object Block、⌫ 可删除、Pane 语境两个按钮行为、pipeline 在 Pane 语境没有倒退）——这些条目涉及真实 UI 渲染和原生窗口行为，本计划的自动化测试只覆盖到"数据/逻辑层正确"，不覆盖"像素级渲染正确"。执行完 Task 1-6 后，需要请用户在跑起来的 app 里实际操作一遍这几条，我们不能替用户点 GUI 确认。
