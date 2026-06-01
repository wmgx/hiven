# FluxText Workspace Extension Architecture

## 背景

FluxText 当前是一个命令驱动的文本处理工作台：

```text
文本输入 -> Command Palette -> Action -> 替换编辑器内容
```

这个模型适合排序、去重、格式化、编码转换等文本操作，但不足以自然表达 Diff、Regex Tester、JSON Viewer、Markdown Preview 这类能力。它们不只是 `text -> text`，还会改变工作区的表现形态，或者呼出一个交互面板。

新的设计目标是：保留命令驱动体验，同时把文本操作、页面表现、插件面板、Monaco UI 能力统一纳入一个可扩展架构。

## 核心判断

FluxText 不应该把能力分成互斥的两类：

```text
Text Action 或 Workspace Command
```

更合理的抽象是：

```text
Command 触发一次用户意图
Command 读取输入上下文
Command 产生一组 Effects
Effect 分别作用于文本、Pane、Presentation、Panel、Monaco UI
```

也就是说，文本处理和页面表现是两个维度，但一次命令可以同时产生多个维度的效果。

例如：

```text
Sort Lines:
  只产生 text.replace effect

Diff Panes:
  只产生 presentation.open effect

JSON4Mate:
  产生 text.replace effect
  同时产生 presentation.open 或 monaco.decorate effect

Regex Tester:
  产生 panel.open effect
  面板读取 active pane 文本
  面板持续更新 Monaco decorations
```

## 总体模型

```text
Workspace
  ├─ Pane[]                 文本编辑单元
  ├─ Active Pane            当前命令默认作用目标
  ├─ Command Runtime        命令执行与输入策略
  ├─ Effect Runner          统一应用文本和 UI effects
  ├─ Presentation Session[] 特殊表现状态，例如 Diff / Preview / JSON Tree
  ├─ Panel Surface[]        插件贡献的交互面板，例如 Regex Tester
  └─ Monaco Bridge          Monaco Editor 能力开放层
```

## Pane

Pane 是 FluxText 的基础文本容器。一个 Workspace 可以包含一个或多个 Pane。

```ts
type PaneId = string

type EditorPane = {
  id: PaneId
  title: string
  text: string
  language?: string
  uri?: string
  groupId?: string
}
```

Pane 不等于文件，也不等于 tab。它只是当前工作区里的一个文本编辑单元。

普通文本命令默认作用于 active pane：

```text
有选区 -> 作用于 active pane 的选区
无选区 -> 作用于 active pane 全文
```

多 Pane 场景下，用户焦点决定 active pane。命令面板应展示命令作用域，例如：

```text
Sort Lines      Text · Active Pane
Diff Panes      Workspace · 2 Panes
Regex Tester    Panel · Active Pane
```

## Layout

Workspace 的 layout 表示 Pane 如何排布：

```ts
type WorkspaceLayout =
  | { type: 'single'; panes: [PaneId] }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; panes: PaneId[] }
  | { type: 'grid'; rows: PaneId[][] }
```

数据模型不写死 left/right。即使 UI 初期只做左右分栏，架构也应支持三栏、多栏和网格。

## Command

Command 是用户通过 Command Palette、快捷键、按钮或插件触发的一次能力。

```ts
type FluxCommand = {
  id: string
  title: string
  description?: string
  tags?: string[]
  icon?: string
  inputPolicy?: InputPolicy
  run(ctx: CommandContext): CommandResult | Promise<CommandResult>
}
```

Command 不再被限制为“返回一段文本”。它可以返回多个 effects。

```ts
type CommandResult = {
  effects: FluxEffect[]
}
```

为了兼容现有 Action，`{ text: string }` 仍然可以被系统自动解释为：

```ts
{
  effects: [
    { type: 'text.replace', target: 'active-input', text }
  ]
}
```

## Input Policy

InputPolicy 描述命令希望如何取输入。它不是强制流程，而是给 Host、Command Palette 和插件共同使用的意图声明。

```ts
type InputPolicy = {
  prefer: 'selection' | 'whole-pane' | 'workspace'
  fallback?: 'whole-pane' | 'none'
  minPanes?: number
  maxPanes?: number
  allowInteractivePicker?: boolean
}
```

示例：

```text
Format JSON:
  prefer selection, fallback whole-pane

Diff Panes:
  prefer workspace, minPanes 2, maxPanes 2, allowInteractivePicker true

Regex Tester:
  prefer whole-pane, fallback selection
```

实际执行时，Host 会把真实输入传给插件：

```ts
type CommandInput = {
  mode: 'selection' | 'whole-pane' | 'workspace'
  text?: string
  range?: SerializedRange
  paneId?: PaneId
  panes?: PaneId[]
}
```

这样插件可以基于选区和全文做不同交互。

例如 JSON4Mate：

```text
如果用户选中 JSON:
  只格式化选区，不切换整个 Pane 表现

如果用户没有选区，且全文是 JSON:
  格式化全文，并可打开 JSON tree / folding presentation

如果用户显式执行 Open JSON Viewer:
  不替换文本，只打开 viewer surface
```

## Effects

Effect 是 Command 对系统提出的声明式结果。

```ts
type FluxEffect =
  | TextReplaceEffect
  | PaneEffect
  | WorkspaceEffect
  | PresentationEffect
  | PanelEffect
  | MonacoEffect
  | StatusEffect
```

### Text Effect

```ts
type TextReplaceEffect = {
  type: 'text.replace'
  target: 'active-input' | { paneId: PaneId; range?: SerializedRange }
  text: string
}
```

Text Effect 只改变 Pane 内容。

### Pane Effect

```ts
type PaneEffect =
  | { type: 'pane.create'; pane: Partial<EditorPane>; focus?: boolean }
  | { type: 'pane.close'; paneId: PaneId }
  | { type: 'pane.focus'; paneId: PaneId }
  | { type: 'pane.update'; paneId: PaneId; patch: Partial<EditorPane> }
```

### Workspace Effect

```ts
type WorkspaceEffect =
  | { type: 'workspace.layout'; layout: WorkspaceLayout }
  | { type: 'workspace.split'; direction: 'horizontal' | 'vertical'; sourcePaneId?: PaneId }
```

### Presentation Effect

Presentation 是某种特殊表现状态。它可能替换 Pane 的渲染器，也可能作为 side-by-side renderer、preview renderer 或 inline layer 存在。

```ts
type PresentationEffect =
  | {
      type: 'presentation.open'
      renderer: string
      mode: 'replace-pane' | 'split-view' | 'inline-layer' | 'overlay'
      targetPaneIds: PaneId[]
      sessionId?: string
      options?: Record<string, unknown>
    }
  | { type: 'presentation.close'; sessionId: string }
  | { type: 'presentation.update'; sessionId: string; options: Record<string, unknown> }
```

Diff、JSON Tree、Markdown Preview 都是 Presentation。

### Panel Effect

Panel 是插件贡献的交互面板。它可以有自己的输入框、按钮、状态和结果区，并可以持续读取或装饰 Pane。

```ts
type PanelEffect =
  | {
      type: 'panel.open'
      panelId: string
      placement: PanelPlacement
      scope?: PanelScope
      title?: string
      props?: Record<string, unknown>
      bind?: PanelBinding
    }
  | { type: 'panel.close'; instanceId: string }
  | { type: 'panel.update'; instanceId: string; props: Record<string, unknown> }

type PanelPlacement =
  | 'pane-inline'
  | 'pane-bottom'
  | 'pane-right'
  | 'bottom'
  | 'right'
  | 'left'
  | 'floating'
  | 'command-popover'

type PanelScope =
  | { type: 'pane'; paneId: PaneId }
  | { type: 'workspace' }
  | { type: 'presentation'; sessionId: string }

type PanelBinding = {
  paneIds?: PaneId[]
  activePane?: boolean
  selection?: boolean
}
```

Regex Tester 适合用 Panel，而不是 Presentation：

```text
Panel 里输入正则表达式
Panel 读取 active pane 或绑定 pane 的文本
Panel 展示 match 列表、capture groups、错误信息
Panel 用 Monaco decorations 高亮匹配结果
```

Panel 的位置和作用域是两个维度：

```text
placement:
  面板显示在哪里，例如 Pane 内部、Pane 下方、全局底部、全局右侧、浮层。

scope:
  面板作用于谁，例如某个 Pane、整个 Workspace、某个 Presentation Session。
```

例如：

```text
Regex Tester:
  placement = bottom
  scope = workspace
  bind = activePane
  作为全局底部面板，跟随 active pane 测试文本。

Inline JSON Inspector:
  placement = pane-right
  scope = pane:current
  只贴在某个 Pane 内部，检查当前 Pane 的 JSON path。

Diff Options:
  placement = pane-bottom 或 bottom
  scope = presentation:diff-session
  只控制当前 Diff session。
```

### Monaco Effect

Monaco Effect 用于声明式调用 Monaco UI 能力。

```ts
type MonacoEffect =
  | {
      type: 'monaco.decorate'
      paneId: PaneId
      decorations: monaco.editor.IModelDeltaDecoration[]
      owner?: string
    }
  | {
      type: 'monaco.updateOptions'
      paneId: PaneId
      options: monaco.editor.IEditorOptions
    }
  | {
      type: 'monaco.diff.updateOptions'
      sessionId: string
      options: monaco.editor.IDiffEditorOptions
    }
```

## Presentation Session

Presentation Session 表示一个正在运行的特殊展示状态。

```ts
type PresentationSession = {
  id: string
  renderer: string
  mode: 'replace-pane' | 'split-view' | 'inline-layer' | 'overlay'
  targetPaneIds: PaneId[]
  statusLabel?: string
  live: boolean
  editable: boolean
  options: Record<string, unknown>
}
```

Diff 是一个 Presentation Session：

```ts
{
  renderer: 'monaco-diff',
  mode: 'split-view',
  targetPaneIds: ['pane-a', 'pane-b'],
  live: true,
  editable: true,
  options: {
    renderSideBySide: true,
    originalEditable: true,
    renderIndicators: true
  }
}
```

进入 Diff 后：

```text
允许继续编辑参与对比的 Pane
允许在当前聚焦 Pane 上执行普通文本命令
允许切换 side-by-side / inline
允许跳转上一个/下一个 diff
退出 Diff 只关闭 session，不丢 Pane 内容
```

## Surface Coordination

当插件可以打开 Presentation、Panel、Monaco decorations 和 widgets 后，系统必须提供统一的互斥机制。否则多个插件可能同时占用同一个 Pane、同一个面板区域或同一组 Monaco UI 层，用户也无法判断当前处于什么渲染状态。

这里引入 Surface Coordination：

```text
Surface:
  可被 Presentation 或 Panel 占用的 UI 区域或渲染层

Occupancy:
  某个 session/panel/plugin 当前占用了哪个 surface

Exit Policy:
  退出或替换该状态时应如何清理、确认和恢复
```

### Surface

Surface 是互斥和状态展示的基本单位。

```ts
type SurfaceId =
  | `pane:${PaneId}:renderer`
  | `pane:${PaneId}:inline-layer`
  | `pane:${PaneId}:decorations`
  | `workspace:main`
  | `panel:left`
  | `panel:right`
  | `panel:bottom`
  | `panel:floating`
```

不同 surface 的互斥强度不同：

```text
pane:*:renderer:
  强互斥。同一个 Pane 同一时间只能有一个主 renderer，例如 code editor、diff side、json tree。

pane:*:inline-layer:
  可组合，但需要 zIndex 和 owner 管理，例如 inline hint、JSON path hint。

pane:*:decorations:
  可组合，但必须按 owner 清理，例如 regex match、lint error、diff highlight。

panel:bottom/right/left:
  默认单占用，也可以显式允许 stack 或 tab。

panel:floating:
  可多开，但每个实例必须有清晰标题和关闭入口。

workspace:main:
  强互斥。用于全屏或替换整个主工作区的 presentation。
```

### Occupancy

每个 Presentation Session 或 Panel Instance 创建时，都需要声明它占用哪些 surfaces。

```ts
type SurfaceOccupancy = {
  id: string
  ownerId: string
  ownerKind: 'presentation' | 'panel' | 'extension' | 'system'
  surfaces: SurfaceClaim[]
  title: string
  description?: string
  statusLabel?: string
  exitPolicy: ExitPolicy
}

type SurfaceClaim = {
  surfaceId: SurfaceId
  mode: 'exclusive' | 'shared' | 'stacked'
  priority?: number
  zIndex?: number
}
```

示例：

```text
Diff Session:
  占用 workspace:main 或 pane:a:renderer + pane:b:renderer
  exclusive
  statusLabel = Diff: Pane A ↔ Pane B

Regex Tester Panel:
  占用 panel:bottom exclusive
  占用 pane:a:decorations shared
  statusLabel = Regex Tester · Pane A

JSON4Mate inline hints:
  占用 pane:a:inline-layer shared
  占用 pane:a:decorations shared
```

### Conflict Policy

当新 effect 试图占用已被占用的 exclusive surface 时，系统不能静默覆盖。Command 必须声明冲突策略：

```ts
type ConflictPolicy =
  | 'reject'
  | 'replace'
  | 'ask'
  | 'reuse-if-same-owner'
  | 'stack-if-supported'
```

默认策略：

```text
Presentation:
  ask

Panel:
  reuse-if-same-owner，否则 ask

Decorations / inline-layer:
  shared
```

例如当前已经打开 Diff，再执行 JSON Tree 替换 Pane renderer：

```text
系统提示：
Current view is Diff: Pane A ↔ Pane B.
Opening JSON Tree will exit Diff.
[Exit Diff and Open] [Cancel]
```

如果当前已经打开 Regex Tester，再次执行 Regex Tester：

```text
复用现有 panel，把焦点移到 regex input。
```

如果当前打开 Regex Tester，再执行 Find Replace，它也想占用 bottom panel：

```text
系统按 panel:bottom 的 policy 询问替换、并排、或取消。
```

### Exit Policy

每个占用状态必须声明退出时如何处理。

```ts
type ExitPolicy = {
  label?: string
  closeBehavior: 'dispose-only' | 'restore-view' | 'confirm-if-dirty' | 'custom'
  preservesPaneText: boolean
  cleanupOwners?: string[]
}
```

常见规则：

```text
Diff:
  closeBehavior = dispose-only
  preservesPaneText = true
  退出时关闭 DiffEditor，保留两个 Pane 当前文本，恢复普通 split editor。

Regex Tester:
  closeBehavior = dispose-only
  preservesPaneText = true
  退出时清理 regex decorations、listeners、panel state。

JSON Tree replace-pane:
  closeBehavior = restore-view
  preservesPaneText = true
  退出时恢复 code editor renderer。

插件自定义面板:
  如果有未应用输入或临时状态，可使用 confirm-if-dirty。
```

### Render Status Bar

Workspace 需要有一个统一的位置展示当前渲染状态，避免用户不知道自己处于什么模式。

状态信息来自 SurfaceOccupancy：

```ts
type RenderStatus = {
  activePaneId: PaneId
  activeRenderer: string
  activePresentations: string[]
  openPanels: string[]
  decorations: { ownerId: string; label: string }[]
}
```

UI 可以表现为：

```text
Active: Pane A    Renderer: Code    Panel: Regex Tester
```

Diff 状态：

```text
Diff: Pane A ↔ Pane B    Side-by-side    Regex highlights off    Exit
```

当多个共享层存在时，提供一个状态菜单：

```text
Rendering
  Main: Code Editor
  Presentation: Diff
  Panel: Regex Tester
  Decorations:
    - Regex matches
    - JSON path hints

Actions:
  Exit Diff
  Close Regex Tester
  Clear Regex matches
  Reset Pane Renderer
```

### Session Stack

为了支持“退出时恢复上一个状态”，每个 Pane 可以维护 renderer stack：

```ts
type PaneRenderStackItem = {
  renderer: string
  ownerId: string
  viewState?: unknown
  enteredAt: number
}
```

示例：

```text
code editor
-> json tree replace-pane
-> exit json tree
-> restore code editor with previous Monaco view state
```

Diff 这类跨 Pane Presentation 不应直接塞进单个 Pane stack，而应由 Presentation Session 管理，并在退出时恢复所有目标 Pane 的 previous renderer。

### Effect Runner 处理顺序

Effect Runner 应按事务处理冲突：

```text
1. 解析所有 effects 需要的 surface claims。
2. 检查 exclusive 冲突。
3. 根据 ConflictPolicy 决定 reject / ask / replace / reuse / stack。
4. 如果需要用户确认，暂停执行。
5. 执行需要关闭的 occupancy，并按 ExitPolicy 清理。
6. 应用新的 effects。
7. 记录新的 occupancy。
8. 更新 Render Status。
```

如果一个 Command 同时返回 text.replace 和 presentation.open，冲突确认应发生在任何实际修改之前。避免用户取消 UI 切换后文本已经被改掉。

## Compare Renderer

Diff 不应该写成特殊 if/else。它应作为内置 Compare Renderer 注册。

```ts
type CompareRenderer = {
  id: string
  title: string
  supportedInputCounts: number[] | 'many'
  supportedRoles: string[]
  supportedModes: string[]
  create(ctx: CompareRendererContext): Disposable
}
```

`monaco-diff` 的能力：

```ts
{
  id: 'monaco-diff',
  supportedInputCounts: [2],
  supportedRoles: ['original', 'modified'],
  supportedModes: ['side-by-side', 'inline']
}
```

当前有三栏或更多 Pane 时，执行 Diff 不应静默猜测。系统应打开 Compare Picker：

```text
Original: [Pane A ▼]
Modified: [Pane B ▼]
Renderer: Monaco Diff
Start Compare
```

默认值可以使用“上一个 active pane + 当前 active pane”，但必须展示给用户确认。

未来多栏 Diff 可通过新 renderer 接入，例如：

```ts
registerCompareRenderer({
  id: 'three-way-diff',
  supportedInputCounts: [3],
  supportedRoles: ['base', 'variant', 'variant']
})
```

## Panel Surface

Panel Surface 是插件可以呼出的交互面板。它不同于 Presentation：

```text
Presentation:
  改变文本内容的主要展示方式，例如 Diff、Preview、Tree Viewer

Panel:
  在主编辑器旁边或下方提供交互控制，例如 Regex Tester、Find Replace、Inspector
```

插件可以注册 Panel：

```ts
type PanelContribution = {
  id: string
  title: string
  defaultPlacement: PanelPlacement
  defaultScope?: 'pane' | 'workspace' | 'presentation'
  component: PanelComponent
}
```

Panel Component 获得一个受控的运行上下文：

```ts
type PanelContext<Props = Record<string, unknown>> = {
  props: Props
  binding: PanelBinding
  workspace: WorkspaceApi
  panes: PaneApi
  presentation: PresentationApi
  monaco: MonacoBridge
  close(): void
}
```

Panel 可以：

```text
读取绑定 Pane 文本
监听 Pane 内容变化
读取当前选区
写回 Pane 内容
添加 / 清理 Monaco decorations
打开 Presentation Session
注册局部快捷键
```

Panel 不应该：

```text
直接修改全局 DOM
注入任意全局 CSS
绕过 Host 生命周期持有 Monaco 对象
覆盖全局快捷键
```

### Panel Scope

Panel Scope 决定面板的生命周期、互斥范围和默认数据来源。

```ts
type PanelInstance = {
  id: string
  panelId: string
  placement: PanelPlacement
  scope: PanelScope
  bind?: PanelBinding
  title: string
  ownerId: string
}
```

Pane-scoped panel：

```text
只服务于一个 Pane。
挂在 Pane 内部或 Pane 边缘。
Pane 关闭时自动关闭。
Pane 失焦时可以保留，但状态栏要标明它绑定的是哪个 Pane。
典型例子：JSON Inspector、局部 lint panel、selection inspector。
```

Workspace-scoped panel：

```text
服务于整个 Workspace。
通常挂在全局 bottom/right/left。
可以选择跟随 active pane，也可以 pin 到固定 Pane。
Workspace 切换或应用关闭时销毁。
典型例子：Regex Tester、Find Replace、Command Output、Search Results。
```

Presentation-scoped panel：

```text
服务于某个 Presentation Session。
Presentation 关闭时自动关闭。
典型例子：Diff Options、Markdown Preview settings、Compare Picker detail panel。
```

Panel 的默认绑定规则：

```text
scope = pane:
  默认读取该 pane。

scope = workspace + bind.activePane:
  默认读取当前 active pane，并可在 UI 上提供 Pin。

scope = workspace + bind.paneIds:
  读取固定 pane 集合。

scope = presentation:
  默认读取该 session 的 targetPaneIds。
```

### Panel Placement

Placement 只描述显示位置，不隐含作用域。

```text
pane-inline:
  面板嵌入 Pane 内部，适合轻量 inspector 或 inline control。

pane-bottom:
  面板挂在某个 Pane 底部，只占该 Pane 空间。

pane-right:
  面板挂在某个 Pane 右侧，只占该 Pane 空间。

bottom:
  Workspace 全局底部面板，适合 Regex Tester / Find Replace。

right / left:
  Workspace 全局侧边面板，适合结构化 inspector、结果列表、插件工具箱。

floating:
  浮动面板，可多开，但必须有标题和关闭入口。

command-popover:
  命令面板派生的小型交互，不适合长期驻留。
```

同一个 Panel 可以支持多个 placement。Host 根据当前 layout、屏幕空间和用户选择决定实际位置，但必须把最终 placement 暴露给插件。

## Regex Tester 示例

Regex Tester 是 Panel 能力的典型用例。

触发：

```text
Cmd+K -> Regex Tester
```

效果：

```ts
{
  type: 'panel.open',
  panelId: 'regex-tester',
  placement: 'bottom',
  title: 'Regex Tester',
  bind: { activePane: true, selection: true }
}
```

交互：

```text
1. 面板底部打开。
2. 面板包含 pattern、flags、replacement 可选输入。
3. 默认测试 active pane 的选区；无选区时测试全文。
4. 用户输入 regex 时实时计算 matches。
5. 匹配区域通过 Monaco decorations 高亮。
6. 面板展示 match count、capture groups、错误信息。
7. 用户切换 active pane 时，面板可以跟随 active pane，也可以 pin 到原 pane。
8. 关闭面板时，清理所有 decorations、listeners 和临时状态。
```

Regex Tester 不需要把整个 Pane 切换成特殊展示。它是一个控制面板 + editor decorations 的组合。

## Monaco Bridge

FluxText 使用 Monaco，因此插件系统应尽量完整开放 Monaco 能力。

```ts
type MonacoBridge = {
  getMonaco(): typeof monaco
  getCodeEditor(paneId: PaneId): monaco.editor.ICodeEditor | null
  getDiffEditor(sessionId: string): monaco.editor.IStandaloneDiffEditor | null
  getOriginalEditor(sessionId: string): monaco.editor.ICodeEditor | null
  getModifiedEditor(sessionId: string): monaco.editor.ICodeEditor | null
}
```

同时提供高层封装，便于插件不用直接操作 Monaco 实例：

```ts
type PresentationApi = {
  decorate(paneId: PaneId, decorations: monaco.editor.IModelDeltaDecoration[]): Disposable
  addViewZone(paneId: PaneId, zone: ViewZoneSpec): Disposable
  addContentWidget(paneId: PaneId, widget: ContentWidgetSpec): Disposable
  addOverlayWidget(paneId: PaneId, widget: OverlayWidgetSpec): Disposable
  addGlyphMarginWidget(paneId: PaneId, widget: GlyphWidgetSpec): Disposable
  updateEditorOptions(paneId: PaneId, options: monaco.editor.IEditorOptions): Disposable
  updateDiffOptions(sessionId: string, options: monaco.editor.IDiffEditorOptions): void
}
```

需要开放的 Monaco 能力包括：

```text
decorations
overview ruler
minimap markers
glyph margin
line decorations
inline decorations
injected text
hover messages
view zones
content widgets
overlay widgets
glyph margin widgets
editor options
diff editor options
editor actions
editor commands
editor events
view state save/restore
diff line changes
diff navigation
```

DiffEditor 相关能力应覆盖：

```text
renderSideBySide
ignoreTrimWhitespace
renderIndicators
renderMarginRevertIcon
renderGutterMenu
originalEditable
diffCodeLens
renderOverviewRuler
diffWordWrap
diffAlgorithm
hideUnchangedRegions
experimental.showMoves
experimental.showEmptyDecorations
experimental.useTrueInlineView
getLineChanges
goToDiff
revealFirstDiff
```

## Extension Lifecycle

插件贡献的所有资源都必须由 Host 管生命周期。

```ts
type ExtensionContribution = {
  id: string
  activate(ctx: ExtensionContext): Disposable | void
}

type ExtensionContext = {
  host: EditorHost
  subscriptions: Disposable[]
}
```

任何注册都返回 Disposable：

```text
commands
panels
presentation renderers
decorations
widgets
view zones
event listeners
temporary editor options
```

关闭 Panel、关闭 Presentation、卸载插件或刷新脚本时，Host 统一 dispose。

命名空间规则：

```text
command id: extensionId.commandName
panel id: extensionId.panelName
renderer id: extensionId.rendererName
widget id: extensionId/widgetName
css class: ft-ext-{extensionId}-*
```

## Command Palette 体验

Command Palette 是统一入口，但需要展示命令类型和作用域。

示例：

```text
Sort Lines          Text · Active Pane
Format JSON         Text + Presentation · Selection/Pane
Diff Panes          Presentation · 2 Panes
Regex Tester        Panel · Active Pane
Split Right         Workspace
```

当命令需要多个 Pane，而当前 Pane 数不足时，命令不应直接失败。它可以：

```text
提示需要 split
提供 Split Right 快捷入口
或打开 picker 让用户选择 / 创建 Pane
```

当 Pane 数超过命令支持范围时，系统必须打开 picker，而不是静默猜测。

## 执行级规范

本节是给执行人的实现约束。执行时不得只按概念理解，需要按这里的状态、冲突、编辑和生命周期规则落代码。

### 术语表

```text
Pane:
  一个文本编辑单元。Pane 持有文本、语言、标题、选区、普通 Monaco editor 运行时引用。

Active Pane:
  当前获得编辑焦点的 Pane。普通文本命令默认作用于 Active Pane。

Command:
  用户触发的一次能力，可以来自 Cmd+K、按钮、快捷键或插件。

Effect:
  Command 执行后的声明式结果。Effect Runner 负责统一应用。

Presentation Session:
  改变一个或多个 Pane 主要展示方式的状态，例如 Diff、JSON Tree、Markdown Preview。

Panel Instance:
  插件或系统打开的交互面板，例如 Regex Tester、Find Replace、Diff Options。

Surface:
  可被占用的 UI 区域或渲染层，例如 workspace:main、panel:bottom、pane:x:renderer。

Occupancy:
  某个 Presentation/Panel/Extension 对 Surface 的占用记录。
```

### 状态唯一来源

Workspace 状态必须集中在 store 的 workspace slice 中，不允许组件各自维护互相矛盾的模式状态。

```ts
type WorkspaceState = {
  panes: Record<PaneId, EditorPane>
  paneOrder: PaneId[]
  activePaneId: PaneId
  previousActivePaneId?: PaneId
  layout: WorkspaceLayout
  selections: Record<PaneId, SerializedSelection | null>
  viewStates: Record<PaneId, unknown>
  presentations: Record<string, PresentationSession>
  panels: Record<string, PanelInstance>
  occupancies: Record<string, SurfaceOccupancy>
  renderStacks: Record<PaneId, PaneRenderStackItem[]>
}
```

持久化状态：

```text
panes.text
panes.title
panes.language
paneOrder
activePaneId
layout
用户显式保存的 panel placement 偏好
```

不持久化状态：

```text
presentations
panels
occupancies
Monaco editor instance
diff editor instance
decorations id
widgets
view zones
临时错误状态
```

启动时恢复规则：

```text
1. 如果旧状态只有 editorText，则迁移成一个 pane。
2. 如果 persisted layout 引用了不存在的 pane，则降级成 single。
3. 启动后始终进入普通 code editor，不恢复 Diff/Panel/Presentation。
4. 如果 activePaneId 不存在，使用 paneOrder[0]。
```

### Runtime Registry

Monaco 实例、decoration ids、view zones、widgets 不能放进可持久化 store。需要独立 runtime registry：

```ts
type RuntimeRegistry = {
  codeEditors: Map<PaneId, monaco.editor.ICodeEditor>
  diffEditors: Map<string, monaco.editor.IStandaloneDiffEditor>
  disposables: Map<string, Disposable[]>
  decorationOwners: Map<string, string[]>
  viewZoneOwners: Map<string, string[]>
  widgetOwners: Map<string, string[]>
}
```

owner id 规则：

```text
Command 临时 effect: command:{commandId}:{runId}
Panel: panel:{instanceId}
Presentation: presentation:{sessionId}
Extension: extension:{extensionId}
```

清理时必须按 owner 清理，不能全局清空所有 decorations。

### Pane 生命周期

Pane 状态机：

```text
created -> mounted -> focused -> blurred -> closed
```

规则：

```text
created:
  store 中创建 pane，但 Monaco editor 可能尚未 mount。

mounted:
  editor onMount 后注册到 RuntimeRegistry。

focused:
  editor onDidFocusEditorText 或用户点击 pane 时设置 activePaneId。

blurred:
  失焦不清空 activePaneId，只更新 UI。

closed:
  必须先检查该 pane 是否被 Presentation/Panel 占用。
  如果被 exclusive Presentation 占用，按 ConflictPolicy 询问是否关闭相关状态。
  关闭后清理 runtime registry 中该 pane 的 editor、decorations、widgets、view zones。
```

Pane 关闭规则：

```text
只有一个 Pane 时，不允许关闭，改为 Clear Pane。
关闭 active pane 后，activePaneId 切到相邻 Pane。
关闭被 panel pin 的 Pane 时，panel 自动关闭或要求用户重新绑定。
关闭被 Diff 使用的 Pane 时，必须先退出 Diff。
```

### 编辑语义

普通文本命令的输入规则：

```text
如果 active pane 有非空选区：
  ctx.input.mode = selection
  ctx.input.text = 选区文本
  ctx.input.range = 选区 range

如果 active pane 没有选区：
  ctx.input.mode = whole-pane
  ctx.input.text = pane 全文
  ctx.input.range = undefined
```

普通文本命令的输出规则：

```text
返回 { text }:
  替换 ctx.input 对应的选区或全文。

返回 text.replace effect:
  按 effect.target 替换指定 pane/range。

返回多个 text.replace:
  同一个 pane 内按 range 从后往前应用，避免前一个替换改变后一个 range。
```

Undo 规则：

```text
同一次 Command 的所有 text.replace effect 应成为一个 undo step。
应用 effect 前 pushUndoStop，应用后 pushUndoStop。
如果 effect 涉及多个 Pane，每个 Pane 各自形成一个 undo step。
```

Diff 中编辑规则：

```text
Diff 使用 live editable 模式。
originalEditable = true 时，左侧编辑同步回 original pane。
modified editor 编辑同步回 modified pane。
用户在 Diff 的左/右 editor 聚焦时，activePaneId 切到对应 Pane。
普通文本命令仍作用于当前 activePaneId。
退出 Diff 不回滚任何编辑。
```

Panel 中编辑规则：

```text
Panel 可以通过 PaneApi 写回文本。
Panel 写回必须走 Effect Runner 或 PaneApi 的 transactional edit，不能直接 set store text 后绕过 undo。
Panel 如果有未应用输入状态，应在 close 前走 confirm-if-dirty。
```

### Presentation 生命周期

Presentation Session 状态机：

```text
requested -> conflict-checking -> opening -> active -> closing -> closed
```

规则：

```text
requested:
  Command 返回 presentation.open effect。

conflict-checking:
  Effect Runner 计算 SurfaceClaim，并检查 exclusive 冲突。

opening:
  记录 previous renderer/viewState。
  创建 session。
  注册 occupancies。
  mount renderer。

active:
  renderer 可以响应 Pane 文本变化、选区变化、options 变化。

closing:
  执行 ExitPolicy。
  dispose session disposables。
  清理 session owner 的 decorations/widgets/view zones。
  恢复 previous renderer/viewState。

closed:
  从 store 和 runtime registry 删除 session。
```

Presentation 退出入口：

```text
Session bar 的 Exit 按钮
Render Status 菜单里的 Exit
Command Palette 的 Exit Current Presentation
Esc，当焦点不在输入型 Panel 控件里时
冲突替换时由 Effect Runner 自动 close
```

### Panel 生命周期

Panel Instance 状态机：

```text
requested -> conflict-checking -> opening -> active -> closing -> closed
```

规则：

```text
opening:
  计算 placement + scope。
  注册 panel occupancy。
  调用 PanelContribution.component。
  注入 PanelContext。

active:
  可以监听 pane/presentation/workspace。
  可以通过 owner id 添加 decorations/widgets。
  可以更新自身 props。

closing:
  如果 dirty，先确认。
  dispose panel subscriptions。
  清理 panel owner 的 Monaco resources。
  释放 panel occupancy。
```

Panel dirty 判断：

```text
如果 Panel 只是实时测试，不产生未保存状态，则 dirty = false。
如果 Panel 有用户输入但未 apply，例如 replace preview，则 dirty = true。
如果 Panel 写回已经通过 Effect Runner 成功应用，则 dirty = false。
```

### 冲突矩阵

默认冲突策略如下。执行人必须按矩阵处理，不要在组件里零散 if/else。

```text
当前占用：pane:x:renderer exclusive
新请求：pane:x:renderer exclusive
默认处理：ask

当前占用：workspace:main exclusive
新请求：workspace:main exclusive
默认处理：ask

当前占用：panel:bottom exclusive
新请求：same panel owner
默认处理：reuse and focus

当前占用：panel:bottom exclusive
新请求：different panel owner
默认处理：ask replace / cancel

当前占用：pane:x:decorations shared
新请求：new decorations shared
默认处理：allow

当前占用：pane:x:inline-layer shared
新请求：new inline-layer shared
默认处理：allow by zIndex

当前占用：pane:x referenced by Diff
新请求：close pane
默认处理：ask exit Diff first

当前占用：presentation session active
新请求：close presentation
默认处理：follow ExitPolicy

当前占用：panel dirty
新请求：close panel
默认处理：confirm-if-dirty
```

用户确认文案必须包含：

```text
当前状态名称
新请求名称
会被关闭或替换的内容
是否保留 Pane 文本
确认按钮
取消按钮
```

示例：

```text
Current view is Diff: Pane A ↔ Pane B.
Opening JSON Tree will exit Diff. Pane text will be kept.
[Exit Diff and Open JSON Tree] [Cancel]
```

### Render Status

Editor 顶部或底部必须展示当前状态，至少包含：

```text
Active Pane
Main Renderer / Presentation
Open Panel
Decorations count 或 active decoration owners
Exit / Close 操作入口
```

普通状态：

```text
Active: Pane A | Renderer: Code | Panel: -
```

Diff 状态：

```text
Diff: Pane A ↔ Pane B | Side-by-side | Exit
```

Regex Tester 状态：

```text
Active: Pane A | Panel: Regex Tester | Matches: 12 | Close
```

多状态：

```text
Diff: Pane A ↔ Pane B | Panel: Regex Tester | Decorations: Regex matches | Status ▾
```

Status 菜单必须提供：

```text
Exit current presentation
Close each open panel
Clear decorations by owner
Reset renderer for active pane
```

### Built-in Command 行为定义

Split Right：

```text
输入：active pane
效果：
  1. 创建一个新 pane，文本为空，语言继承 active pane。
  2. layout 改为 horizontal split。
  3. 新 pane 获得焦点。
冲突：
  如果 workspace:main 被 exclusive presentation 占用，先询问是否退出 presentation。
```

Close Pane：

```text
输入：active pane
效果：
  1. 如果只有一个 pane，拒绝并提示 Use Clear Pane.
  2. 如果 pane 被 presentation/panel 占用，按冲突矩阵处理。
  3. 删除 pane，layout 重新计算，焦点给相邻 pane。
```

Diff Panes：

```text
输入：
  如果 pane 数 = 2，直接使用两个 pane。
  如果 pane 数 > 2，打开 Compare Picker。
  如果 pane 数 < 2，提示 Split Right 或 Compare with Clipboard。
效果：
  presentation.open renderer=monaco-diff mode=split-view
默认 options：
  renderSideBySide = true
  originalEditable = true
  renderIndicators = true
  ignoreTrimWhitespace = true
  enableSplitViewResizing = true
```

Exit Diff：

```text
输入：当前 monaco-diff presentation session
效果：
  关闭 session，dispose diff editor，恢复 split code editors。
  保留两个 pane 当前文本。
```

Regex Tester：

```text
输入：
  active pane 的选区；没有选区则使用全文。
效果：
  panel.open panelId=regex-tester placement=bottom scope=workspace bind.activePane=true
交互：
  pattern 或 flags 改变时，实时更新 decorations。
  active pane 改变时，如果未 pin，则重新绑定新 active pane。
  Close 时清理 regex decorations。
```

JSON4Mate：

```text
输入：
  prefer selection, fallback whole-pane。
行为：
  如果 selection 是 JSON，只格式化选区，不改变 renderer。
  如果 whole-pane 是 JSON，可以返回 text.replace + presentation/decorations。
  如果 JSON parse 失败，不替换文本，返回 status.error 和 Monaco error decoration。
```

### 错误处理

Command 执行错误：

```text
不应用任何 effect。
lastResult 显示 Error。
Command Palette 关闭或保留由当前交互决定。
```

Effect 冲突取消：

```text
不应用任何 effect。
不改变文本。
不改变 layout。
```

部分 effect 失败：

```text
Effect Runner 必须尽量事务化。
如果 opening presentation 失败，回滚已记录 occupancy 和 runtime disposable。
如果 text.replace 已应用但后续 UI effect 失败，显示错误并保留文本；这种情况应通过先做冲突检查、后执行 effect 降低概率。
```

插件异常：

```text
捕获错误。
关闭该插件创建中的 panel/presentation。
清理 owner resources。
显示插件错误，不影响其他插件。
```

### 测试验收

每个 Milestone 都至少需要覆盖三类测试：

```text
Store / runtime 单元测试：
  验证状态迁移、冲突处理、effect runner。

Component 测试：
  验证 Pane focus、panel placement、status bar、command palette 展示。

浏览器/端到端验证：
  验证 Monaco editor 实际 mount、输入、命令执行、Diff/Panel 可见和可退出。
```

涉及 Monaco 的功能，不能只用 store 单测宣称完成。必须至少有一次真实浏览器验证。

## 建议文件结构

执行时优先按下面结构拆文件。不要把所有逻辑塞回 `src/store.ts` 或 `src/views/EditorView.tsx`。

```text
src/workspace/types.ts
  Pane、Layout、Command、Effect、Presentation、Panel、Surface 类型。

src/workspace/workspaceStore.ts
  Workspace zustand slice。只存可序列化状态。

src/workspace/runtimeRegistry.ts
  Monaco instances、disposables、decoration owners、widget owners。

src/workspace/effectRunner.ts
  Effect 事务执行、冲突检查、rollback、status 更新。

src/workspace/surfaceCoordinator.ts
  SurfaceClaim、Occupancy、ConflictPolicy、ExitPolicy。

src/workspace/inputResolver.ts
  根据 active pane、selection、inputPolicy 生成 CommandInput。

src/workspace/commandAdapter.ts
  兼容旧 ActionDef run(ctx) -> { text }。

src/workspace/monacoBridge.ts
  getCodeEditor/getDiffEditor/getOriginalEditor/getModifiedEditor。

src/workspace/presentationRegistry.ts
  registerPresentationRenderer / registerCompareRenderer。

src/workspace/panelRegistry.ts
  registerPanelContribution / openPanel / closePanel。

src/components/workspace/WorkspaceShell.tsx
  EditorView 内的工作区容器，负责 layout。

src/components/workspace/PaneEditor.tsx
  单个 Monaco Editor wrapper，负责 mount/focus/selection 同步。

src/components/workspace/PresentationHost.tsx
  根据 PresentationSession 渲染 Diff/Preview/Custom renderer。

src/components/workspace/PanelHost.tsx
  根据 PanelInstance 渲染 bottom/right/pane-local/floating panels。

src/components/workspace/RenderStatusBar.tsx
  展示 active pane、renderer、panel、decorations 和退出入口。

src/presentations/monacoDiffRenderer.tsx
  内置 Monaco Diff renderer。

src/panels/RegexTesterPanel.tsx
  内置 Regex Tester panel。

src/commands/workspaceCommands.ts
  Split Right、Close Pane、Diff Panes、Exit Diff、Regex Tester 等系统命令。
```

现有文件调整：

```text
src/store.ts:
  保留全局 settings/actions/recent params 等；逐步把 editorText/editorInstance 迁移到 workspace slice。

src/views/EditorView.tsx:
  变成薄壳，渲染 WorkspaceShell、CommandPalette、StatusBar。

src/components/CommandPalette.tsx:
  从直接 runAction 改为 run command -> effect runner。
  旧 ActionDef 通过 commandAdapter 兼容。
```

## Milestone 拆解

这些 Milestone 是实现顺序。每个 Milestone 都必须可独立验证，不要一次性把所有功能堆到一个 PR。

### Milestone 0：类型与状态基础

目标：

```text
建立 workspace 类型、store slice、runtime registry，不改变现有 UI 行为。
```

范围：

```text
新增 src/workspace/types.ts
新增 src/workspace/workspaceStore.ts
新增 src/workspace/runtimeRegistry.ts
把旧 editorText 初始化迁移为单 pane，但 UI 仍显示单编辑器。
```

验收：

```text
启动后仍是单 Monaco Editor。
输入文本后 store 中 panes[activePaneId].text 同步。
刷新后文本能恢复。
旧 Action 仍能替换文本。
```

测试：

```text
npm run build
workspaceStore 单测：legacy editorText -> single pane migration
浏览器验证：输入文本、运行一个旧 Action
```

### Milestone 1：Command + Effect Runner 兼容层

目标：

```text
引入 CommandResult/effects，但保持现有 Action 兼容。
```

范围：

```text
新增 inputResolver.ts
新增 commandAdapter.ts
新增 effectRunner.ts 的 text.replace 最小实现
CommandPalette 改为调用 command adapter + effect runner
```

验收：

```text
有选区时旧 Action 只替换选区。
无选区时旧 Action 替换 active pane 全文。
Action 错误不改变文本。
一次 Action 是一个 undo step。
```

测试：

```text
npm run build
单测：selection input、whole-pane input、text.replace range
浏览器验证：选区排序、全文排序、undo
```

### Milestone 2：多 Pane Layout 与 Active Pane

目标：

```text
支持 single/split workspace 和 active pane 命令作用域。
```

范围：

```text
WorkspaceShell.tsx
PaneEditor.tsx
RenderStatusBar.tsx 基础版
workspaceCommands.ts: Split Right、Close Pane、Focus Pane、Swap Panes
```

验收：

```text
Split Right 后出现左右两个编辑器。
点击左边，active pane = left；点击右边，active pane = right。
普通 Action 只修改 active pane。
Close Pane 后不丢另一个 pane 文本。
只剩一个 pane 时 Close Pane 被拒绝。
```

测试：

```text
npm run build
单测：layout reducer、active pane 切换、close pane fallback
浏览器验证：左右栏分别运行 Deduplicate/Sort
```

### Milestone 3：Surface Coordination 与 Render Status

目标：

```text
实现互斥、占用、退出策略和状态展示，为 Diff/Panel 做基础。
```

范围：

```text
surfaceCoordinator.ts
effectRunner.ts 冲突检查与事务顺序
RenderStatusBar.tsx 完整状态菜单
基础确认弹窗或 command-popover confirm
```

验收：

```text
exclusive surface 冲突不会静默覆盖。
取消冲突确认时，文本、layout、panel、presentation 都不变化。
状态栏能展示当前 renderer/panel/decorations。
Exit 操作能按 owner 清理 resources。
```

测试：

```text
npm run build
单测：conflict matrix、ExitPolicy、取消时不应用 effects
组件验证：状态菜单展示和关闭入口
```

### Milestone 4：Presentation Host 与 Monaco Diff

目标：

```text
实现 Presentation Session 和内置 Monaco Diff renderer。
```

范围：

```text
presentationRegistry.ts
PresentationHost.tsx
presentations/monacoDiffRenderer.tsx
monacoBridge.ts DiffEditor 部分
workspaceCommands.ts: Diff Panes、Exit Diff、Compare Picker
```

验收：

```text
两个 pane 时 Diff Panes 直接打开 Diff。
三个及以上 pane 时打开 Compare Picker，用户明确选择 original/modified。
Diff 可 side-by-side/inline 切换。
Diff 左右两边可编辑，编辑同步回对应 pane。
Diff 中运行普通 Action，只修改当前聚焦的 diff side 对应 pane。
Exit Diff 恢复普通 split editor，保留编辑后的文本。
```

测试：

```text
npm run build
单测：presentation open/close、compare picker selection、diff options update
浏览器验证：打开 Diff、编辑左右文本、运行 Action、退出 Diff
```

### Milestone 5：Panel Host 与 Regex Tester

目标：

```text
实现插件面板系统，并用 Regex Tester 验证 panel + decorations 能力。
```

范围：

```text
panelRegistry.ts
PanelHost.tsx
panels/RegexTesterPanel.tsx
monacoBridge.ts decorations 部分
PresentationApi.decorate owner 清理
workspaceCommands.ts: Regex Tester
```

验收：

```text
Cmd+K -> Regex Tester 打开 bottom panel。
输入 regex 后 active pane 中匹配内容高亮。
regex 错误显示在 panel，不污染 editor 文本。
切换 active pane 时，未 pin 模式跟随新 pane。
pin 后固定测试原 pane。
关闭 panel 后所有 regex decorations 清理。
bottom panel 冲突按规则复用或询问替换。
```

测试：

```text
npm run build
单测：panel scope、placement、dirty close、decoration owner cleanup
浏览器验证：regex match 高亮、切 pane、pin、close cleanup
```

### Milestone 6：Monaco Bridge 全能力开放

目标：

```text
把 Monaco editor/diff editor 的主要 UI 能力通过受控 API 暴露给插件。
```

范围：

```text
monacoBridge.ts 完整实现
PresentationApi.addViewZone/addContentWidget/addOverlayWidget/addGlyphMarginWidget
editor actions/commands/events 注册接口
owner namespace 与 disposable 管理
```

验收：

```text
插件可以添加 decoration、view zone、content widget、overlay widget、glyph widget。
插件可以更新 editor options 和 diff options。
插件卸载或 panel/presentation 关闭后，所有资源被清理。
插件异常不会影响其他插件或主编辑器。
```

测试：

```text
npm run build
单测：每类 resource disposable
浏览器验证：测试插件添加并清理 decoration/widget/view zone
```

### Milestone 7：组合命令与 JSON4Mate 验证

目标：

```text
验证一个 Command 同时产生 text + presentation/monaco effects 的能力。
```

范围：

```text
实现或改造 JSON 格式化命令为 CommandResult effects。
增加 JSON parse error decoration。
增加可选 JSON presentation 或 inline-layer 示例。
```

验收：

```text
选区 JSON：只格式化选区，不切换 renderer。
全文 JSON：格式化全文，并可打开 JSON 增强展示。
JSON parse 失败：不替换文本，显示错误 decoration 和 status。
如果 presentation 冲突被用户取消，文本也不被替换。
```

测试：

```text
npm run build
单测：组合 effects 事务、parse error 不替换
浏览器验证：选区 JSON、全文 JSON、错误 JSON、冲突取消
```

### Milestone 8：插件 API 稳定化与文档

目标：

```text
把内部机制整理成外部可用的插件 API，并补充开发者文档。
```

范围：

```text
导出 registerCommand/registerPanel/registerPresentationRenderer/registerCompareRenderer
补充插件示例：Regex Tester、Diff Options、JSON Inspector
补充 API 文档和生命周期说明
```

验收：

```text
第三方插件不需要 import 内部 React 组件即可注册命令和面板。
插件可以声明 inputPolicy、返回 effects、打开 panel/presentation。
插件清理行为可预测。
文档包含最小插件、Panel 插件、Presentation 插件三个例子。
```

测试：

```text
npm run build
示例插件 smoke test
浏览器验证：加载示例插件，打开/关闭，资源清理
```

## 执行注意事项

开发过程中必须遵守：

```text
每个 Milestone 独立提交。
不要在 Milestone 0/1 顺手重写所有 builtin actions。
不要在没有 Surface Coordination 前实现可互相覆盖的 Presentation/Panel。
不要把 Monaco runtime instance 放入 persist store。
不要用全局 CSS 随意污染插件样式；插件样式必须 namespaced。
不要让插件直接持久持有 DOM/Monaco 对象；必须通过 Disposable 生命周期管理。
```

完成每个 Milestone 时，交付说明必须包含：

```text
改动范围
新状态/API
冲突或降级行为
测试命令和结果
真实 UI 验证结果
剩余风险
```

## 设计结论

FluxText 的扩展架构应围绕 Effect，而不是围绕 Action 类型。

最终抽象：

```text
Pane:
  文本容器

Command:
  用户触发的一次能力

InputPolicy:
  命令希望如何读取选区、全文或多个 Pane

Effect:
  命令产生的文本、布局、展示、面板、Monaco UI 变化

Presentation Session:
  特殊展示状态，例如 Diff、JSON Tree、Markdown Preview

Panel Surface:
  插件贡献的交互面板，例如 Regex Tester、Find Replace、Inspector

Monaco Bridge:
  对 Monaco 编辑器和 DiffEditor 能力的开放层

Extension Lifecycle:
  统一管理插件注册、清理和资源释放
```

Diff、JSON4Mate、Regex Tester 在这个模型里的位置：

```text
Diff:
  Command -> presentation.open(monaco-diff)

JSON4Mate:
  Command -> text.replace + presentation.open/json decorations

Regex Tester:
  Command -> panel.open(regex-tester) + monaco.decorate
```

这套设计允许简单命令保持简单，也允许复杂插件自由组合文本处理、页面表现和交互面板。用户仍然只需要记住 `Cmd+K`，而插件作者可以使用完整的 Workspace 和 Monaco 能力。
