# Launcher 交互优化 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标:** 让每个插件操作在 Launcher 里一步到位执行，消除二级选择；Global Launcher 结果写剪贴板
**架构:** 拆 plugin 的单 command+params 为多个独立 tool；复用已有 Object Block 剪贴板识别系统；增加 output routing 层区分 global/editor
**技术栈:** TypeScript, React, 现有 hiven plugin SDK

---

## Phase 1: 基础设施 — Output Routing

### Task 1: Tool Adapter 支持 Global Launcher 写剪贴板

**Files:**
- Modify: `src/workspace/launcher/toolAdapter.ts`
- Modify: `src/workspace/launcher/output.ts`

**Step 1:** 在 `output.ts` 新增 `copyResult` helper

```typescript
export function copyResult(
  text: string,
  api: PluginLauncherApi,
  locale: Locale,
): LauncherExecuteResult {
  return {
    ok: true,
    output: {
      choices: [{
        label: locale === 'zh' ? '已复制到剪贴板' : 'Copied to clipboard',
        value: text,
        primaryAction: {
          label: locale === 'zh' ? '复制' : 'Copy',
          execute: async () => { await api.copyText(text) },
        },
      }],
    },
  }
}
```

**Step 2:** 在 `toolAdapter.ts` 增加 surfaceId 感知

当 tool 在 global-launcher surface 执行时，`ctx.output.text(value)` 应该走 `copyResult` 而非 `replaceActiveText`。修改 `adaptToolToLauncherItem` 中 output 的构造逻辑：

```typescript
// 根据 surfaceId 决定 output 行为
const isGlobalLauncher = surfaceId === 'global-launcher'

const output: PluginToolOutput = {
  text(value: string) {
    if (isGlobalLauncher) {
      return copyResult(value, api, locale)
    }
    return replaceActiveTextResult(value, api, locale)
  },
  replaceActiveText(value: string) {
    if (isGlobalLauncher && !api.getActiveText()) {
      return copyResult(value, api, locale)
    }
    return replaceActiveTextResult(value, api, locale)
  },
  error(message: string) { return errorResult(message) },
  choices(choices) { return choicesResult(choices) },
}
```

**Step 3:** 确认 single-choice shortcut 仍然生效（controller 里 1 个 choice 直接执行 primaryAction）

**验证:**
- Build 通过
- 现有 editor-internal 命令行为不变
- Global Launcher 执行 tool 时结果写剪贴板

---

## Phase 2: 插件拆分 — 编解码类（6 个插件）

### Task 2: base64 拆分为两个独立 tool

**Files:**
- Modify: `src/plugins/base64/index.ts`

**变更:**
- 删除现有 `tools[0]`（带 params 的单 tool）
- 删除现有 `commands[0]`（带 params 的单 command）
- 新增两个 tools:

```typescript
tools: [
  {
    id: 'base64.encode',
    title: 'command.encode.title',       // "Base64 编码"
    subtitle: 'command.encode.description',
    icon: 'Binary',
    aliases: ['base64 encode', 'base64编码', 'b64 encode'],
    inputPolicy: { mode: 'auto' },
    run(ctx) {
      try {
        const result = btoa(unescape(encodeURIComponent(ctx.input.text)))
        return ctx.output.text(result)
      } catch (e: any) {
        return ctx.output.error('Error: ' + e.message)
      }
    },
    surfaces: { launcher: true, panel: true, pinnable: true },
  },
  {
    id: 'base64.decode',
    title: 'command.decode.title',       // "Base64 解码"
    subtitle: 'command.decode.description',
    icon: 'Binary',
    aliases: ['base64 decode', 'base64解码', 'b64 decode'],
    inputPolicy: { mode: 'auto' },
    run(ctx) {
      try {
        const result = decodeURIComponent(escape(atob(ctx.input.text.trim())))
        return ctx.output.text(result)
      } catch (e: any) {
        return ctx.output.error('Error: ' + e.message)
      }
    },
    surfaces: { launcher: true, panel: true, pinnable: true },
  },
],
```

- 保留 `ui.surfaces`（EncodeDecodeSurface）但评估是否还需要，或作为 Cmd+Enter 目标
- 更新 locale 文件新增 `command.encode.title` / `command.decode.title` 等 key

**验证:** Build 通过，Launcher 搜索 "base64" 出现两个命令

---

### Task 3: url 拆分

**Files:**
- Modify: `src/plugins/url/index.ts`
- Modify: `src/plugins/url/locales/zh.json`
- Modify: `src/plugins/url/locales/en.json`

**变更:** 同 Task 2 模式，拆为 `url.encode` + `url.decode`

---

### Task 4: html 拆分

**Files:**
- Modify: `src/plugins/html/index.ts`
- Modify: locale files

**变更:** 拆为 `html.encode` + `html.decode`

---

### Task 5: slashes 拆分

**Files:**
- Modify: `src/plugins/slashes/index.ts`
- Modify: locale files

**变更:** 拆为 `slashes.escape` + `slashes.unescape`

---

### Task 6: queryString 拆分

**Files:**
- Modify: `src/plugins/queryString/index.ts`
- Modify: locale files

**变更:** 拆为 `queryString.toJson` + `queryString.fromJson`

---

### Task 7: jwt 独立（无需拆分，去除多余 params）

**Files:**
- Modify: `src/plugins/jwt/index.ts`

**变更:** 确认只有 decode，去掉 `requireParamSelection`，确保 `surfaces.launcher: true`

---

## Phase 3: 插件拆分 — 格式化类（4 个插件）

### Task 8: json 拆分

**Files:**
- Modify: `src/plugins/json/index.ts`
- Modify: locale files

**变更:** 拆为 `json.prettify` + `json.compact`，保留 Surface UI 作为 Cmd+Enter 目标

---

### Task 9: css 拆分

**Files:**
- Modify: `src/plugins/css/index.ts`
- Modify: locale files

**变更:** 拆为 `css.prettify` + `css.compact`

---

### Task 10: sql 拆分

**Files:**
- Modify: `src/plugins/sql/index.ts`
- Modify: locale files

**变更:** 拆为 `sql.prettify` + `sql.compact`

---

### Task 11: xml 拆分

**Files:**
- Modify: `src/plugins/xml/index.ts`
- Modify: locale files

**变更:** 拆为 `xml.prettify` + `xml.compact`

---

## Phase 4: 插件拆分 — 转换类（3 个插件）

### Task 12: yaml 拆分

**Files:**
- Modify: `src/plugins/yaml/index.ts`
- Modify: locale files

**变更:** 拆为 `yaml.toJson` + `yaml.fromJson`（JSON→YAML）

---

### Task 13: csv 拆分

**Files:**
- Modify: `src/plugins/csv/index.ts`
- Modify: locale files

**变更:** 拆为 `csv.toJson` + `csv.fromJson`，Surface UI 后面单独做

---

### Task 14: sortJson 确认

**Files:**
- Modify: `src/plugins/sortJson/index.ts`

**变更:** 已是单操作，确认 `surfaces.launcher: true`，无 params

---

## Phase 5: 插件拆分 — 文本操作类（5 个插件）

### Task 15: case 拆分为 5 个命令

**Files:**
- Modify: `src/plugins/case/index.ts`
- Modify: locale files

**变更:** 拆为 `case.upper`、`case.lower`、`case.title`、`case.camel`、`case.snake`

---

### Task 16: lineTools 拆分

**Files:**
- Modify: `src/plugins/lineTools/index.ts`
- Modify: locale files

**变更:** 拆为 `lineTools.sort`、`lineTools.dedupe`、`lineTools.reverse`、`lineTools.join`、`lineTools.split`

---

### Task 17: lineAffix 拆分

**Files:**
- Modify: `src/plugins/lineAffix/index.ts`
- Modify: locale files

**变更:** 拆为 `lineAffix.prefix`、`lineAffix.suffix`、`lineAffix.wrap`（仍需参数输入 prefix/suffix 文本，用 `behavior: 'collect-input'`）

---

### Task 18: mdquote 拆分

**Files:**
- Modify: `src/plugins/mdquote/index.ts`
- Modify: locale files

**变更:** 拆为 `mdquote.add` + `mdquote.remove`

---

### Task 19: sqlin 拆分

**Files:**
- Modify: `src/plugins/sqlin/index.ts`
- Modify: locale files

**变更:** 拆为 `sqlin.string` + `sqlin.number`

---

## Phase 6: 插件拆分 — Hash + Count

### Task 20: hash 拆分

**Files:**
- Modify: `src/plugins/hash/index.ts`
- Modify: locale files

**变更:** 拆为 `hash.sha256`、`hash.sha1`、`hash.sha512`

---

### Task 21: count 确认

**Files:**
- Modify: `src/plugins/count/index.ts`

**变更:** 已是单操作，确认 Launcher 可见

---

## Phase 7: 剪贴板智能识别增强

### Task 22: 更新 actionRecommendation 映射到新 tool IDs

**Files:**
- Modify: `src/launcher/clipboard/actionRecommendation.ts`

**变更:**
- 更新 `JSON_ACTIONS`、`URL_ACTIONS`、`CSV_ACTIONS`、`SQL_ACTIONS`、`ENCODE_DECODE_ACTIONS` 等静态 action catalog
- 每个 action 的 `id` 对应新拆分的 tool id（如 `base64.decode`、`json.prettify`）
- 添加新的 kind 检测规则（如识别 YAML、query string）

---

### Task 23: 更新 actionExecutor 对接新 tool 执行

**Files:**
- Modify: `src/launcher/clipboard/actionExecutor.ts`

**变更:**
- 确保 `transformActionText` 里的变换逻辑和新 tool 的 `run()` 保持一致
- 如果 actionExecutor 直接内联了变换逻辑（已有），确认和 plugin 代码不重复；优先走 plugin tool 执行路径

---

### Task 24: clipboardSnapshot 增加 YAML / queryString 检测

**Files:**
- Modify: `src/launcher/clipboard/clipboardSnapshot.ts`

**变更:**
- 在 `detectClipboardType` 中增加 `yaml` 和 `query-string` 类型检测
- YAML: 以 `---` 开头 或 `key: value` 多行模式
- Query String: 匹配 `key=value&key=value` 模式

---

## Phase 8: Translate L0 即时翻译

### Task 25: translate 增加 dynamicItems 提供剪贴板即时翻译

**Files:**
- Modify: `src/plugins/translate/index.ts` (or `index.tsx`)

**变更:**
- 添加 `launcher.dynamicItems` provider
- 当 Launcher 打开时，如果剪贴板有内容，即时调用翻译 API 并返回动作项
- Execute 时结果写剪贴板
- Cmd+Enter 行为保留：打开翻译 Surface 并带入文本

---

## Phase 9: 清理与验证

### Task 26: 移除 base64 Surface 入口（保持命令形式）

**Files:**
- Modify: `src/plugins/base64/index.ts`

**变更:**
- 删除 `ui.surfaces` 配置
- 删除 `EncodeDecodeSurface` 组件引用（或保留文件但不注册）
- base64 完全通过命令形式工作

---

### Task 27: 更新 locale 文件

**Files:**
- Modify: 所有被拆分插件的 `locales/zh.json` 和 `locales/en.json`

**变更:**
- 新增每个拆分命令的 title / description key
- 确保中英文都覆盖

---

### Task 28: 全量构建验证

**Run:** `npm run build`
**Expected:** 无新增错误

---

### Task 29: 架构检查

**Run:** `npm run check:architecture`
**Expected:** 无违反 plugin 边界的新问题

---

## 依赖关系

```
Phase 1 (Task 1) — 基础设施，所有后续 Phase 依赖它
  ↓
Phase 2-6 (Task 2-21) — 插件拆分，可并行
  ↓
Phase 7 (Task 22-24) — 剪贴板识别增强，依赖 Phase 2-6 的新 tool ID
  ↓
Phase 8 (Task 25) — translate 即时翻译，独立
  ↓
Phase 9 (Task 26-29) — 清理与验证
```

## 批次建议

- **Batch 1:** Task 1 (基础设施)
- **Batch 2:** Task 2-7 (编解码类 6 个插件，可并行)
- **Batch 3:** Task 8-14 (格式化 + 转换类 7 个插件，可并行)
- **Batch 4:** Task 15-21 (文本操作 + Hash + Count 7 个插件，可并行)
- **Batch 5:** Task 22-25 (剪贴板 + translate)
- **Batch 6:** Task 26-29 (清理验证)
