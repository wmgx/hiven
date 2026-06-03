# 插件 SDK 注入统一 + i18n 模块化规范 设计方案

> 日期：2026-06-03
> 目标：消灭插件里 `../../workspace`、`../../store`、`../../i18n`、`../../kits/*` 这类丑陋的相对深路径 import；
> 统一第一方与外部插件的作者契约；为 i18n 建立"插件内 locale 文件 + 代码只写 key"的规范，并把宿主 500 行全局字典按模块拆分。

---

## 一、现状问题（研究结论）

### 1.1 两套互相矛盾的插件契约

| 维度 | 第一方插件 `src/plugins/textDiff` | 外部目录插件 `plugins/{dev,installed}` |
|---|---|---|
| 入口 | `import { definePlugin } from '@fluxtext/plugin'` | `globalThis.FluxTextPlugin`（注入式） |
| 组件依赖 | 相对 import `../../store` `../../i18n` `../../kits/*` | 仅注入的 `ui` 8 个原语 |
| 加载时机 | 编译期 bundle（`import.meta.glob` 静态 import） | 运行时动态 `import()` |
| 能力 | 强，但路径丑且暴露框架内部 | 弱，写不出 textDiff 这种渲染器 |

- 丑路径来源：`TextDiffRenderer.tsx:8-20` 的 `../../store`、`../../i18n`、`../../kits/diff/*`、`../../kits/ui/DualEditorView`。
- 自相矛盾：`doc/plugin-directory-convention.md:65` 明文规定"框架内部 `../workspace/*` 不属于插件作者契约，应使用注入 SDK"，但第一方插件自己违反了。
- 注入 SDK `pluginHostSdk.ts:37` 目前仅暴露 `{ definePlugin, effects, ui }`，`ui` 仅 8 个原语，缺 `react / i18n / kits / hooks`。

### 1.2 i18n 无规范

- `src/i18n.ts` 是 500 行编译期大 const，宿主文案与插件文案（`textDiff.*`、`diff.*`、`regex.*`、`core.regexTester.*`）全混在一起。
- 外部插件无法往这个编译期常量里加 key。
- 插件作者只能在 manifest 和每个 contribution 里内联 `titleI18n / labelI18n`，散落无规范。

### 1.3 已确认方向

- **插件组件统一走注入式 SDK**（扩展 `globalThis.FluxTextPlugin`，第一方插件也改注入）。
- **i18n 按模块拆分，连宿主全局字典一起拆**。

---

## 二、目标与非目标

### 目标
1. 扩展注入式 SDK，提供 `react`、`i18n`、`hooks`、`kits`、扩充 `ui`，使外部插件能力对齐第一方。
2. 第一方插件（textDiff）改为消费注入 SDK，去掉所有 `../../` 深路径 import。
3. 建立插件级 i18n 规范：插件包内放 locale 文件，宿主按 `pluginId` 命名空间注册，注入 `ctx.t` / `host.t`，代码只写 key。
4. 把宿主 `src/i18n.ts` 按模块（nav/editor/scripts/settings/palette/status/diff/regex/update…）拆成多文件聚合。

### 非目标
- 不改插件目录加载/安装机制（manifest、entry resolution、watch 等保持不变）。
- 不引入第三方 i18n 库（继续用现有轻量 `t(locale, key, vars)` 形态）。
- 不改 effect / 命令运行时协议。

---

## 三、SDK 注入设计

### 3.1 关键技术约束：解构时机

第一方插件被编译期 bundle，模块顶层执行时 `globalThis.FluxTextPlugin` **尚未安装**（`installPluginGlobals()` 只在运行时动态加载路径调用）。

**规则**：SDK 对象**禁止在模块顶层解构**，必须在组件函数体 / `run()` 函数体内获取。

为此提供一个稳定访问器（既适配 bundle，也适配运行时注入）：

```ts
// src/workspace/pluginHostSdk.ts 新增
export function getPluginHostSdk(): PluginHostSdk {
  if (typeof window !== 'undefined' && window.FluxTextPlugin) return window.FluxTextPlugin
  // bundle 场景兜底：首次访问时即时构建并安装
  const sdk = createPluginHostSdk()
  if (typeof window !== 'undefined') window.FluxTextPlugin = sdk
  return sdk
}
```

外部插件作者写法不变（顶层 `const { ... } = globalThis.FluxTextPlugin` 在运行时已注入，仍可用）；第一方插件在组件内调用 `getPluginHostSdk()`。

### 3.2 扩展后的 SDK 形状

```ts
export type PluginHostSdk = {
  definePlugin: typeof definePlugin
  react: typeof import('react')              // 共享宿主 React，插件不再自带
  effects: { replaceActiveText, createPane, status, ... }
  ui: PluginHostUi                           // 在现有 8 原语上扩充
  kits: {
    DualEditorView: typeof DualEditorView
    diff: { computeTextLineDiff, buildJsonDiffViewModel, buildDiffTree,
            buildSideLines, parseJson, canUseSemanticJsonDiff }
  }
  hooks: {
    useSettings(): Settings                  // 只读封装，替代 ../../store
    useLocale(): Locale
    usePaneText(paneId): string | undefined
  }
  i18n: {
    t(key: string, vars?): string           // 已绑定当前 locale + 插件命名空间
    locale: Locale
  }
}
```

要点：
- `react` 注入避免多份 React 实例（外部插件尤其重要）。
- `kits` 把可复用渲染组件（DualEditorView、diff 算法）作为官方能力暴露，textDiff 不再相对 import。
- `hooks` 是 store 的**只读**收敛封装，外部插件拿不到 `setState`，安全边界更清晰。
- `i18n.t` 已绑定命名空间（见第四节），插件代码只写短 key。

### 3.3 第一方插件改造示例（textDiff）

改造前（丑）：
```ts
import { useAppStore } from '../../store'
import { t } from '../../i18n'
import { computeTextLineDiff } from '../../kits/diff/lineDiff'
import { DualEditorView } from '../../kits/ui/DualEditorView'
```

改造后：
```ts
export function TextDiffRenderer({ inputs, host }: RendererProps<TextDiffInputs>) {
  const sdk = getPluginHostSdk()
  const { kits, hooks, i18n } = sdk
  const settings = hooks.useSettings()
  const t = i18n.t
  // kits.diff.computeTextLineDiff(...) / kits.DualEditorView
}
```

> 注：`definePlugin` / 类型仍可通过 `@fluxtext/plugin` 别名做**类型**导入（`import type`），运行值走注入。别名保留但收窄为"类型出口 + definePlugin"。

---

## 四、i18n 模块化与插件命名空间规范

### 4.1 宿主全局字典拆分

把 `src/i18n.ts` 拆成：

```text
src/i18n/
  index.ts          # 聚合 + 导出 t()、Locale、合并各模块
  locales/
    nav.ts          # nav.*
    editor.ts       # editor.*
    scripts.ts      # scripts.*
    pluginEditor.ts # pluginEditor.*
    debugger.ts     # debugger.*
    settings.ts     # settings.*
    palette.ts      # palette.*
    status.ts       # status.* / panel.* / renderer.*
    update.ts       # update.*
    # diff.* / regex.* / textDiff.* / core.* 迁出到对应插件 locale（见 4.2）
```

每个模块文件形如：
```ts
export const nav = {
  en: { 'nav.editor': 'Editor', ... },
  zh: { 'nav.editor': '编辑器', ... },
}
```

`index.ts` 合并所有模块为 `messages`，对外仍导出同名 `t(locale, key, vars)` 与 `Locale`，**调用方零改动**（向后兼容现有 `import { t } from '../i18n'` —— 目录即模块解析）。

### 4.2 插件级 i18n 规范

每个插件包内新增 locale 文件：

```text
<plugin-id>/
  manifest.json
  index.{js,ts}
  locales/
    en.json
    zh.json
```

`locales/zh.json`：
```json
{
  "compare.title": "文本对比",
  "diff.semanticEqual": "语义一致"
}
```

加载与注册：
- 宿主在加载插件时（运行时 `loadPluginEntry` / bundle `bundledPluginLoader`）读取 `locales/*.json`，以 `pluginId` 为命名空间注册进一个新的 i18n registry。
- 注入的 `i18n.t(key)` 自动加 `<pluginId>:` 前缀解析；命中插件命名空间则返回插件文案，否则回退宿主字典再回退 key。

```ts
// src/i18n/pluginI18nRegistry.ts（新增）
registerPluginMessages(pluginId, { en, zh })
makePluginT(pluginId, locale)  // 返回 (key, vars) => string
```

- contribution 的 `titleI18n / labelI18n` 仍保留（命令面板等静态展示场景需要无运行时的就地文案），但**新规范推荐**：`title` 写英文兜底，`titleI18n` 可省略，运行时 UI 用 `i18n.t('compare.title')`。文档明确两者边界，避免散落。

> 兼容：现有内联 `titleI18n` 不破坏，新增 locale 文件机制为增量。textDiff 作为首个样板迁移到 `locales/`。

---

## 五、改造范围清单

### 新增 / 改造文件
1. `src/workspace/pluginHostSdk.ts` — 扩展 SDK 形状，新增 `getPluginHostSdk()`、`react/kits/hooks/i18n`。
2. `src/i18n/` 目录 — 拆分宿主字典（替换原 `src/i18n.ts`，保持导出兼容）。
3. `src/i18n/pluginI18nRegistry.ts` — 插件 i18n 命名空间注册表。
4. `src/workspace/pluginRuntime.ts` / `bundledPluginLoader.ts` — 加载插件时读取并注册 `locales/*.json`。
5. `src/plugins/textDiff/` — 改用注入 SDK（去掉 4 处相对 import），新增 `locales/{en,zh}.json` 作样板。
6. `src/workspace/pluginScaffold.ts` — 脚手架模板加入 `locales/` 与 `i18n.t` 用法。
7. `doc/plugin-directory-convention.md` — 更新作者契约文档（注入 SDK 全量能力 + i18n 规范）。
8. `src/plugin-sdk.ts` — 收窄为类型出口 + `definePlugin`，注明运行值走注入。

### 不动
- 插件安装 / watch / manifest 解析 / effect 协议 / 命令运行时。

---

## 六、风险与权衡

| 风险 | 说明 | 缓解 |
|---|---|---|
| 解构时机 | 顶层解构在 bundle 期为空 | 强约束：组件/run 体内用 `getPluginHostSdk()`；脚手架与文档示范 |
| React 双实例 | 注入 react 后插件若仍自带会冲突 | 文档明确"用注入 react"；外部插件 externalize（现有 spike 已假设） |
| 宿主字典拆分回归 | 拆分易漏 key | 保持 `t()` 签名与 key 不变，仅物理拆文件；可加一个 key 计数校验脚本 |
| 插件 i18n 回退链 | key 未命中导致裸 key 显示 | 三级回退：插件命名空间 → 宿主字典 → key 原样 |

---

## 七、分阶段实施建议（TDD，职责隔离）

> 按全局规范，进入实现时测试 agent / 实现 agent / 验收 agent 分离。

- **Phase 1 — i18n 宿主拆分**：物理拆 `src/i18n.ts` → `src/i18n/`，保证 `t()` 行为与全部 key 不变。测试：快照所有 key 在拆分前后一致。
- **Phase 2 — 插件 i18n registry**：`pluginI18nRegistry` + 加载期注册 + `makePluginT`。测试：命名空间解析与三级回退。
- **Phase 3 — SDK 扩展**：`getPluginHostSdk` + `react/kits/hooks/i18n` 注入。测试：bundle 与运行时两种时机都能拿到完整 SDK。
- **Phase 4 — textDiff 迁移**：去相对 import + 接入 `locales/`，作为样板。测试：渲染器行为不回归（diff 高亮、语义模式、退出键）。
- **Phase 5 — 脚手架与文档**：更新 scaffold 模板与 convention 文档。

每阶段独立可验证、可提交。
