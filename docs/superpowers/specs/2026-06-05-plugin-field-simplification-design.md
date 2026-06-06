# 插件字段精简设计（去 definition 冗余 + 删除 tags + 彻底移除 legacy 体系）

> 日期：2026-06-05　状态：待用户确认　决策：路线 1（保留"包+多命令"模型，去顶层冗余）+ 删除 `tags`（范围 2，彻底）+ 彻底移除旧 legacy 插件体系（仅保留新 definePlugin 体系）

## 背景与问题

调研（含确切代码证据）确认三处设计问题：

1. **`PluginDefinition` 顶层与 `manifest.json` 字段重复**
   - 重复字段：`id↔pluginId`、`title↔displayName`、`version`。
   - 真相：注册链路全程用 **manifest 的 `pluginId`/`displayName`/`version`**；`definition.title`/`titleI18n` 是**死字段**（全仓零消费，命令展示用的是 command 级 `contribution.title`）；`definition.version` 仅做"是否字符串"的存在性校验，值从不被读；`definition.id` 仅用于 `validatePluginIdMatch` 与 manifest 比对一致性。
   - 证据：[pluginRuntime.ts](file:///Users/bytedance/flux_text/src/workspace/pluginRuntime.ts) 的 `enablePlugin`(L383-394 用 `record.pluginId` 注册)、`loadPluginEntry`(L220-225 仅存在性校验)、`validatePluginIdMatch`(L254-260)；`registerProductionPlugin` 只收 `pluginId + commands/renderers/panels`。

2. **`aliases` 与 `tags` 实质重叠**
   - 两者唯一消费点都是命令面板搜索的"子串包含即命中"（[CommandPalette.tsx](file:///Users/bytedance/flux_text/src/components/CommandPalette.tsx#L1100-L1104)），逻辑对称、无差别。
   - `tags` 没有用于任何分类/分组/过滤/展示，退化成了和 `aliases` 一样的"额外搜索关键词"。

3. **（已与用户澄清，不改）`params` vs `inputs`** 是合理分层，保留。

补充事实：33 个内置包中 **27 个为单 command，0 个多 command**（textDiff 等是 renderer 包）。命令面板当前是**纯扁平列表**，无任何分组渲染。

## 决策

- **路线 1**：保留"一个插件包可含多个 command"的通用模型，只删 definition 顶层冗余字段；单 command 仍写 `command.title`，但不再与 definition 重复。
- **id 一并删除**（用户确认）：双写消除后，`validatePluginIdMatch` 失去意义，一并移除。
- **2A**：`aliases` 保留作搜索别名；`tags` 升级为真正的分类（命令面板按类目分组展示 + 仍参与搜索）。

## 方案 A：去 definition 顶层冗余

### A1. 类型变更 — [pluginTypes.ts](file:///Users/bytedance/flux_text/src/workspace/pluginTypes.ts#L170-L178)

```ts
// 旧
export type PluginDefinition = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  version: string
  commands?: CommandContribution[]
  renderers?: RendererContribution[]
  panels?: PanelContributionV2[]
}

// 新：definePlugin 退化为"纯贡献声明"，包身份/元数据完全由 manifest.json 承载
export type PluginDefinition = {
  commands?: CommandContribution[]
  renderers?: RendererContribution[]
  panels?: PanelContributionV2[]
}
```

### A2. 加载校验改判据 — [pluginRuntime.ts](file:///Users/bytedance/flux_text/src/workspace/pluginRuntime.ts#L207-L247)

`loadPluginEntry` / `loadDevPluginEntry` 不再用 `id/version` 缺失判断合法性，改为"default export 是否为对象且含 `commands`/`renderers`/`panels` 至少之一"：

```ts
function isPluginDefinition(value: unknown): value is PluginDefinition {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.commands) || Array.isArray(v.renderers) || Array.isArray(v.panels)
}
```
缺失则抛"不是合法插件入口"。

### A3. 移除 `validatePluginIdMatch`

删除函数定义（L254-260）及其全部调用（enable/reload/sideload 三处，约 L384/L455/L547/L592）。包身份单一来源 = manifest.pluginId。

### A4. `definePlugin` 包装函数

`definePlugin` 入参类型同步收窄为新 `PluginDefinition`；去掉对 `id/version` 的存在性校验（见 src/workspace/definePlugin.ts）。

### A5. 改 33 个插件包 index.ts

删除每个 `definePlugin({ ... })` 里的 `id` / `title` / `version` 三行，仅留 `commands`/`renderers`/`panels`。例（jwt）：

```ts
// 旧
export const jwtPlugin = definePlugin({
  id: 'jwt',
  title: 'JWT Decode',
  version: '1.0.0',
  commands: [ /* ... */ ],
})
// 新
export const jwtPlugin = definePlugin({
  commands: [ /* ... */ ],
})
```

> 注意：`manifest.json` 已含 `pluginId`/`displayName`/`displayNameI18n`/`version`，是这些信息的唯一来源，无需在 index.ts 重复。

### A6. dev 调试解析 — [pluginDebugRunner.ts](file:///Users/bytedance/flux_text/src/workspace/pluginDebugRunner.ts)

`parsePluginDefinitionSource` 当前以 `typeof value.id !== 'string'` 判定有效性（L20），改为用 A2 的 `isPluginDefinition` 判据。

## 方案 B：删除 `tags` 字段（不做分类逻辑）

`tags` 当前唯一作用是命令面板搜索的"子串匹配"，与 `aliases` 完全重叠。用户决定：**直接删除 `tags`**，搜索别名能力由 `aliases` 承担，不引入分类逻辑。

### B1. 新插件模型删除 `tags`

- [pluginTypes.ts](file:///Users/bytedance/flux_text/src/workspace/pluginTypes.ts#L100) `CommandContribution.tags` 删除。
- 33 个 `src/plugins/*/index.ts`、[textDiff/index.ts](file:///Users/bytedance/flux_text/src/plugins/textDiff/index.ts#L18)、[corePlugin.ts](file:///Users/bytedance/flux_text/src/workspace/corePlugin.ts)（3 处）、[pluginScaffold.ts](file:///Users/bytedance/flux_text/src/workspace/pluginScaffold.ts#L67) 删除 `tags: [...]` 行。
- [workspaceCommands.ts](file:///Users/bytedance/flux_text/src/commands/workspaceCommands.ts)（2 处）删除。

### B2. 旧 legacy 模型删除 `tags`

`tags` 也存在于 legacy `ActionDef`（[store.ts:107](file:///Users/bytedance/flux_text/src/store.ts#L107)、[store.ts:137](file:///Users/bytedance/flux_text/src/store.ts#L137) `ActionParam`? 实为 ActionDef）与 [types.ts:79](file:///Users/bytedance/flux_text/src/workspace/types.ts#L79)。

> **范围（已定）**：采用**范围 2（彻底）**——`tags` 在新插件模型与旧 legacy 模型中全部删除。由于方案 C 会整体移除 legacy 体系，legacy `ActionDef.tags` 会随 `ActionDef` 一起消失，因此 tags 删除与方案 C 合并执行。命令面板 [CommandPalette.tsx:1103-1104](file:///Users/bytedance/flux_text/src/components/CommandPalette.tsx#L1103-L1104) 的 tags 搜索分支删除。

### B3. 命令面板搜索匹配 — [CommandPalette.tsx:1103-1104](file:///Users/bytedance/flux_text/src/components/CommandPalette.tsx#L1103-L1104)

删除 `paletteItemMatchesQuery` 中的 tags 匹配分支。`aliases` 分支保留。

### B4. aliases 不变

保留作"搜索别名"，仅参与搜索匹配。

## 方案 C：彻底移除 legacy 插件/action 体系

调研结论：项目存在新旧两套体系。新体系 = `definePlugin`/`CommandContribution`/`pluginRegistry`/`pluginRuntime`（`src/plugins/*`）。旧 legacy 体系 = `ActionDef`/`ActionContext`/`actions` 数组/`registerAction`/`runLegacyAction` 等。决策：**彻底删除 legacy，后续只维护新体系**。

### C0. 唯一硬阻塞：先迁移分屏/关闭面板命令（必做前置）

legacy `workspaceActions`（[workspaceCommands.ts](file:///Users/bytedance/flux_text/src/commands/workspaceCommands.ts)）的两个命令 `splitRightAction`（分屏）、`closePaneAction`（关闭当前面板）在新插件体系**无对应**，底层能力（`createPane`/`closeActiveSurfaceOrPane`/`workspace.split` effect）仍在但未被任何 plugin command 暴露。**直接删 legacy 会丢失这两个命令面板入口。**

迁移方案：在 [corePlugin.ts](file:///Users/bytedance/flux_text/src/workspace/corePlugin.ts) 新增两条 CommandContribution（如 `core.split-right`、`core.close-pane`），run 内分发对应 effect（`workspace.split` / 关闭面板 effect），复用现有 core plugin 注册链路。迁移后命令面板/Pin 入口不丢。

> 注意：corePlugin 的命令同样要遵守方案 A/B（无 definition 顶层冗余、无 tags）。

### C1. 删除 legacy 数据源

- 删除 [src/actions/builtins.ts](file:///Users/bytedance/flux_text/src/actions/builtins.ts)（`builtinActions` 已是空数组）及 store 的 import/展开。
- 删除 [src/commands/workspaceCommands.ts](file:///Users/bytedance/flux_text/src/commands/workspaceCommands.ts) 整个文件（能力已由 C0 迁移到 corePlugin）。

### C2. store.ts 删除 legacy 符号

- 删 `actions: ActionDef[]` 字段（[store.ts:189/445](file:///Users/bytedance/flux_text/src/store.ts#L189)）及 `registerAction`（声明+实现）。
- `pinAction` 收窄为只接受 `string`/plugin（删 `ActionDef` 分支与 `_actionToPinnedAction`、store 内 `shouldAutoRunLiveAction` 副本）。
- `PinnedActionKind` 收窄为 `'plugin-command'`。
- 删 `ActionDef`、`ActionContext` 接口。
- **`ActionParam` 处理（已定：改名）**：它被 CommandPalette 的 `normalizePluginParams` 复用为 plugin 参数归一化目标类型（[CommandPalette.tsx:1198-1210](file:///Users/bytedance/flux_text/src/components/CommandPalette.tsx#L1198-L1210)）。**决策：改名为 `PaletteParamModel`**，彻底去掉 "Action" legacy 字样，明确其语义为"命令面板参数 UI 渲染模型"。需同步更新 store.ts 定义、CommandPalette.tsx、PinnedRunnerView.tsx（`ControlParam = ActionParam | CommandParam` → `PaletteParamModel | CommandParam`）等所有引用点。

### C3. 持久化兼容

`pinnedActions` 被 persist（[store.ts:522](file:///Users/bytedance/flux_text/src/store.ts#L522)），历史用户可能存有 `kind:'legacy'` 的 pinned 数据。收窄 kind 后需在 rehydrate/读取时**丢弃**这些 legacy pinned 项（它们已无 ActionDef 可解析），避免渲染崩溃。

### C4. CommandPalette / PinnedRunner / GlobalLauncher 收敛

- [CommandPalette.tsx](file:///Users/bytedance/flux_text/src/components/CommandPalette.tsx)：`PaletteItem` 退化为单一 `{kind:'plugin'}`；删除 `runAction`/`selectAction`/`runLegacyAction` legacy 执行路径、所有 `kind==='legacy'` 三元分支、legacy items 收集（`:103-110`）。
- [PinnedRunnerView.tsx](file:///Users/bytedance/flux_text/src/views/PinnedRunnerView.tsx)：删 legacy 执行分支（`:68-70/95-105`）与 `ActionContext` 依赖。
- [GlobalLauncher.tsx](file:///Users/bytedance/flux_text/src/components/GlobalLauncher.tsx)：recent 项 title 反查从 `actions` 改为查 `pluginRegistry`（否则 recent 只显示原始 id）。
- 删 [commandAdapter.ts](file:///Users/bytedance/flux_text/src/workspace/commandAdapter.ts)（`runLegacyAction`/`adaptLegacyResult`）。

### C5. 对外扩展 API 决策

`registerCommand`（[pluginApi.ts:37-48](file:///Users/bytedance/flux_text/src/workspace/pluginApi.ts#L37-L48)）经 [index.ts:64](file:///Users/bytedance/flux_text/src/workspace/index.ts#L64) 作为 `fluxtext/workspace` 公共 API 导出，但**仓库内零调用**。随 `registerAction` 一并删除（破坏性 API 变更，但无一方依赖）。

### C6. disabled 机制

`disabledBuiltins`/`disabledCustoms`（[CommandPalette.tsx:107-108](file:///Users/bytedance/flux_text/src/components/CommandPalette.tsx#L107-L108)）当前仅对 legacy items 生效。删 legacy 后这套过滤变空操作；本次**一并清理**该过滤代码（plugin 的启用/禁用已由 ScriptsView 的 enable/disable 承担）。

## 影响面与改动清单

| 区域 | 文件 | 改动 |
|------|------|------|
| 类型 | pluginTypes.ts | PluginDefinition 删 id/title/titleI18n/version；CommandContribution 删 tags |
| 加载 | pluginRuntime.ts | 改判据 + 删 validatePluginIdMatch 及调用 |
| 调试 | pluginDebugRunner.ts | 改判据 |
| 包装 | definePlugin.ts | 收窄类型、去 id/version 校验 |
| 插件 | src/plugins/*/index.ts ×33（+textDiff） | 删 id/title/version + tags |
| core | corePlugin.ts | 新增 split/close-pane 命令（C0）；删 tags |
| scaffold | pluginScaffold.ts | 删 tags |
| legacy 数据 | builtins.ts / workspaceCommands.ts | 整文件删除 |
| legacy 适配 | commandAdapter.ts / pluginApi.ts / workspace/index.ts | 删 runLegacyAction、registerCommand 及导出 |
| store | store.ts | 删 actions/registerAction/ActionDef/ActionContext；pinAction & PinnedActionKind 收窄；persist 丢弃 legacy pinned |
| 面板 | CommandPalette.tsx | 删 legacy 分支与 tags 搜索分支、disabled 过滤；PaletteItem 单一化 |
| 视图 | PinnedRunnerView.tsx / GlobalLauncher.tsx | 删 legacy 执行/反查分支 |
| 测试 | test-*.mjs | 同步断言（移除 definition.id/title/version、tags、legacy 相关） |

## 风险与权衡

- **执行顺序硬约束**：必须先 C0（迁移 split/close-pane 到 corePlugin）→ 再删 legacy，否则功能回退。
- **持久化**：必须处理已存的 `kind:'legacy'` pinned 数据（丢弃），否则旧用户启动可能渲染异常。
- A（去 definition 冗余）、B（删 tags）、C（删 legacy）相互独立但有交集，建议**分 commit**：commit1=C0 迁移、commit2=A、commit3=B+C 删除。
- definition 删 `id` 后包身份完全依赖 manifest.pluginId，与"目录扫描先于入口加载"架构一致，无冲突。
- 改 33 个包是机械改动，用 subagent 批量执行并 1:1 核对保真；legacy 删除涉及命令面板核心交互，需人工复核命令面板/Pin/分屏功能。

## 验证基线

tsc --noEmit 零新增错误、`check:architecture`、`npm run build`、`test:plugin-goal-suite`（含 cargo 单测）全绿；人工验证：命令面板能搜到并执行分屏/关闭面板、Pin 功能正常、插件命令正常。
