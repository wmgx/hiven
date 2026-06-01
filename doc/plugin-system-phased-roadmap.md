# FluxText Plugin System Phased Roadmap

## 目标

FluxText 的插件系统要解决三类扩展：

1. 文本命令：例如 trim、sort、json format。
2. 工作区命令：例如 split pane、diff panes、open preview。
3. 可视化能力：例如 JSON diff renderer、regex panel、markdown preview。

核心目标不是做一个插件 IDE，而是让 FluxText 拥有稳定的扩展内核：

```text
Plugin Package -> Contributions -> Registry -> Command -> Inputs -> Effects -> Surface / Renderer
```

插件系统必须满足：

```text
简单插件足够轻
复杂插件不会被“1 插件 = 1 命令”卡死
插件不直接操作 workspace store
UI view 有清晰生命周期
第三方插件可以导入、启用、禁用、卸载
未来可以扩展权限、市场、跨插件复用，但 Phase 1 不提前做重
```

## 明确不做：插件编辑器

插件编辑器能力下线，不进入 Phase 1/2/3 主路线。

不再建设：

```text
内置插件 IDE
Draft 编辑流
manifest 可视化编辑器
在线创建完整插件
插件调试 console 面板
插件打包导出
```

原因：

```text
维护成本高，会把插件系统拖成插件开发环境
会提前引入编译、依赖、热重载、错误定位等复杂问题
与 FluxText 轻量文本工具定位冲突
当前已经有 Scripts 能覆盖单文件 text transform 的用户需求
```

保留现状：

```text
Scripts 继续作为单文件命令能力
Scripts 面向普通用户和轻量文本转换
Plugin 面向开发者和完整扩展能力
Plugin 通过本地目录或插件包导入，不在 FluxText 内编辑
```

保留开发态隔离：

```text
Dev Registry 必须保留
Dev Registry 是运行时隔离边界，不是插件编辑器 UI
Dev 插件通过本地路径 side-load 或 watch mode 进入系统
Dev contribution 在 Command Palette 中显示 [DEV]
Dev contribution 不写入正式安装状态
Dev contribution 不覆盖 production registry
```

判断：

```text
可以砍插件编辑器 UI
不能砍 dev-registry / production-registry 隔离
```

## 核心概念

### Plugin Package

插件包是安装单位。

一个插件包包含：

```text
manifest.json
entry.js / entry.tsx build output
assets
README
```

插件包可以贡献多个 command、renderer、panel。

### Contribution

Contribution 是插件贡献给系统的能力单位。

Phase 1 支持三类：

```text
command
renderer
panel
```

示例：

```text
pluginId = json-tools

commands:
  json-tools.format
  json-tools.compact
  json-tools.diff

renderers:
  json-tools.object-diff
  json-tools.tree

panels:
  json-tools.inspector
```

### Registry

Registry 是 contribution 的索引。

Phase 1 使用两套 registry：

```text
production registry:
  正式安装并启用的插件

dev registry:
  从本地路径 side-load 的开发态插件
  后续可扩展为 watch mode
  session scoped
  可 reload
  不写入正式安装状态
```

每套 registry 内部包含：

```text
CommandRegistry
RendererRegistry
PanelRegistry
```

每个 contribution id 在同一 registry 内必须唯一，并且默认必须以 pluginId 为前缀。

查询时按明确来源解析：

```text
用户执行 [DEV] command:
  使用 dev registry 的 command/renderer/panel

用户执行正式 command:
  使用 production registry 的 command/renderer/panel
```

Phase 1 不做 dev contribution 覆盖 production contribution。即使 pluginId 相同，也显示为两套来源，避免草稿污染正式系统。

### Command

Command 是用户入口，表达一次用户意图。

Command 只做三件事：

```text
声明需要哪些 inputs
接收 resolved inputs 和 params
返回 effects
```

Command 不直接操作 store，不直接 mount React view，不直接调用其他插件组件。

### Inputs

Inputs 是命令需要的输入槽，不是普通参数。

例如 diff 需要：

```text
original pane
modified pane
```

这不是普通 `pane-select` 参数，而是 InputResolver 要解析的结构化输入。

### Params

Params 是命令配置。

例如：

```text
ignoreWhitespace
renderMode: side-by-side / inline
formatMode: pretty / compact
```

判断标准：

```text
如果它决定“命令作用于谁”，就是 input
如果它决定“命令怎么运行”，就是 param
```

### Effect

Effect 是不可变副作用描述。

Command 返回 effects，EffectRunner 是唯一执行者。

### Surface

Surface 是 UI 承载位。

Phase 1 只做：

```text
pane
panel
```

Phase 2 再考虑：

```text
overlay
```

### Renderer

Renderer 是附着在 surface 上的 React component contribution。

Renderer 由 RendererHost mount/unmount。

Renderer 不拿 command run 的 ctx，不直接 subscribe workspace store。

Renderer 通过 props 和 host API 获取输入、请求关闭、发起受控 effect。

## ID 规则

### pluginId

`pluginId` 是插件身份，必须全局唯一。

```text
displayName 可以重复
文件夹名可以重复
pluginId 不可重复
```

Phase 1 规则：

```text
安装时如果 pluginId 已存在，提示覆盖 / 取消
启用状态下不允许两个插件拥有相同 pluginId
```

### contributionId

Contribution id 必须全局唯一。

推荐规则：

```text
${pluginId}.${name}
```

例如：

```text
json-tools.diff
json-tools.object-diff
core.monaco-diff
```

Phase 1 不支持跨插件 renderer 复用，但仍然按全局 contributionId 设计，避免后续改模型。

## 插件 API 草案

### definePlugin

```ts
export default definePlugin({
  id: 'json-tools',
  title: 'JSON Tools',
  version: '1.0.0',

  commands: [
    {
      id: 'json-tools.diff',
      title: 'JSON Diff',
      inputs: [
        { key: 'original', label: 'Original', kind: 'pane', required: true },
        { key: 'modified', label: 'Modified', kind: 'pane', required: true },
      ],
      inputResolution: {
        strategy: 'auto-fill',
        fallback: 'prompt',
      },
      params: [
        {
          key: 'renderMode',
          label: 'Render Mode',
          type: 'single-select',
          options: ['side-by-side', 'inline'],
          default: 'side-by-side',
        },
      ],
      run(ctx) {
        return {
          effects: [
            {
              type: 'pane.setRenderer',
              paneId: ctx.inputs.original.paneId,
              renderer: 'json-tools.object-diff',
              inputs: {
                original: ctx.inputs.original,
                modified: ctx.inputs.modified,
                renderMode: ctx.params.renderMode,
              },
            },
          ],
        }
      },
    },
  ],

  renderers: [
    {
      id: 'json-tools.object-diff',
      title: 'JSON Object Diff',
      inputKinds: ['pane', 'pane'],
      component: JsonObjectDiffRenderer,
    },
  ],

  panels: [
    {
      id: 'json-tools.inspector',
      title: 'JSON Inspector',
      component: JsonInspectorPanel,
    },
  ],
})
```

### 简单插件

简单插件依旧可以只有一个 command。

```ts
export default definePlugin({
  id: 'trim',
  title: 'Trim',
  version: '1.0.0',

  commands: [
    {
      id: 'trim.run',
      title: 'Trim Whitespace',
      inputs: [
        { key: 'input', label: 'Input', kind: 'text', required: true },
      ],
      inputResolution: {
        strategy: 'use-active',
        fallback: 'fail',
      },
      run(ctx) {
        return {
          effects: [
            {
              type: 'text.replace',
              target: 'active-input',
              text: ctx.inputs.input.text.trim(),
            },
          ],
        }
      },
    },
  ],
})
```

## Command 执行流程

```text
用户触发 command
  -> CommandRegistry 查找 CommandContribution
  -> InputResolver 根据 inputs + inputResolution 解析输入
  -> ParamResolver 收集 params
  -> 构造 CommandContext
  -> command.run(ctx)
  -> 返回 CommandResult { effects }
  -> EffectRunner.apply(effects)
  -> SurfaceManager / WorkspaceStore / MonacoBridge 应用具体变化
  -> RendererHost 根据 surface state mount 或更新 renderer
```

不变式：

```text
command.run 不直接改 store
command.run 不直接 mount React component
command.run 不直接 import 其他插件的 view
所有 UI 状态变更都必须走 EffectRunner
```

## Inputs 与 Params 设计

### InputSlot

```ts
type InputSlot = {
  key: string
  label: string
  kind: 'pane' | 'text'
  required: boolean
}
```

Phase 1 只支持：

```text
pane
text
```

暂不支持：

```text
file
clipboard as first-class input
url
workspace selection set
```

### InputResolution

```ts
type InputResolution = {
  strategy: 'use-active' | 'auto-fill' | 'always-prompt'
  fallback: 'prompt' | 'fail'
}
```

解释：

```text
use-active:
  优先使用 active pane / active selection。

auto-fill:
  系统根据当前 workspace 自动填充。
  例如当前正好 2 个 pane，diff 的 original / modified 可以自动填充。

always-prompt:
  总是弹输入选择 UI。

fallback: prompt:
  自动填充失败时弹选择器。

fallback: fail:
  自动填充失败时直接报错。
```

### Diff 输入策略

Diff 命令推荐：

```ts
inputs: [
  { key: 'original', label: 'Original', kind: 'pane', required: true },
  { key: 'modified', label: 'Modified', kind: 'pane', required: true },
],
inputResolution: {
  strategy: 'auto-fill',
  fallback: 'prompt',
}
```

解析规则：

```text
当前 1 个 pane:
  auto-fill 失败
  fallback prompt
  选择器引导用户选择或创建第二个 pane

当前 2 个 pane:
  original = paneOrder[0]
  modified = paneOrder[1]

当前 3+ 个 pane:
  如果 previousActivePaneId 和 activePaneId 都存在，作为默认值
  仍弹 prompt 让用户确认
```

## Effect 设计

Phase 1 支持：

```ts
type Effect =
  | { type: 'text.replace'; target: 'active-input' | { paneId: string; range?: unknown }; text: string }
  | { type: 'pane.create'; pane?: { text?: string; language?: string; title?: string }; focus?: boolean }
  | { type: 'pane.close'; paneId: string }
  | { type: 'pane.setRenderer'; paneId: string; renderer: string; inputs: unknown }
  | { type: 'pane.clearRenderer'; paneId: string }
  | { type: 'panel.open'; panelId: string; placement?: 'bottom' | 'right' | 'left'; inputs?: unknown }
  | { type: 'panel.close'; instanceId: string }
  | { type: 'status.message'; level: 'info' | 'success' | 'warning' | 'error'; message: string }
```

Phase 1 不做：

```text
overlay.open
workspace arbitrary layout graph
monaco.diff.updateOptions as public plugin API
network / fs effects
cross-plugin renderer fallback
```

内部可以继续保留 MonacoBridge，但不要急着作为完整公共插件 API 暴露。

## Surface / Renderer 生命周期

### SurfaceState

```ts
type SurfaceState = {
  id: string
  kind: 'pane' | 'panel'
  rendererId: string | null
  rendererInputs: unknown
  ownerPluginId?: string
  ownerContributionId?: string
}
```

### pane.setRenderer

流程：

```text
EffectRunner 收到 pane.setRenderer
  -> RendererRegistry.resolve(renderer)
  -> 如果找不到，发 status.message，不 throw
  -> SurfaceManager 更新 pane surface state
  -> RendererHost 看到 state 变化
  -> mount renderer component
```

### pane.clearRenderer

流程：

```text
EffectRunner 收到 pane.clearRenderer
  -> SurfaceManager 清空 renderer state
  -> RendererHost unmount renderer
  -> pane 恢复普通 Monaco editor
```

### 插件禁用

流程：

```text
用户禁用插件
  -> PluginRuntime dispose
  -> Registry 移除该 plugin 的 contributions
  -> SurfaceManager 找到正在使用该 plugin renderer/panel 的 surface
  -> 清空或显示 fallback
  -> 发 status.message 提示相关 view 已关闭
```

### RendererProps

```ts
type RendererProps<TInputs = unknown> = {
  inputs: TInputs
  surfaceId: string
  host: RendererHostApi
}

type RendererHostApi = {
  close: () => void
  dispatch: (effects: Effect[]) => void
  getPaneText: (paneId: string) => string | null
}
```

约束：

```text
Renderer 不直接 import workspace store
Renderer 不直接 import 其他插件 component
Renderer 需要关闭自己时调用 host.close()
Renderer 需要修改系统状态时调用 host.dispatch(effects)
```

## Manifest 设计

Phase 1 manifest：

```json
{
  "pluginId": "json-tools",
  "displayName": "JSON Tools",
  "version": "1.0.0",
  "entry": "index.js",
  "capabilities": [
    "text.replace",
    "pane.setRenderer",
    "panel.open"
  ]
}
```

Phase 1 不要求开发者手写 contributions 列表。

理由：

```text
definePlugin 里已经声明 commands/renderers/panels
manifest 再写一份容易不一致
安装/启用时以 entry 返回的 PluginDefinition 为准
```

可以在启用时生成内部索引：

```ts
type InstalledPluginIndex = {
  pluginId: string
  commands: string[]
  renderers: string[]
  panels: string[]
}
```

### Capabilities

Phase 1 capabilities 只做展示和 warning，不做强拦截。

用途：

```text
安装时给用户看插件大概会做什么
后续更新时可以提示新增能力
开发时发现未声明 effect type 可以 console.warn
```

不要把 Phase 1 capabilities 包装成安全系统。

## 第三方插件导入

### 加载来源

Phase 1 必做：

```text
Install Local Plugin Folder
Side-load Local Plugin Folder
```

Phase 1.5 / Phase 2 再做：

```text
Watch Local Plugin Folder
```

暂不支持：

```text
远程 URL 安装
插件市场
自动更新
签名校验
压缩包导入
```

三者区别：

```text
Install Local Plugin Folder:
  进入 production plugin store
  默认 disabled
  用户显式 enable 后注册到 production registry

Side-load Local Plugin Folder:
  进入 dev registry
  session scoped
  不写入 production plugin store
  用于临时测试本地插件

Watch Local Plugin Folder:
  Side-load 的自动 reload 形态
  文件变化后重新加载 dev registry 中对应插件
```

### 插件目录

```text
my-plugin/
  manifest.json
  index.js
  assets/
  README.md
```

### 安装流程

```text
用户选择本地插件目录
  -> 读取 manifest.json
  -> 校验 pluginId / version / entry
  -> 检查 pluginId 是否冲突
  -> 展示插件信息和 capabilities
  -> 用户确认
  -> 写入 plugin store，状态为 disabled
```

### Side-load 流程

```text
用户选择本地插件目录
  -> 读取 manifest.json
  -> 校验 pluginId / version / entry
  -> 动态 import entry
  -> 读取 default export PluginDefinition
  -> 校验 PluginDefinition.id === manifest.pluginId
  -> 注册到 dev registry
  -> Command Palette 中显示 [DEV]
```

规则：

```text
side-load 不写入 production plugin store
side-load 不改变已安装插件状态
side-load 允许 pluginId 与 production 插件相同
side-load 与 production 同名 contribution 同时存在，但 UI 必须标明 [DEV]
从 [DEV] command 发出的 effects 优先解析 dev registry 中的 renderer/panel
```

### Watch 流程

```text
用户对本地插件目录开启 Watch
  -> 初次执行 Side-load
  -> 监听 manifest/entry/assets 变化
  -> 变化后 dispose 该 dev plugin
  -> 重新 import entry
  -> 重新注册到 dev registry
  -> 成功则刷新 [DEV] contribution
  -> 失败则保留错误状态并清理旧 contribution
```

Phase 1 可以先做手动 Reload，Watch Mode 可作为 Phase 1.5 或 Phase 2。

### 启用流程

```text
用户点击 Enable
  -> 动态 import entry
  -> 读取 default export PluginDefinition
  -> 校验 PluginDefinition.id === manifest.pluginId
  -> 校验 contributionId 全局唯一
  -> 注册 commands / renderers / panels
  -> 状态改为 enabled
```

### 禁用流程

```text
用户点击 Disable
  -> 从 registry 移除 contributions
  -> 清理使用该插件 renderer/panel 的 surface
  -> 状态改为 disabled
```

### 重载流程

开发者修改本地插件后：

```text
用户点击 Reload
  -> 如果已启用，先 disable
  -> 重新 import entry
  -> 重新校验并注册
  -> 显示 load error 或 enabled
```

## Phase 1：插件运行时最小可用

### 目标

打通插件系统主链路：

```text
本地插件目录 -> 加载 -> 启用 -> 注册 contributions -> 执行 command -> 应用 effects -> 打开 renderer/panel -> 禁用清理
```

同时建立开发态隔离：

```text
production registry 承载正式启用插件
dev registry 承载 side-load 插件，后续承载 watch 插件
两者不互相污染
```

### 必做

1. Plugin Definition

```text
definePlugin
commands
renderers
panels
```

2. Manifest

```text
pluginId
displayName
version
entry
capabilities
```

3. Registry

```text
CommandRegistry
RendererRegistry
PanelRegistry
production registry
dev registry
[DEV] contribution source marker
```

4. Plugin Runtime

```text
install local folder
enable
disable
reload
side-load local folder into dev registry
reload dev plugin
load error
plugin status
```

5. InputResolver

```text
text input
pane input
use-active
auto-fill
always-prompt
fallback prompt/fail
```

6. EffectRunner public effects

```text
text.replace
pane.create
pane.close
pane.setRenderer
pane.clearRenderer
panel.open
panel.close
status.message
```

7. SurfaceManager

```text
pane renderer state
panel instance state
renderer missing handling
plugin disabled cleanup
```

8. RendererHost

```text
mount renderer by rendererId
pass inputs and host API
unmount on clear/close/disable
fallback UI for missing renderer
```

9. UI

```text
Settings / Plugins 管理页
Install Local Plugin Folder
Side-load Local Plugin Folder
Enable / Disable / Reload
Reload Dev Plugin
显示 pluginId、version、status、load error、capabilities
Command Palette 对 dev command 显示 [DEV]
```

10. 迁移内置能力到同一模型

至少迁移：

```text
diff
json-diff
regex-tester
```

它们可以仍然随 app 打包，但要作为 core plugin 或 builtin plugin 注册，不要散落 hardcode。

### 不做

```text
插件编辑器
overlay
跨插件 renderer 复用
远程安装
插件市场
自动更新
签名
强权限拦截
复杂事件订阅 API
```

### 验收标准

```text
可以从本地目录安装一个插件
可以启用/禁用/重载插件
可以从本地目录 side-load 一个 dev 插件
dev 插件 contribution 显示 [DEV]
dev 插件不写入正式安装状态
production 插件和 dev 插件同 pluginId 时不会互相覆盖
插件可以注册一个 text command
插件可以注册一个 renderer 并通过 pane.setRenderer 打开
插件可以注册一个 panel 并通过 panel.open 打开
禁用插件后，相关 command 消失，相关 renderer/panel 被清理或 fallback
卸载/重载 dev 插件后，相关 [DEV] command 消失，相关 renderer/panel 被清理或 fallback
命令不能直接依赖 workspace store 完成主要副作用
diff/json-diff/regex-tester 可以用同一 effect/surface 链路表达
```

### 风险

```text
动态 import 本地插件在 Tauri 环境中的路径和缓存策略需要提前验证
React component 跨 bundle 加载方式可能影响插件格式
RendererHost 的 props 契约如果不稳，后续 view 会大量返工
```

## Phase 2：插件生态基础

### 目标

让插件系统从“能跑本地插件”进化到“能维护一组插件”。

### 必做

1. 插件目录标准化

```text
统一本地插件安装目录
插件状态持久化
插件启用顺序持久化
插件错误状态持久化
```

2. Dev Watch 完善

```text
稳定 watch mode
dev plugin 自动 reload
reload error overlay/status
dev/prod 同名插件的 UI 区分
关闭应用时清理 dev registry
```

3. Core Plugin 化

```text
把内置 workspace commands / renderers / panels 收敛成 core plugin
core plugin 使用同一 registry
系统启动时先注册 core plugin
```

4. 跨插件 renderer 复用

允许 effect 引用其他插件的 rendererId：

```ts
{ type: 'pane.setRenderer', renderer: 'json-tools.object-diff', ... }
```

需要补齐：

```text
registry.resolveRenderer
renderer missing fallback
插件禁用时 surface eviction
可选 minVersion 检查
```

5. Capability diff

插件更新或 reload 时对比 capabilities：

```text
新增 capability
移除 capability
未声明但使用的 effect type warning
```

6. 更完整输入类型

扩展 inputs：

```text
clipboard text
created pane
optional pane
```

但仍避免把它们变回普通 params。

7. Panel Surface 完善

```text
bottom/right/left/floating placement
panel instance props
panel close lifecycle
panel conflict policy
```

### 可选

```text
overlay surface
renderer options schema
插件依赖声明 dependsOn
插件排序/分组
```

### 不做

```text
插件市场
远程自动更新
强沙箱
内置插件编辑器
复杂 npm 依赖管理
```

### 验收标准

```text
一个插件可以打开另一个插件提供的 renderer
被引用 renderer 缺失时不会崩溃，会出现明确 fallback/status
禁用 renderer 提供方插件时，所有相关 surface 被正确清理
core plugin 和第三方插件使用同一注册机制
capabilities 变化能被展示
panel lifecycle 不依赖具体 hardcode
```

## Phase 3：分发、安全与高级运行时

### 目标

在插件系统稳定后，再考虑真正的生态能力。

### 可能建设

1. 插件包格式

```text
.flux-plugin
压缩包导入
包完整性校验
manifest schema version
```

2. 远程安装

```text
从 URL 安装
插件源配置
插件更新检查
版本回滚
```

3. 签名和信任

```text
官方插件签名
未知来源提示
更新签名校验
```

4. 权限强拦截

只有当满足以下条件之一时再做：

```text
远程插件
插件市场
自动更新
不可信第三方插件
文件系统 / 网络 API 对插件开放
```

可扩展为：

```text
host API capability check
effect capability check
高风险能力二次确认
```

5. 沙箱

评估：

```text
iframe sandbox
web worker sandbox
Tauri sidecar process
permissioned RPC bridge
```

6. 开发者工具

不是内置插件编辑器，而是 Plugin Dev Tools：

```text
插件加载日志
registry inspector
surface inspector
effect trace
capability warning
```

### 不做

除非产品明确转向插件生态，否则仍不做完整插件 IDE。

### 验收标准

```text
可以安装压缩插件包
可以识别来源和版本
可以安全地提示高风险能力变化
可以回滚或禁用问题插件
插件运行错误不会拖垮主应用
开发者能定位 registry/effect/surface 问题
```

## 当前实现迁移建议

现有代码里已经有部分接近目标的模块：

```text
workspace/types.ts
workspace/effectRunner.ts
workspace/pluginApi.ts
workspace/panelRegistry.ts
workspace/presentationRegistry.ts
workspace/surfaceCoordinator.ts
components/CommandPalette.tsx
```

迁移顺序建议：

1. 先改类型层

```text
CommandContribution
InputSlot
InputResolution
RendererContribution
SurfaceState
Effect
```

2. 再改执行链路

```text
CommandPalette -> InputResolver -> command.run -> EffectRunner
```

3. 再改 surface

```text
presentation.open 收敛为 pane.setRenderer / panel.open
RendererHost 统一 mount renderer
```

4. 再做 plugin runtime

```text
本地插件目录安装
enable / disable / reload
registry cleanup
```

5. 最后迁移内置功能

```text
diff
json-diff
regex-tester
```

## 决策摘要

```text
插件不是命令，插件是安装单位。
命令不是 view，命令只返回 effects。
View/Renderer 是独立 contribution，有生命周期。
pane-select 不是普通参数，而是 input slot 的 UI 表现。
presentation 这个词 Phase 1 不再作为公共 effect 暴露，改用 pane.setRenderer / panel.open。
插件编辑器下线，Scripts 保留为单文件命令能力。
Dev Registry 保留，它是开发态隔离边界，不是插件编辑器 UI。
Phase 1 支持本地插件 install 和 side-load，不做市场、沙箱、远程更新。
Capabilities 先做声明和展示，不做强拦截。
```
