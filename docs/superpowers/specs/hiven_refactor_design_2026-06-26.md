# Hiven 重构设计文档：从“文本工具 + 启动器”到“本地个人命令工作台”

版本：2026-06-26  
目标读者：产品 / 架构 / 前端 / Tauri 实现  
基于来源：

- 当前代码仓库：`wmgx/hiven`，默认分支 `main`。
- 今日思路文档：
  - `2026-06-26-editor-lightweight-no-main-window-design.md`
  - `2026-06-26-plugin-surface-independent-window-design.md`
- 今日交互原型与讨论结论：
  - 一个全局入口。
  - 编辑器是工作区 Surface。
  - 编辑器内 Launcher 是局部动作面板。
  - 插件 Surface 可以独立窗口，也可以附着到编辑器。
  - 核心心智是“对象 → 动作 → Surface → 输出去向”。

---

## 0. 结论先行

Hiven 不应继续被定义为：

```text
文本工具 + 启动器 + 插件集合
```

更合理的产品定位是：

```text
Hiven = 本地个人命令工作台
```

它的目标是把用户日常在 Raycast / uTools / Boop / 剪贴板 / 翻译 / 编辑器之间来回切换的流程，压缩成一套统一模型：

```text
对象 Object
→ 动作 Action
→ Surface 承载复杂任务
→ 输出去向 Output Target
```

因此本次重构的核心判断是：

```text
Hiven 只能有一个 app 级入口：全局 Launcher。
编辑器是 Hiven 的一个系统 Surface。
编辑器内 Cmd+K 是局部动作面板，不是第二个全局 Launcher。
插件 Surface 是 Hiven 的工具界面，可独立窗口，也可附着到编辑器。
```

最终架构应从当前的：

```text
主窗口 App
├─ Sidebar
├─ EditorView
├─ CommandPalette
└─ GlobalLauncher overlay / 独立 launcher window
```

重构为：

```text
Hiven runtime
├─ Tray / background
├─ Global Launcher Window
│  ├─ 搜索对象
│  ├─ 执行全局动作
│  ├─ 打开系统 surface
│  └─ 路由到编辑器 / 插件窗口
├─ Editor Window
│  ├─ Monaco workspace
│  ├─ Editor Command Bar
│  ├─ PanelHostV2 left/right/bottom
│  └─ plugin renderer / panel / toolbar host
└─ Plugin Surface Windows
   ├─ clipboard-history
   ├─ translator
   ├─ json viewer
   └─ future custom surfaces
```

---

## 1. 产品定位

### 1.1 现有困境

当前的产品压力来自两个原本都能独立成立的形态：

```text
A. 启动器：类似 Raycast / uTools
B. 文本工具：类似 Boop / scratch editor / Monaco workbench
```

两者都天然使用类似交互：

```text
呼出搜索框 → 输入关键词 → 选择动作 → 执行
```

所以当 Hiven 同时拥有全局 Launcher 和编辑器 Cmd+K 时，很容易出现：

```text
全局 Launcher 像一个 app
编辑器 + CommandPalette 也像一个 app
插件 Surface 又像一堆小 app
```

这个问题不是单纯的 UI 重复，而是产品层级没有重新定义。

### 1.2 新产品心智

用户不应该思考：

```text
我该去启动器？
我该去编辑器？
我该去剪贴板？
我该去翻译插件？
```

用户应该只思考：

```text
我现在手里有什么？
我想对它做什么？
结果要放到哪里？
```

所以 Hiven 的核心体验应是：

```text
从任意软件唤起 Hiven
→ Hiven 读取上下文快照
→ 展示当前对象与可执行动作
→ 短任务直接完成
→ 长任务进入 Editor / Plugin Surface
→ 结果可复制、粘贴、替换、打开、附着、保存
```

### 1.3 分层规则

| 层级 | 产品名称 | 职责 | 不负责 |
|---|---|---|---|
| App 级入口 | Global Launcher | 搜索对象、打开工具、启动应用、切换窗口、路由工作流 | 长文本编辑、复杂 UI 承载 |
| 系统工作区 | Editor Window | 长文本、草稿、格式化结果、多 Pane、插件面板协作 | 应用启动、系统导航主入口 |
| 局部动作层 | Editor Command Bar | 当前选区、当前 pane、当前文档动作 | 全局 app 启动、插件管理主入口 |
| 插件界面 | Plugin Surface | 翻译、剪贴板、JSON、Diff、Regex 等复杂工具 UI | 自己成为完整独立 app |
| 后台能力 | Provider / Background | 提供对象、监听剪贴板、维护索引 | 直接承载用户操作 |

一句话：

```text
全局 Launcher 找对象和路由；
编辑器承载复杂文本；
编辑器内 Launcher 只改当前上下文；
插件 Surface 是工具，不是新 app。
```

---

## 2. 当前代码现状

### 2.1 App 入口仍然是“主窗口 + Launcher 窗口”双形态

当前 `App.tsx` 里仍然通过 URL 参数区分 `LauncherWindowApp` 和 `MainApp`：

```tsx
export default function App() {
  return isLauncherWindow() ? <LauncherWindowApp /> : <MainApp />
}
```

`MainApp` 中仍然渲染主窗口 shell、Sidebar、当前 View、CommandPalette、GlobalLauncher、PluginSettingsDialog：

```tsx
<div className="flux-spatial-shell">
  <div className="flux-main">
    {!globalLauncherOverlay && <Sidebar />}
    {!globalLauncherOverlay && <main>...</main>}
  </div>
  {!globalLauncherOverlay && activeView === 'editor' && <CommandPalette />}
  <GlobalLauncher />
  <PluginSettingsDialog />
</div>
```

这说明代码层面仍然存在一个强主窗口模型。即使全局 Launcher 已有独立窗口，主窗口仍承担编辑器、脚本页、设置页、插件编辑器、Pinned Runner 等导航职责。

### 2.2 Tauri 配置仍然定义 `main` 和 `launcher` 两个初始窗口

`tauri.conf.json` 目前定义了：

```json
{
  "label": "main",
  "title": "Hiven",
  "width": 1100,
  "height": 720,
  "decorations": true
}
```

以及：

```json
{
  "label": "launcher",
  "title": "Hiven Launcher",
  "url": "index.html?window=launcher",
  "decorations": false,
  "transparent": true,
  "visible": false,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "focus": false
}
```

这和今日“纯托盘 app，无常驻主窗口”的方向不一致。当前配置仍然把 `main` 作为正式窗口，而 `launcher` 是附加的 Spotlight 式窗口。

### 2.3 Rust 侧已经有较完整的 Launcher 窗口能力

Rust 侧已有：

- `show_launcher_window`
- `hide_launcher_window`
- 记住/恢复之前前台应用
- 按鼠标所在屏幕居中
- 将 launcher 窗口提升为 macOS NonActivating Panel
- 自定义 `HivenKeyablePanel`，解决 borderless NSPanel 默认不能成为 key window 的问题

这部分是后续“纯托盘 + 全局 Launcher 唤起”的基础，不需要推倒。

### 2.4 LauncherController 已经抽出了共享内核

`src/workspace/launcher/controller.ts` 的注释已经明确写到：

```text
Framework-agnostic state machine driving both CommandPalette and GlobalLauncher.
```

它负责：

- 一级选择
- collect-input 两步输入
- result-choice 输出栈
- selection usage 记录
- Enter / Escape 行为

这说明当前已有“Launcher 内核”雏形。重构不应重写这部分，而应继续把 UI host、窗口管理、surface 打开能力从具体组件中抽出去。

### 2.5 Launcher 类型系统仍然只有两个 Surface

`LauncherSurfaceId` 当前只有：

```ts
export type LauncherSurfaceId = 'command-palette' | 'global-launcher'
```

这符合旧模型，但不再能表达新架构下的 host 区分：

```text
global-launcher-window
editor-command-bar
plugin-surface-command-bar?
```

尤其是 `command-palette` 这个名字已经不再准确。它实际应该变成：

```text
editor-command-bar
```

### 2.6 Registry / Ranking 已经部分做对

当前 Registry 已经把 Launcher 看作 host/workspace domain，而不是直接扫 commands：

```text
Collects launcher candidates from:
1. host-owned launcher items
2. plugin static items
3. plugin dynamic items
```

并且注释明确：

```text
CommandPalette / GlobalLauncher never scan commands directly.
Launcher entries must be declared as launcher.items or tools.
```

Ranking 也已经是一条共享 pipeline：

```text
score = matchScore + usageScore(surface) + pinnedBoost + hostStaticPriority + installFreshnessScore
```

并且 usage 是 per surface。这个方向和“统一内核 + 多 Host”是兼容的。

### 2.7 CommandPalette 和 GlobalLauncher 仍然在 UI / Host 层重复

`CommandPalette.tsx` 与 `GlobalLauncher.tsx` 都有自己的：

- `query`
- `selectedIndex`
- `dynamicItems`
- `controllerRef`
- `IME handling`
- `rankLauncherItems`
- `collectDynamicItems`
- `LauncherParamStep`
- `CollectInputStep`
- `ResultStep`
- 键盘处理
- close / focus restore

两者虽然共享 Controller、Registry、Ranking，但 UI host 逻辑仍高度重复。

当前最需要抽的是：

```text
LauncherSession
LauncherView
LauncherHost
```

而不是再写第三套 launcher。

### 2.8 GlobalLauncher 目前承担了太多 Surface 宿主职责

`GlobalLauncher.tsx` 中有 `surfaceFrame`，会在 launcher panel 内直接渲染 plugin surface：

```tsx
const [surfaceFrame, setSurfaceFrame] = useState(...)
...
setSurfaceFrame(target)
```

当 `surfaceFrame` 存在时，GlobalLauncher 会直接渲染：

```tsx
<SurfaceComponent
  pluginId={...}
  surfaceId={...}
  host={{
    close,
    requestBack,
    openSettings,
    storage,
    clipboard,
    paste,
    network
  }}
/>
```

这解释了你今日文档中提到的问题：所有插件 surface 共享 GlobalLauncher 内的一个 `surfaceFrame` slot，因此翻译 surface 正在使用时，快捷键打开剪贴板历史会覆盖掉原 surface，丢失现场。

### 2.9 EditorView 已经具备独立窗口内容基础

`EditorView.tsx` 已经是相对完整的编辑器工作区：

```tsx
EditorView
├─ editor topbar
├─ WorkspaceShell
├─ PanelHost
├─ PanelHostV2 placement left/bottom/right
├─ RenderStatusBar
└─ ToastContainer
```

顶部已有：

- word wrap
- find replace
- open launcher
- split right
- split down
- plugin toolbar buttons
- Run Action 按钮

这意味着编辑器独立窗口不需要重写编辑器，只需要把 `EditorView` 放进新的 `EditorWindow` shell。

### 2.10 PanelHostV2 已支持 left/right/bottom

`PanelHostV2` 当前按 `placement` 过滤并渲染 panel：

```tsx
<PanelHostV2 placement="left" />
<PanelHostV2 placement="bottom" />
<PanelHostV2 placement="right" />
```

它已经是“插件可附着到编辑器”的基础。后续 translator / clipboard / json tools 附着到编辑器右侧，不需要发明新容器，应该优先复用 `PanelHostV2`。

### 2.11 EffectRunner 已经承担文本修改和 panel 打开

`effectRunner.ts` 已支持：

- `text.replace`
- `pane.create`
- `pane.close`
- `pane.focus`
- `panel.openV2`
- `panel.closeV2`
- `pane.setRenderer`
- `app.showMainPanel`

这说明“动作 → 输出去向”已经有一部分实现基础。后续应该把它提升为更清晰的 `OutputRouter` / `ActionResult` 语义，而不是让插件直接散落调用各种 host API。

---

## 3. 今日两份思路文档如何合并

你今天的两个文档方向都对，但它们分别从两个切面切入：

### 3.1 编辑器轻量化 + 去主窗口文档

核心方向：

```text
Hiven 从“主窗口 + 编辑器为核心”
转向“纯托盘 app + launcher 驱动 + 独立窗口”
```

关键决策：

- 纯托盘 app。
- 无常驻主窗口。
- Launcher 是 NonActivating Panel。
- 编辑器是系统组件，不是插件。
- 编辑器独立窗口，普通激活窗口。
- 编辑器保留多 pane、分屏、renderer、panel、toolbar。
- settings/scripts/plugin-editor 变成 launcher 内 surface。
- 编辑器窗口 singleton。
- 编辑器状态不持久化，Scratch Pad 模式。

这份文档解决的是：

```text
主窗口和编辑器是否还应该作为 app 中心？
```

答案是：

```text
不应该。全局 Launcher 才是 app 入口；编辑器是系统 Surface。
```

### 3.2 Plugin Surface 独立窗口文档

核心方向：

```text
通过全局快捷键打开的插件 surface 不再挤在 GlobalLauncher 的 surfaceFrame 里，而是独立窗口渲染。
```

关键决策：

- launcher 打开 → launcher 内渲染。
- 快捷键打开 → 独立窗口。
- 窗口 singleton 起步。
- 独立 WebviewWindow + URL 参数路由。
- 普通激活窗口。
- 失焦隐藏 + 超时销毁。
- `shortcutPresentation?: 'launcher' | 'window'`
- `instancePolicy?: 'singleton' | 'multi'`
- `destroyTimeout?: number`

这份文档解决的是：

```text
插件 surface 互相覆盖，像一个临时 slot，而不是独立工具窗口。
```

答案是：

```text
按入口决定 presentation。快捷键打开的工具应该是独立窗口，避免覆盖 launcher 内 transient surface。
```

### 3.3 合并后的总路线

这两个文档不冲突。它们应该被合并成同一条架构路线：

```text
Phase 1：插件 Surface 独立窗口
  先解决 surfaceFrame 覆盖问题，风险较小，可独立实施。

Phase 2：编辑器独立窗口
  把 EditorView 从 MainApp 中拆出去，保留完整插件宿主能力。

Phase 3：去主窗口
  移除 MainApp / Sidebar / ViewId 导航，把 settings/scripts/plugin-editor 迁为 launcher surfaces。

Phase 4：Launcher Host 抽象
  GlobalLauncher / EditorCommandBar 共用同一 Launcher Kernel 与 UI 基础件，但 host 能力不同。

Phase 5：对象-动作模型
  从 action-first launcher 逐步升级为 object-action-output system。
```

---

## 4. 目标架构

### 4.1 Runtime 架构

```text
Hiven Runtime
├─ App Process
│  ├─ tray
│  ├─ global hotkeys
│  ├─ plugin backgrounds
│  ├─ app index / clipboard monitor / storage
│  └─ window manager
│
├─ Launcher Window
│  ├─ window type: launcher
│  ├─ macOS: NonActivating Panel
│  ├─ presentation: spotlight
│  ├─ hosts:
│  │  ├─ GlobalQuickAccess
│  │  ├─ LauncherSurfaceHost
│  │  ├─ SettingsSurface
│  │  └─ PluginManagerSurface
│  └─ role:
│     ├─ object search
│     ├─ action search
│     ├─ app launch
│     ├─ window switch
│     ├─ surface open
│     └─ workflow routing
│
├─ Editor Window
│  ├─ window type: editor
│  ├─ normal activating window
│  ├─ singleton
│  ├─ custom chrome
│  ├─ EditorView
│  ├─ EditorCommandBar
│  ├─ WorkspaceShell
│  ├─ PanelHostV2
│  └─ role:
│     ├─ long text
│     ├─ scratch pad
│     ├─ pane manipulation
│     ├─ plugin panels
│     └─ local text actions
│
└─ Plugin Surface Windows
   ├─ window type: plugin-surface
   ├─ normal activating window
   ├─ singleton first
   ├─ optional closeOnBlur
   ├─ optional destroyTimeout
   └─ role:
      ├─ clipboard history
      ├─ translator
      ├─ JSON viewer
      ├─ diff
      └─ future plugin UI
```

### 4.2 前端入口路由

目标入口不再是单一 `App.tsx` 里塞所有逻辑，而是：

```ts
const params = new URLSearchParams(window.location.search)
const windowType = params.get('window')

switch (windowType) {
  case 'launcher':
    root.render(<LauncherWindowApp />)
    break

  case 'editor':
    root.render(<EditorWindowApp />)
    break

  case 'plugin-surface':
    root.render(<PluginSurfaceWindowApp />)
    break

  default:
    root.render(<LauncherWindowApp />)
}
```

过渡期可以保留 `MainApp`，但最终应移除。

### 4.3 Window Manager

新增前端窗口管理模块：

```text
src/workspace/windowManager/
  editorWindow.ts
  pluginSurfaceWindows.ts
  launcherWindow.ts
  windowLabels.ts
  windowGeometry.ts
```

职责：

- 创建 / 显示 / 聚焦编辑器窗口。
- 创建 / 显示 / 隐藏 / 销毁插件 surface 窗口。
- 处理 singleton label。
- 处理窗口尺寸、居中、失焦隐藏、超时销毁。
- 封装 Tauri `invoke`，避免 UI 组件直接散落调用 Rust command。

示例接口：

```ts
export async function showEditorWindow(input?: {
  text?: string
  language?: string
  title?: string
  source?: WorkObjectSource
}): Promise<void>

export async function showPluginSurfaceWindow(target: {
  source: 'builtin' | 'installed' | 'dev'
  pluginId: string
  surfaceId: string
}): Promise<void>

export async function hidePluginSurfaceWindow(target: PluginSurfaceTarget): Promise<void>
```

### 4.4 Surface Registry

新增统一 Surface Registry：

```ts
type SurfaceInstance = {
  id: string
  kind:
    | 'launcher'
    | 'editor'
    | 'plugin-surface'
    | 'settings'
    | 'plugins'
  windowLabel: string
  title: string
  pluginId?: string
  surfaceId?: string
  state: 'visible' | 'hidden' | 'destroyed'
  canReceiveText?: boolean
  canProvideText?: boolean
  canAttachToEditor?: boolean
  lastActiveAt: number
}
```

它解决：

- 全局 Launcher 能搜到“当前已打开的 Hiven Surface”。
- 插件窗口不会互相覆盖。
- 后续支持 switch/focus/reopen。
- 后续支持 multi instance。
- 以后做“最近工作流”有统一对象来源。

---

## 5. Launcher 系统重构

### 5.1 命名调整

当前命名：

```text
GlobalLauncher
CommandPalette
```

目标命名：

```text
GlobalQuickAccess / GlobalLauncherHost
EditorCommandBar / EditorTextActions
```

建议保留组件兼容导出，但内部重命名：

```text
src/components/CommandPalette.tsx
→ src/launcher/hosts/EditorCommandBarHost.tsx

src/components/GlobalLauncher.tsx
→ src/launcher/hosts/GlobalLauncherHost.tsx
```

过渡期：

```ts
export function CommandPalette() {
  return <EditorCommandBarHost />
}

export function GlobalLauncher() {
  return <GlobalLauncherHost />
}
```

### 5.2 抽出 LauncherSession

当前两个组件都重复维护 query、selectedIndex、dynamicItems、controllerRef、IME 状态。

新增：

```ts
type LauncherSessionOptions = {
  hostId: LauncherHostId
  invocationContext: LauncherInvocationContext
  close: () => void
  getItems: () => LauncherItem[]
  collectDynamicItems: (query: string) => Promise<LauncherItem[]>
}

function useLauncherSession(options: LauncherSessionOptions): {
  query: string
  setQuery(value: string): void
  items: LauncherItem[]
  selectedIndex: number
  setSelectedIndex(index: number): void
  controllerState: LauncherControllerState
  controller: LauncherController
  selectCurrent(customizeParams?: boolean): void
  back(): void
  reset(): void
}
```

这样 host 只负责：

- 提供 context。
- 提供 capability。
- 决定可见候选池。
- 决定 close/focus/window 行为。

### 5.3 抽出 LauncherView

新增共享 UI：

```text
src/launcher/ui/
  LauncherShell.tsx
  LauncherSearchStep.tsx
  LauncherList.tsx
  LauncherListItem.tsx
  LauncherCollectInputStep.tsx
  LauncherResultStep.tsx
  LauncherParamStep.tsx
  LauncherFooterHints.tsx
```

`GlobalLauncherHost` 与 `EditorCommandBarHost` 传入不同 presentation：

```ts
type LauncherPresentation = {
  variant: 'spotlight-window' | 'editor-overlay'
  width: number
  maxHeight: number
  placeholder: string
  emptyState: ReactNode
  footerMode: 'global' | 'editor'
}
```

### 5.4 SurfaceId 重命名与兼容

当前：

```ts
type LauncherSurfaceId = 'command-palette' | 'global-launcher'
```

建议新增：

```ts
type LauncherHostId =
  | 'global-launcher'
  | 'editor-command-bar'
```

短期为了迁移 usage，可以保留 alias：

```ts
type LauncherSurfaceId =
  | 'global-launcher'
  | 'command-palette'       // legacy
  | 'editor-command-bar'    // new
```

迁移策略：

```ts
function normalizeLauncherSurfaceId(id: LauncherSurfaceId) {
  if (id === 'command-palette') return 'editor-command-bar'
  return id
}
```

Usage migration：

```ts
launcherUsageBySurface['editor-command-bar'] =
  launcherUsageBySurface['editor-command-bar'] ?? launcherUsageBySurface['command-palette']
```

### 5.5 Host Capability

不要继续让 `surfaces?: LauncherSurfaceId[]` 承担全部语义。它只能说明“出现在哪个 host”，不能表达“命令需要什么上下文”。

新增：

```ts
type LauncherHostCapability =
  | 'global-navigation'
  | 'app-launch'
  | 'window-switch'
  | 'surface-open'
  | 'text-transform'
  | 'editor-pane-control'
  | 'editor-selection'
  | 'clipboard'
  | 'settings'
```

每个 host 声明能力：

```ts
const globalLauncherHost = {
  id: 'global-launcher',
  capabilities: [
    'global-navigation',
    'app-launch',
    'window-switch',
    'surface-open',
    'clipboard',
    'settings',
  ],
}

const editorCommandBarHost = {
  id: 'editor-command-bar',
  capabilities: [
    'text-transform',
    'editor-pane-control',
    'editor-selection',
    'clipboard',
    'surface-open',
  ],
}
```

每个 item 声明：

```ts
type LauncherItem = {
  requiredCapabilities?: LauncherHostCapability[]
  preferredCapabilities?: LauncherHostCapability[]
  requiredContext?: ContextRequirement[]
}
```

短期不必一次改插件 API。可以先由 host adapter 推导：

- `inputPolicy` 有 selection → `editor-selection`
- app-icon → `app-launch`
- `plugin-surface:*` → `surface-open`
- host pane control → `editor-pane-control`
- settings item → `settings`

### 5.6 Global Launcher 的默认范围

Global Launcher 默认展示：

```text
1. 当前上下文对象
2. 最近动作 / 最近 Surface
3. 应用启动与窗口切换
4. 剪贴板 / 最近文本
5. 插件 Surface
6. 设置 / 插件管理
7. 可直接执行的一次性动作
```

它可以执行文本动作，但不应成为编辑器局部操作的主路径。

### 5.7 Editor Command Bar 的默认范围

Editor Command Bar 默认展示：

```text
1. 当前选区动作
2. 当前文档动作
3. 当前 pane 动作
4. 当前编辑器 panel / renderer 操作
5. 可附着到编辑器的插件 Surface
6. 少量“发送到全局入口”的跳转项
```

默认不展示：

```text
Safari
Terminal
系统关机 / 重启
插件管理主入口
应用启动列表
```

如果用户确实想全局搜索，可以提供：

```text
Search all Hiven…
```

或快捷键：

```text
Cmd+Shift+K
```

---

## 6. 编辑器独立窗口设计

### 6.1 目标

编辑器从 `MainApp` 的一个 view 变成独立系统窗口：

```text
EditorWindowApp
└─ EditorWindow
   ├─ CustomWindowChrome
   └─ EditorView
```

### 6.2 需要新增的 Rust command

```rust
#[tauri::command]
async fn show_editor_window(
    app: AppHandle,
    initial_text: Option<String>,
    initial_language: Option<String>,
    title: Option<String>,
) -> Result<(), String>
```

行为：

- label 固定：`editor`
- singleton
- 已存在：show + set_focus
- 不存在：创建 `index.html?window=editor`
- 可选 initial payload 通过：
  - URL query 只放短 metadata。
  - 长文本放 pending state / Tauri event / temp file / store。
- 普通激活窗口。
- 可调整大小。
- 自定义 chrome。
- 关闭后 destroy。

### 6.3 EditorWindowApp

```tsx
export function EditorWindowApp() {
  return (
    <WindowThemeProvider>
      <EditorWindowChrome>
        <EditorView />
        <EditorCommandBarHost />
        <PluginSettingsDialog presentation="editor-window" />
      </EditorWindowChrome>
    </WindowThemeProvider>
  )
}
```

### 6.4 EditorView 改动

当前 `EditorView` 已可复用，但需要轻量改造：

1. 去掉对主窗口 view 的假设。
2. 顶部的“打开 Global Launcher”按钮应该调用 `show_launcher_window`，而不是 `setGlobalLauncherOpen(true, 'full')`。
3. `Run Action` 按钮打开 `EditorCommandBarHost`。
4. `PanelHostV2` 保留。
5. `CommandPalette` 从 `MainApp` 外层移入 EditorWindow 内部，避免主窗口依赖。

### 6.5 workspaceStore 持久化策略

今日文档倾向：

```text
编辑器状态不持久化，每次打开全新 Scratch Pad
```

但当前 `workspaceStore` 使用 zustand persist，保存 panes、paneOrder、activePaneId、layout。

重构策略：

```text
Phase A：保留 persist，降低迁移风险。
Phase B：引入 editorSessionStore，默认不持久化。
Phase C：如果要做 Text Shelf / Recent Text，再把“用户主动保存的片段”存入独立 Library，而不是 workspace 自动恢复。
```

建议最终：

```ts
EditorSessionStore      // ephemeral
TextShelfStore          // persistent, 用户主动保存
ClipboardHistoryStore   // plugin/private persistent
LauncherUsageStore      // persistent
```

不要让 Scratch Pad 自动恢复成“主工作区”。否则产品又会回到“编辑器为核心”。

---

## 7. 插件 Surface 独立窗口设计

### 7.1 目标

解决：

```text
所有插件 surface 都塞在 GlobalLauncher surfaceFrame，互相覆盖。
```

改成：

```text
launcher 内打开 → transient surfaceFrame
快捷键打开 → independent PluginSurfaceWindow
将来从编辑器打开 → attach panel / editor side surface
```

### 7.2 类型扩展

在 `PluginUiSurfaceContribution` 中新增：

```ts
instancePolicy?: 'singleton' | 'multi'

shell?: {
  defaultWidth?: number
  defaultHeight?: number
  minWidth?: number
  minHeight?: number
  closeOnBlur?: boolean
  resizable?: boolean
  destroyTimeout?: number
}
```

在 `entry` 中新增：

```ts
entry?: {
  launcher?: boolean
  shortcutBindable?: boolean
  recommendedShortcut?: string
  shortcutPresentation?: 'launcher' | 'window'
}
```

含义：

| 字段 | 作用 |
|---|---|
| `instancePolicy` | 这个 surface 自身允许单例还是多实例 |
| `shortcutPresentation` | 快捷键入口打开到 launcher 内还是独立窗口 |
| `closeOnBlur` | 独立窗口失焦是否隐藏 |
| `destroyTimeout` | 隐藏后多久销毁 |

### 7.3 Rust command

```rust
#[tauri::command]
async fn show_plugin_surface_window(
    app: AppHandle,
    plugin_id: String,
    surface_id: String,
    source: String,
    width: f64,
    height: f64,
    close_on_blur: bool,
    destroy_timeout_ms: u64,
) -> Result<(), String>
```

窗口 label：

```text
plugin-surface:{source}:{plugin_id}:{surface_id}
```

生命周期：

```text
不存在 → 创建窗口
已存在 → show + focus
Esc → hide
失焦 closeOnBlur=true → hide
hide 后启动 destroyTimer
destroyTimer 到期 → destroy
再次 show → 取消 destroyTimer
```

### 7.4 PluginSurfaceWindowApp

新增：

```tsx
export function PluginSurfaceWindowApp() {
  const params = new URLSearchParams(window.location.search)
  const source = params.get('source')
  const pluginId = params.get('pluginId')
  const surfaceId = params.get('surfaceId')

  return (
    <PluginSurfaceWindowChrome>
      <PluginSurfaceRenderer
        source={source}
        pluginId={pluginId}
        surfaceId={surfaceId}
      />
    </PluginSurfaceWindowChrome>
  )
}
```

`PluginSurfaceRenderer` 应复用 GlobalLauncher 当前 surface 渲染逻辑：

- definition lookup
- permission gate
- settings resolve
- storage
- clipboard
- paste
- network
- `beforeOpen`
- ErrorBoundary

但不要继续写在 GlobalLauncher 组件内部。

### 7.5 抽出 PluginSurfaceRenderer

新增：

```text
src/components/pluginSurface/PluginSurfaceRenderer.tsx
src/components/pluginSurface/PluginSurfaceErrorBoundary.tsx
src/components/pluginSurface/PluginSurfacePermissionGate.tsx
src/components/pluginSurface/createPluginSurfaceHost.ts
```

GlobalLauncher 内 surfaceFrame 和独立窗口都复用它。

---

## 8. 插件 attach / detach 与编辑器融合

### 8.1 为什么需要 attach

如果所有插件 surface 都是独立窗口，Hiven 会再次像“一堆小 app”。

为了让插件成为编辑器工作流的一部分，需要支持：

```text
插件 surface 独立打开
插件 panel 附着到编辑器 left/right/bottom
插件结果回填到当前编辑器
```

现有 `PanelHostV2` 已经提供基础。

### 8.2 推荐策略

分三种插件 UI：

| 类型 | 例子 | 默认打开方式 |
|---|---|---|
| Action Plugin | format JSON, base64 decode | Global Launcher / Editor Command Bar 直接执行 |
| Surface Plugin | clipboard history, translator, diff | 独立窗口或 launcher 内 transient |
| Attached Panel Plugin | translator preview, JSON inspector, shelf | Editor PanelHostV2 right/bottom |

### 8.3 API 建议

现有 `panels?: PanelContributionV2[]` 继续保留。

在 tool/surface 层新增推荐 placement：

```ts
type ToolPanelOptions = {
  placement?: 'bottom' | 'right' | 'left' | 'pane-bottom'
  attachable?: boolean
}
```

对于 translator：

```ts
ui: {
  surfaces: [{
    id: 'translator',
    entry: {
      launcher: true,
      shortcutBindable: true,
      shortcutPresentation: 'window'
    },
    shell: {
      defaultWidth: 720,
      defaultHeight: 520,
      closeOnBlur: false
    }
  }]
},
panels: [{
  id: 'translator-panel',
  defaultPlacement: 'right',
  component: TranslatorPanel
}]
```

全局打开：

```text
Open Translator Surface → PluginSurfaceWindow
```

编辑器内打开：

```text
Translate with Preview → panel.openV2(translator-panel, placement='right')
```

---

## 9. 对象-动作-输出模型

### 9.1 为什么不是继续只靠 LauncherItem

`LauncherItem` 适合：

```text
搜索命令 / 工具 / app
```

但它不擅长表达：

```text
搜索到一条剪贴板记录后，对它执行动作
搜索到当前选区后，对它执行动作
搜索到一个已打开窗口后，对它 focus / close
搜索到一个 URL 后，对它 open / summarize / copy
```

因此长期需要引入：

```text
WorkObject
WorkAction
OutputTarget
```

### 9.2 WorkObject

```ts
type WorkObject =
  | TextObject
  | ClipboardObject
  | AppObject
  | WindowObject
  | FileObject
  | UrlObject
  | PluginSurfaceObject
  | EditorDocumentObject

type BaseWorkObject = {
  id: string
  type: string
  title: string
  subtitle?: string
  icon?: string
  source: string
  createdAt?: number
  updatedAt?: number
}
```

### 9.3 WorkAction

```ts
type WorkAction = {
  id: string
  title: string
  icon?: string
  accepts: WorkObject['type'][]
  requiresContext?: ContextRequirement[]
  defaultOutputTarget?: OutputTargetKind
  run(input: WorkObject, ctx: WorkContext): Promise<ActionResult>
}
```

### 9.4 OutputTarget

```ts
type OutputTarget =
  | { kind: 'copy' }
  | { kind: 'paste-to-foreground-app' }
  | { kind: 'replace-editor-selection'; windowId?: string; paneId?: string; range?: TextRange }
  | { kind: 'insert-into-editor'; windowId?: string; paneId?: string }
  | { kind: 'open-in-editor'; language?: string; title?: string }
  | { kind: 'open-plugin-surface'; pluginId: string; surfaceId: string }
  | { kind: 'attach-editor-panel'; panelId: string; placement: 'right' | 'bottom' | 'left' }
  | { kind: 'save-to-shelf' }
```

### 9.5 迁移策略

不要一次推翻 LauncherItem。

短期：

```text
LauncherItem 继续作为一级搜索结果。
dynamicItems 可逐步返回 object-backed launcher item。
选择 object-backed item 后进入 action list。
```

中期：

```text
Provider 返回 WorkObject。
ActionRegistry 根据 object type 生成 actions。
LauncherView 支持 ObjectRow + ActionPane。
```

长期：

```text
LauncherItem 成为 WorkAction/WorkObject 的展示适配层。
```

---

## 10. Context Broker

### 10.1 目标

全局 Launcher 从任意软件唤起时，必须知道“当前有什么上下文”：

```text
前台 app
当前是否 Hiven editor
当前是否有选中文本
剪贴板内容
最近 surface
最近文本对象
```

编辑器内 Command Bar 也需要知道：

```text
activePaneId
selection
language
cursor
document text
open panels
```

### 10.2 Context Snapshot

```ts
type WorkContextSnapshot = {
  invocation: {
    source: 'global-hotkey' | 'editor-command-bar' | 'plugin-surface'
    timestamp: number
  }
  foreground?: {
    appName?: string
    processId?: number
    windowTitle?: string
  }
  editor?: EditorContextSnapshot
  clipboard?: ClipboardContextSnapshot
}

type EditorContextSnapshot = {
  windowLabel: 'editor'
  activePaneId: string
  paneIds: string[]
  language?: string
  selectedText?: string
  selectionRange?: TextRange
  cursor?: { line: number; column: number }
}
```

### 10.3 实现策略

短期：

- 全局 Launcher 只读剪贴板 + 前台 app 信息。
- 如果前台是 Hiven Editor，则通过 Tauri event 向 editor window 请求 snapshot。
- Editor Command Bar 直接从 workspaceStore/runtimeRegistry 获取 snapshot。

中期：

- 每个 Surface 注册 `getContextSnapshot()`。
- Window Manager 维护 active Hiven surface。
- Global Launcher 读取 active Hiven surface context。

---

## 11. 文件级重构计划

### 11.1 新增目录结构

```text
src/windows/
  LauncherWindowApp.tsx
  EditorWindowApp.tsx
  PluginSurfaceWindowApp.tsx
  WindowChrome.tsx

src/launcher/
  kernel/
    LauncherController.ts          // 从 workspace/launcher/controller.ts 迁移或 re-export
    LauncherSession.ts
    LauncherTypes.ts
  hosts/
    GlobalLauncherHost.tsx
    EditorCommandBarHost.tsx
  ui/
    LauncherShell.tsx
    LauncherSearchStep.tsx
    LauncherList.tsx
    LauncherListItem.tsx
    LauncherCollectInputStep.tsx
    LauncherResultStep.tsx
    LauncherFooter.tsx
  context/
    contextBroker.ts
    editorContext.ts
    clipboardContext.ts
  ranking/
    rankLauncherItems.ts           // 继续复用现有 ranking

src/surfaces/
  registry.ts
  PluginSurfaceRenderer.tsx
  PluginSurfaceWindowChrome.tsx
  surfaceHostApi.ts

src/workspace/windowManager/
  launcherWindow.ts
  editorWindow.ts
  pluginSurfaceWindows.ts
  windowLabels.ts
  geometry.ts

src/workflow/
  workObject.ts
  workAction.ts
  outputTarget.ts
  outputRouter.ts
```

### 11.2 修改现有文件

| 文件 | 改动 |
|---|---|
| `src/App.tsx` | 拆分窗口路由，移除 MainApp 的长期职责 |
| `src/main.tsx` | 按 `?window=` 渲染不同 WindowApp |
| `src/components/GlobalLauncher.tsx` | 逐步变成 `GlobalLauncherHost` wrapper |
| `src/components/CommandPalette.tsx` | 改成 `EditorCommandBarHost` wrapper |
| `src/views/EditorView.tsx` | 去除主窗口假设，适配独立窗口 |
| `src/store.ts` | 移除 ViewId/Sidebar 依赖，保留 launcher usage/settings |
| `src/workspace/workspaceStore.ts` | 拆成 ephemeral editor session 与 persistent shelf |
| `src/workspace/launcher/types.ts` | 扩展 hostId/context/capability |
| `src/workspace/launcher/registry.ts` | 支持 host capability filtering |
| `src/workspace/launcher/ranking.ts` | 加入 context-aware ranking |
| `src/workspace/pluginTypes.ts` | 加入 surface window 字段 |
| `src/workspace/pluginSurfaceOpenRequest.ts` | 区分 launcher/window presentation |
| `src/hotkeys/pluginSurfaceShortcuts.ts` | 快捷键分叉到独立窗口 |
| `src-tauri/src/lib.rs` | 新增 editor/plugin surface window commands |
| `src-tauri/tauri.conf.json` | 移除或延迟创建 main window，保留 launcher 初始窗口 |

---

## 12. 分阶段实施路线

### Phase 0：整理命名与边界，不大改行为

目标：

```text
先把“两个 app”的心智切开，但不做大窗口迁移。
```

任务：

1. `CommandPalette` 内部文案和代码 alias 改为 `EditorCommandBar`。
2. 编辑器内 Cmd+K 默认隐藏 app launch / system power / settings 等全局能力。
3. 在编辑器内保留 `Search all Hiven…` 项，触发全局 launcher。
4. 新增 `LauncherHostId` 类型，但兼容旧 `LauncherSurfaceId`。
5. 为 usage 增加 `editor-command-bar` bucket 兼容迁移。

验收：

- 用户在编辑器 Cmd+K 不会看到 Safari、Terminal、重启、关机。
- 用户可以从编辑器入口跳到全局 Launcher。
- 现有测试不破。

### Phase 1：Plugin Surface 独立窗口

目标：

```text
解决 GlobalLauncher surfaceFrame 覆盖问题。
```

任务：

1. `pluginTypes.ts` 新增：
   - `instancePolicy`
   - `shell.destroyTimeout`
   - `entry.shortcutPresentation`
2. Rust 新增 `show_plugin_surface_window` / `hide_plugin_surface_window`。
3. 新增 `pluginSurfaceWindows.ts`。
4. 新增 `PluginSurfaceWindowApp`。
5. 抽出 `PluginSurfaceRenderer`。
6. `pluginSurfaceShortcuts` 根据 `shortcutPresentation` 分叉。
7. 修复 GlobalLauncher closeOnBlur 尊重 `surface.shell.closeOnBlur`。
8. clipboard-history 声明 `shortcutPresentation: 'window'`。
9. 增加测试脚本。

验收：

- 快捷键打开剪贴板历史不会覆盖 GlobalLauncher 内正在打开的 translator。
- Esc 隐藏插件窗口，不立即销毁。
- destroyTimeout 到期后销毁。
- 再次快捷键显示原窗口或重建窗口。
- launcher 内打开 surface 仍保持旧行为。

### Phase 2：Editor 独立窗口

目标：

```text
让编辑器从 MainApp 中脱离，成为系统 Surface。
```

任务：

1. Rust 新增 `show_editor_window` / `close_editor_window`。
2. 新增 `EditorWindowApp`。
3. `main.tsx` 支持 `?window=editor`。
4. `EditorView` 移入 EditorWindow shell。
5. `CommandPalette` 移入 EditorWindow。
6. 全局 Launcher 新增/调整 `Open Editor` 命令。
7. `ctx.api.showMainPanel()` 语义改为 `showEditorWindow()`。
8. 支持从全局 Launcher 将 selection/clipboard 打开进 Editor。

验收：

- App 启动后不需要主窗口也可运行。
- 全局 Launcher 中执行“打开编辑器”会创建/聚焦 Editor Window。
- Editor Window 中 Cmd+K 正常。
- Editor Window 保留多 pane、PanelHostV2、plugin toolbar。
- 关闭 Editor Window 后重新打开为空编辑器。

### Phase 3：去主窗口

目标：

```text
完全移除 Sidebar / ViewId 主窗口模型。
```

任务：

1. `tauri.conf.json` 移除 `main` 初始窗口。
2. 启动时只创建 tray / launcher。
3. Settings 从 `SettingsView` 改成 launcher surface。
4. Plugins 从 `ScriptsView` 改成 launcher surface。
5. Plugin editor 变成 launcher surface 或独立 dev window。
6. 移除 `Sidebar`。
7. 移除 `ViewContent` / `ViewId` 依赖。
8. App 退出策略改为 tray 生命周期。
9. 确保没有 visible window 时 app 不退出。

验收：

- 启动 Hiven 不出现主窗口。
- 全局快捷键可唤起 launcher。
- 设置/插件管理可从 launcher 打开。
- 编辑器/插件窗口按需创建。
- 关闭所有窗口后 tray/background 仍运行。

### Phase 4：Launcher Kernel / UI Host 抽象

目标：

```text
消除 GlobalLauncher 与 EditorCommandBar 的 UI/host 重复。
```

任务：

1. 新增 `useLauncherSession`。
2. 抽出共享 `LauncherView`。
3. 抽出 `LauncherHostConfig`。
4. GlobalLauncherHost 和 EditorCommandBarHost 只提供：
   - hostId
   - capabilities
   - contextProvider
   - presentation
   - close behavior
5. 删除重复的 CollectInputStep / ResultStep / SearchStep。
6. 将 plugin surface rendering 从 GlobalLauncher 中移出。

验收：

- 两个 host 共享同一套 UI 基础件。
- 两个 host 有不同默认候选池和文案。
- Controller 仍保持 framework-agnostic。
- IME、参数输入、结果选择行为一致。

### Phase 5：对象-动作-输出模型

目标：

```text
从命令搜索升级到对象搜索和动作路由。
```

任务：

1. 新增 `WorkObject` 类型。
2. 新增 Provider Registry。
3. 剪贴板历史、应用、窗口、编辑器文档作为 WorkObject provider。
4. 新增 WorkAction Registry。
5. Launcher 支持：
   - 搜索对象
   - Tab 展开对象动作
   - 当前上下文对象默认置顶
6. 新增 `OutputRouter`。
7. 文本插件统一输出：
   - copy
   - paste
   - replace selection
   - insert into editor
   - open in editor
   - attach panel
   - save shelf

验收：

- 搜索剪贴板记录后可直接 paste / translate / open in editor。
- 搜索 app 后可 open / focus。
- 当前选区可被当成对象展示。
- JSON 剪贴板第一项能直接 format。
- 编辑器内 local launcher 只展示当前对象动作。

---

## 13. 关键交互故事

### 13.1 浏览器选中英文资料

```text
Chrome 选中文本
→ 全局快捷键
→ Hiven Global Launcher
→ “翻译当前选区 / 发送到编辑器 / 保存到资料架”
→ 选择发送到编辑器
→ Editor Window 打开，左侧原文，右侧翻译 panel
→ Cmd+K
→ Editor Command Bar
→ “替换当前选区 / 插入到下方 / 精简润色”
```

分工：

```text
Global Launcher：把外部对象带进 Hiven。
Editor Command Bar：修改当前编辑器内容。
```

### 13.2 聊天软件生成回复

```text
飞书消息选中
→ 全局快捷键
→ “生成稳妥回复 / 整理为待办 / 发送到编辑器”
→ 短回复直接 paste 回聊天输入框
→ 复杂回复送到 Editor
→ Cmd+K
→ “改得更礼貌 / 压缩成三句话 / 插入剪贴板片段”
```

分工：

```text
Global Launcher：理解外部上下文和路由。
Editor：承载需要斟酌的草稿。
```

### 13.3 复制乱 JSON

```text
复制 JSON
→ 全局快捷键
→ 输入 json
→ “格式化剪贴板 JSON”
→ 直接复制结果或打开 Editor
→ Editor Command Bar
→ “提取字段 / 压缩为单行 / 转 YAML”
```

分工：

```text
Global Launcher：替代 Boop 的短动作。
Editor Command Bar：继续局部文本处理。
```

### 13.4 找回剪贴板片段

```text
正在写邮件
→ 全局快捷键
→ 搜索剪贴板
→ 找到 API 地址
→ 插入到当前输入框或打开编辑器
→ Editor Command Bar
→ “整理成项目符号 / 引用为代码块 / 翻译片段”
```

分工：

```text
Global Launcher：找对象。
Editor Command Bar：改对象。
```

---

## 14. 技术风险与处理

### 14.1 多窗口状态同步

风险：

```text
Launcher、Editor、PluginSurface 是不同 WebviewWindow，Zustand/localStorage 不一定实时同步。
```

策略：

- 短期：通过 Tauri events 传递 open target / context snapshot。
- 中期：将跨窗口共享状态放到 Rust side 或持久存储。
- 不要让 Global Launcher 直接读 Editor DOM。
- Editor context 通过 snapshot 读取。

### 14.2 NonActivating Panel 与文本回填

风险：

```text
NonActivating Panel 不夺焦，但直接操作其他 app 输入框困难。
```

策略：

- 对外部 app：系统剪贴板 + simulate_paste。
- 对 Hiven Editor：通过 editor window event / effect router。
- 对 plugin window：通过 SurfaceRegistry / OutputRouter。

### 14.3 插件权限与独立窗口

风险：

```text
PluginSurfaceWindow 复制 GlobalLauncher 里的 permission/storage/network host 时容易重复。
```

策略：

- 抽出 `PluginSurfaceRenderer`。
- 抽出 `createPluginSurfaceHostApi`。
- GlobalLauncher 和 PluginSurfaceWindow 复用同一套渲染和权限逻辑。

### 14.4 编辑器不持久化导致数据丢失

风险：

```text
Scratch Pad 模式符合轻量化，但用户关闭窗口可能丢内容。
```

策略：

- 关闭前如果非空，提示：
  - copy
  - save to shelf
  - discard
- 或实现短 TTL autosave，但不自动恢复为工作区。
- 长期用 Text Shelf 管理主动保存的内容。

### 14.5 一次性重构过大

风险：

```text
去主窗口、插件独立窗口、Launcher 抽象、对象模型同时做会失控。
```

策略：

```text
先 PluginSurface 独立窗口
再 Editor 独立窗口
再去主窗口
再抽 Launcher Host
最后对象-动作模型
```

不要倒序。

---

## 15. 测试计划

### 15.1 新增测试脚本

```text
scripts/test-plugin-surface-window.mjs
scripts/test-editor-window-launch.mjs
scripts/test-no-main-window-startup.mjs
scripts/test-editor-command-bar-scope.mjs
scripts/test-global-launcher-open-editor.mjs
scripts/test-plugin-surface-shortcut-window.mjs
scripts/test-output-router-text-targets.mjs
scripts/test-context-snapshot-editor.mjs
```

### 15.2 关键测试用例

#### Plugin Surface 独立窗口

- 快捷键打开 clipboard-history 创建 `plugin-surface:builtin:clipboard-history:main`。
- 重复快捷键不 toggle，只 focus。
- Esc hide。
- hide 后 destroyTimeout 到期 destroy。
- closeOnBlur=false 时失焦不隐藏。
- launcher 内 surfaceFrame 不受快捷键 surface 覆盖。

#### Editor Window

- `Open Editor` 创建 editor window。
- 已有 editor window 时 focus。
- Cmd+W 关闭 editor window。
- 再打开为空。
- Editor Command Bar 可读 active pane selection。
- PanelHostV2 right/bottom/left 正常。

#### Launcher Scope

- Global Launcher 可搜 app / settings / plugins / editor。
- Editor Command Bar 不显示 app launch。
- Editor Command Bar 显示 format / translate / pane actions。
- Search all Hiven 可从 editor 跳全局。

#### Output Router

- selection → translate → replace editor selection。
- clipboard JSON → format → open editor。
- clipboard item → paste foreground app。
- plugin result → copy。
- plugin result → save shelf。

---

## 16. 迁移后的代码删除清单

最终可以删除或弱化：

```text
Sidebar.tsx
ViewContent / ViewId 主导航
MainApp
GlobalLauncher overlay mode in main window
command-palette 旧命名
workspaceStore persist for scratch editor
GlobalLauncher 内部直接渲染 plugin surface 的大块逻辑
重复的 CommandPalette SearchStep / CollectInputStep / ResultStep
```

最终应保留并强化：

```text
LauncherController
Launcher Registry
Launcher Ranking
Plugin Tool API
PanelHostV2
EffectRunner
Tauri NonActivating Panel 实现
Plugin storage / clipboard / paste / network API
```

---

## 17. 最终验收标准

### 产品验收

用户心智必须变成：

```text
我从任何地方呼出 Hiven。
Hiven 展示当前对象和相关动作。
短任务直接完成。
长任务进入编辑器或插件 Surface。
编辑器内 Cmd+K 只处理当前内容。
```

用户不应该感觉：

```text
我在两个 app 之间切换：
一个叫 Launcher，一个叫 Editor。
```

### 架构验收

代码结构必须满足：

```text
全局 Launcher 和 Editor Command Bar 共享 kernel。
Global Launcher 不再承载长期插件工作现场。
Editor 是独立窗口，不是主窗口 view。
插件 Surface 可独立窗口，不互相覆盖。
插件可附着到 Editor PanelHostV2。
输出去向由统一路由处理。
```

### 行为验收

```text
启动 Hiven → 不出现主窗口。
全局快捷键 → 出现 Spotlight Launcher。
输入 editor → 打开编辑器窗口。
编辑器 Cmd+K → 只出现编辑器局部动作。
插件快捷键 → 打开插件独立窗口。
剪贴板历史选择 → 可 paste 到前台 app。
复杂文本 → 可送入 Editor。
Editor 中可附着 translator / clipboard / json panel。
关闭所有窗口 → tray/background 仍运行。
```

---

## 18. 推荐优先级

如果只选一个最先做：

```text
先做 Phase 1：Plugin Surface 独立窗口。
```

原因：

- 与今日问题最直接：解决 surfaceFrame 覆盖。
- 对现有主窗口冲击小。
- 会沉淀窗口管理、PluginSurfaceRenderer、URL 路由等基础设施。
- 这些基础设施会直接复用于 Editor 独立窗口。

第二步：

```text
Phase 2：Editor 独立窗口。
```

第三步：

```text
Phase 3：去主窗口。
```

不要先做完整 Object/Action 模型。它是正确方向，但太大，应该等窗口和 host 边界稳定后再做。

---

## 19. 一句话设计原则

```text
Hiven 不是把 Raycast、uTools、Boop 和编辑器塞进同一个壳。
Hiven 是把它们拆成对象、动作、Surface 和输出去向，再用一个全局入口和一个局部编辑入口组织起来。
```

最终架构的关键不是“所有东西长得一样”，而是：

```text
一个入口
统一对象
统一动作
统一输出
多个 Surface
清晰层级
```
