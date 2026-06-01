# Multi Pane Diff 与结构化 Diff 实施方案

## 背景

当前 Workspace / Panel / Presentation 能力已经初步落地，基础链路可以跑通：

```text
多 Pane 编辑
普通 Action 作用于 active pane
Regex Tester bottom panel
Monaco Diff presentation
Render Status
```

但现有实现仍然是原型状态。下一阶段要把 Diff 从“两个 pane 的 Monaco Diff 演示”升级成可扩展能力：

```text
1. 多 Panel / 多 Pane 场景下的 Diff 选择机制
2. 可扩展 Diff renderer，包括 JSON object semantic diff
3. Action 对输入 Pane 数量不足、过多时的统一处理
```

说明：本文里的 “Panel” 指用户看到的编辑面板。代码层当前对应 `Pane`。插件交互面板仍称 `PanelInstance`，不要混用。

## 当前问题

### 1. 多 Pane Diff 会静默猜测

当前 `diff-panes` 在两个 pane 时直接比较；超过两个 pane 时使用：

```text
previousActivePaneId + activePaneId
```

这会导致用户不知道到底比较了哪两个 Pane。后续必须改成显式选择。

### 2. Pane 不足时没有明确交互

当前只有一个 Pane 时，Diff 只输出 console log：

```text
Need at least 2 panes to diff
```

用户没有下一步。需要提供补齐输入的交互，例如：

```text
Create Right Pane
Use Clipboard as Modified
Choose Existing Pane
Cancel
```

### 3. Presentation 退出状态不完整

现有 Render Status 里直接调用 `executeExitPolicy`，只释放 occupancy/runtime owner，不一定删除 `presentations` store 里的 session。执行人需要统一走 `EffectRunner` 或专门的 `closePresentationSession`，保证：

```text
occupancy 清理
runtime 清理
presentation store 删除
UI 恢复普通 pane renderer
```

### 4. WorkspaceShell 只支持一个全局 active presentation

当前 `WorkspaceShell` 查找一个 active presentation 后直接替换整个 Workspace。后续多 Pane / pane-scoped renderer / 多 presentation 会被卡住。需要改成按 surface 解析：

```text
每个 Pane 决定自己当前 renderer。
workspace-level presentation 才替换整个 main surface。
split-view presentation 只占用声明的 Pane。
```

### 5. 冲突确认没有闭环

`EffectRunner` 能返回 `pendingConfirmations`，但 Command Palette 没有处理。后续选择器和 Diff renderer 都依赖冲突处理，因此必须补齐。

## 目标

### 产品目标

用户可以在多个编辑面板中明确选择参与 Diff 的两个或多个输入，并选择 Diff 类型：

```text
Text Line Diff
JSON Object Diff
未来扩展：CSV Diff、XML Diff、Markdown Diff
```

如果 Action 需要两个 Pane：

```text
当前 2 个 Pane：
  直接执行，仍在 toolbar 中明确显示 A ↔ B。

当前 1 个 Pane：
  打开补齐输入的选择器，不静默创建。

当前 3+ 个 Pane：
  打开 Pane Picker，让用户选择 Original / Modified。
```

### 工程目标

建立通用输入选择协议：

```text
Action 声明需要几个 Pane / 哪些 role
系统根据当前 Workspace 状态解析输入
不足或过多时打开选择器
选择完成后返回 selected inputs
Diff renderer 按 selected inputs 执行
```

建立通用 Diff 扩展协议：

```text
Diff Action 不绑定 Monaco DiffEditor
Diff Renderer 可注册
Renderer 声明支持的输入数、数据类型、展示模式
JSON object diff 作为一个 renderer/plugin 实现
```

## 核心设计

### Pane Selection Request

新增统一选择请求：

```ts
type PaneSelectionRequest = {
  id: string
  sourceCommandId: string
  title: string
  roles: PaneSelectionRole[]
  allowedPaneIds?: PaneId[]
  defaultSelection?: Record<string, PaneId>
  allowCreatePane?: boolean
  allowClipboard?: boolean
  allowEmptyPane?: boolean
  onConfirm: (selection: PaneSelectionResult) => void
  onCancel: () => void
}

type PaneSelectionRole = {
  key: string
  label: string
  required: boolean
  acceptedKinds?: DiffInputKind[]
}

type PaneSelectionResult = {
  roles: Record<string, PaneSelectionValue>
}

type PaneSelectionValue =
  | { type: 'pane'; paneId: PaneId }
  | { type: 'clipboard'; text: string; createPane?: boolean }
  | { type: 'empty-pane'; createPane: true }
```

Diff Panes 的 request：

```ts
{
  sourceCommandId: 'diff-panes',
  title: 'Select panes to compare',
  roles: [
    { key: 'original', label: 'Original', required: true },
    { key: 'modified', label: 'Modified', required: true },
  ],
  allowCreatePane: true,
  allowClipboard: true,
  allowEmptyPane: true,
}
```

### Pane Selection 规则

#### 当前只有 1 个 Pane

不要自动创建空 Pane。打开选择器，默认：

```text
Original = current active pane
Modified = Choose...
```

可选动作：

```text
Use Clipboard
Create Empty Right Pane
Duplicate Current Pane
Cancel
```

推荐行为：

```text
如果剪贴板有非空文本：
  Modified 默认推荐 Use Clipboard，但仍需用户确认。

如果剪贴板为空：
  推荐 Create Empty Right Pane。
```

确认后：

```text
Use Clipboard:
  创建新 Pane，内容为 clipboard text，然后打开 Diff。

Create Empty Right Pane:
  创建空 Pane，聚焦到新 Pane，不立即进入 Diff。
  原因：用户还没填 modified 内容，直接进入 Diff 体验差。

Duplicate Current Pane:
  创建内容相同的新 Pane，然后打开 Diff。
```

#### 当前正好 2 个 Pane

直接执行，但 toolbar 必须显示：

```text
Diff: Pane A ↔ Pane B
Renderer: Text Line Diff
```

同时提供 `Swap` 和 `Change Panes`：

```text
Swap:
  original / modified 对调。

Change Panes:
  打开 Pane Picker。
```

#### 当前 3+ 个 Pane

必须打开 Pane Picker。默认值：

```text
Original = previousActivePaneId，如果存在
Modified = activePaneId
```

但 UI 必须展示并让用户确认。

不要静默使用默认值。

### Pane Picker UI

用 `PanelEffect` 打开一个 `command-popover` 或 `floating` panel：

```text
Select panes to compare

Original: [Pane A ▼]
Modified: [Pane C ▼]
Diff type: [Text Line Diff ▼]

[Start Diff] [Cancel]
```

如果当前只有一个 Pane：

```text
Select comparison input

Original: Pane A
Modified:
  ○ Use Clipboard
  ○ Create Empty Right Pane
  ○ Duplicate Pane A

[Continue] [Cancel]
```

选择器不是 Diff 专用。未来任何 Action 都可以声明输入需求复用它。

## Diff 扩展协议

### DiffInput

Diff renderer 不应直接读 workspace store。它接收标准输入：

```ts
type DiffInput = {
  role: 'original' | 'modified' | 'base' | 'variant'
  source: { type: 'pane'; paneId: PaneId }
  title: string
  text: string
  language?: string
  kind: DiffInputKind
}

type DiffInputKind =
  | 'text'
  | 'json'
  | 'csv'
  | 'xml'
  | 'unknown'
```

`kind` 由系统初步推断，renderer 可二次校验。

### DiffRenderer

新增或扩展 renderer 注册：

```ts
type DiffRenderer = {
  id: string
  title: string
  supportedInputCounts: number[]
  supportedKinds: DiffInputKind[]
  supportedModes: DiffDisplayMode[]
  canHandle(inputs: DiffInput[]): DiffCapabilityResult
  createSession(ctx: DiffRendererContext): PresentationSession
}

type DiffDisplayMode =
  | 'side-by-side'
  | 'inline'
  | 'tree'
  | 'summary'

type DiffCapabilityResult = {
  ok: boolean
  confidence: 'high' | 'medium' | 'low'
  reason?: string
}
```

Text renderer：

```text
id = text-line-diff
supportedInputCounts = [2]
supportedKinds = ['text', 'json', 'csv', 'xml', 'unknown']
mode = side-by-side / inline
implementation = Monaco DiffEditor
```

JSON renderer：

```text
id = json-object-diff
supportedInputCounts = [2]
supportedKinds = ['json']
mode = side-by-side / tree / summary
implementation = JSON normalize + semantic diff
```

### Renderer 选择

Diff command 打开前应选择 renderer：

```text
如果两个输入都能 parse JSON：
  默认推荐 JSON Object Diff。
  用户可切换 Text Line Diff。

否则：
  默认 Text Line Diff。
```

Picker 里的 Diff type：

```text
Auto
Text Line Diff
JSON Object Diff
```

Auto 规则：

```text
JSON Object Diff canHandle high -> JSON Object Diff
否则 -> Text Line Diff
```

不要在 JSON parse 失败时静默做 JSON diff。要显示：

```text
Invalid JSON in Modified. Use Text Line Diff instead?
```

## JSON Object Diff 设计

### 核心目标

JSON Object Diff 不是简单字符串 diff。它应能识别：

```text
对象 key 顺序不同但语义相同
对象字段新增 / 删除 / 修改
嵌套对象变化
数组变化
数字、字符串、boolean、null 类型变化
```

### Normalize

先把 JSON parse 成 AST，再 canonicalize：

```ts
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

type NormalizedJsonNode = {
  path: string
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  value?: string | number | boolean | null
  children?: NormalizedJsonNode[]
}
```

对象规则：

```text
Object key 按稳定字典序排序。
因此 {"b":1,"a":2} 与 {"a":2,"b":1} 视为相同。
```

数组规则：

```text
默认数组保序。
原因：数组在 JSON 语义上通常有序，不能默认当作 set。
```

数组扩展策略：

```ts
type JsonArrayCompareMode =
  | { type: 'by-index' }
  | { type: 'unordered-scalar' }
  | { type: 'by-object-key'; key: string }
```

默认：

```text
by-index
```

可在 JSON Diff options 中提供：

```text
Array compare: By index / Unordered scalar / By object key...
```

### Diff 算法

输出结构化变更：

```ts
type JsonDiffChange =
  | {
      kind: 'added'
      path: string
      newValue: JsonValue
    }
  | {
      kind: 'removed'
      path: string
      oldValue: JsonValue
    }
  | {
      kind: 'changed'
      path: string
      oldValue: JsonValue
      newValue: JsonValue
      oldType: string
      newType: string
    }
  | {
      kind: 'moved-or-reordered'
      path: string
      note: string
    }
```

对象 diff：

```text
对 key 集合取 union。
只在 original 有 -> removed
只在 modified 有 -> added
两边都有 -> 递归比较
```

数组 by-index diff：

```text
逐 index 比较。
长度增加 -> added
长度减少 -> removed
同 index 值不同 -> changed 或递归
```

数组 unordered-scalar diff：

```text
只适用于 string/number/boolean/null 数组。
按值计数比较。
```

数组 by-object-key diff：

```text
只适用于 object array。
用指定 key 建索引。
key 缺失的元素 fallback 到 by-index 或标记 unsupported。
```

### JSON Diff 展示

第一种展示方式：Canonical Text + Monaco Diff

```text
把 original / modified 都 stable stringify。
使用 Monaco DiffEditor 展示。
对象 key 顺序差异会被消除。
```

这是最容易落地的版本，但需要在 toolbar 明确：

```text
JSON Object Diff · keys sorted
```

第二种展示方式：Change Tree

```text
左侧 Path 列表：
  + $.user.email
  - $.user.age
  ~ $.items[2].price

右侧显示 old/new value。
```

建议分阶段：

```text
先实现 Canonical Text + Monaco Diff。
再实现 Change Tree。
```

### JSON Diff 错误处理

```text
Original parse failed:
  显示 JSON parse error，定位 line/column。

Modified parse failed:
  显示 JSON parse error，定位 line/column。

两边都 parse failed:
  禁用 JSON Object Diff，建议 Text Line Diff。
```

不要自动修改用户文本。

## Presentation / Surface 规则

### Diff Session

Diff session 应记录：

```ts
type DiffSession = PresentationSession & {
  kind: 'diff'
  rendererId: string
  inputs: DiffInput[]
  displayMode: DiffDisplayMode
  options: Record<string, unknown>
}
```

当前 `PresentationSession.options` 可以先承载这些字段，但执行人必须保证：

```text
targetPaneIds 和 inputs 一致。
rendererId 明确。
toolbar 能显示 renderer title。
```

### 退出 Diff

必须统一走 Effect：

```ts
applyEffects([{ type: 'presentation.close', sessionId }])
```

不要在组件里只调用：

```text
releaseOccupancy(...)
```

关闭 Diff 必须同时：

```text
dispose DiffEditor
release occupancy
delete presentation session
restore normal pane editors
preserve pane text
```

### 多 Presentation

本阶段不要求同屏多个 Diff session，但架构不能阻止未来扩展。

当前规则：

```text
同一组 Pane 同时只能有一个 renderer exclusive presentation。
workspace:main 同时只能有一个 exclusive presentation。
不同 Pane 组的 presentation 暂不开放并行 UI。
```

如果用户尝试打开第二个 Diff：

```text
如果占用相同 Pane：提示替换。
如果占用不同 Pane：可以先提示当前只支持一个 active Diff。
```

## 需要修改的文件

### 新增

```text
src/workspace/paneSelection.ts
  PaneSelectionRequest / Result 类型和 helper。

src/components/workspace/PaneSelectionPanel.tsx
  选择 Original / Modified / Diff type 的 UI。

src/workspace/diffRegistry.ts
  DiffRenderer 注册表。

src/workspace/diffInput.ts
  从 selected panes 构造 DiffInput，推断 kind。

src/workspace/jsonDiff.ts
  JSON parse、normalize、semantic diff、stable stringify。

src/presentations/jsonObjectDiffRenderer.tsx
  JSON Object Diff renderer。
```

### 修改

```text
src/commands/workspaceCommands.ts
  diff-panes 改为走 PaneSelectionRequest + DiffRenderer。

src/workspace/effectRunner.ts
  pendingConfirmations 必须能被 UI 消费；presentation.close 必须完整关闭 session。

src/workspace/surfaceCoordinator.ts
  release occupancy 不应假装等于关闭 session；提供 closePresentationOccupancy helper 或由 effectRunner 统一协调。

src/components/CommandPalette.tsx
  处理 pendingConfirmations 和 PaneSelectionRequest。

src/components/workspace/WorkspaceShell.tsx
  从单 activePresentation 改为 surface-based renderer resolution。

src/components/workspace/PresentationHost.tsx
  支持 rendererId / displayMode / inputs。

src/presentations/monacoDiffRenderer.tsx
  改名或注册为 text-line-diff；支持 toolbar Change Panes / Diff Type。

src/components/workspace/RenderStatusBar.tsx
  Exit presentation 必须走 effectRunner。
```

## Milestone 拆解

### Milestone 1：修复 Presentation / Surface 基础闭环

目标：

```text
先把现有 Diff session 的关闭、冲突确认、状态恢复修正确。
```

验收：

```text
RenderStatus 点 Exit 后，presentation store 删除。
WorkspaceShell 恢复普通 Pane editor。
occupancy 被释放。
DiffEditor runtime 被 unregister。
CommandPalette 遇到 pendingConfirmations 不再静默成功。
```

测试：

```text
npm run build
手动验证：打开 Diff -> 状态栏 Exit -> 回到 split editor
手动验证：打开 Diff 后再次打开冲突 presentation，有明确提示或错误
```

### Milestone 2：Pane Selection 协议与 UI

目标：

```text
所有需要多个 Pane 的命令统一走 PaneSelectionRequest。
```

验收：

```text
1 个 Pane 执行 Diff：出现补齐输入选择器。
2 个 Pane 执行 Diff：直接打开 Diff。
3+ 个 Pane 执行 Diff：出现 Original / Modified picker。
Picker 取消后不改变 layout、不打开 Diff。
Picker 确认后 targetPaneIds 正确。
```

### Milestone 3：Text Line Diff Renderer 抽象

目标：

```text
把现有 Monaco Diff 从特殊 presentation 抽成 text-line-diff renderer。
```

验收：

```text
Diff toolbar 显示 Text Line Diff。
支持 side-by-side / inline。
支持 Swap。
支持 Change Panes。
支持 Exit。
编辑 Diff 左右两边能同步回对应 Pane。
```

### Milestone 4：JSON Object Diff 核心算法

目标：

```text
实现 JSON parse、normalize、stable stringify 和 semantic diff。
```

验收：

```text
对象 key 顺序不同不产生差异。
字段新增/删除/修改能被识别。
嵌套对象变化能输出 path。
数组默认 by-index。
非法 JSON 返回 parse error，不修改用户文本。
```

### Milestone 5：JSON Object Diff Renderer

目标：

```text
在 Diff type 中支持 JSON Object Diff。
```

验收：

```text
两个合法 JSON pane 默认推荐 JSON Object Diff。
Canonical Text + Monaco Diff 能展示 key sorted 后的结果。
用户可切回 Text Line Diff。
非法 JSON 时禁用 JSON Object Diff，并展示原因。
```

### Milestone 6：JSON Diff Options

目标：

```text
补充 JSON Diff 的数组比较策略。
```

验收：

```text
默认 array by-index。
支持 unordered scalar array。
支持 object array by key。
策略切换后 diff 重新计算。
```

## 执行注意事项

```text
不要再用 previousActivePaneId 静默决定多 Pane Diff。
不要在只有一个 Pane 时自动创建空 Pane 并直接进入 Diff。
不要把 JSON Object Diff 简化成普通字符串 diff。
不要让 releaseOccupancy 替代 closePresentation。
不要在 renderer 里直接读取任意 workspace 状态；renderer 应吃 DiffInput。
不要让 picker 取消后产生任何副作用。
```

## 最终验收场景

```text
场景 1：一个 Pane
  输入 A，执行 Diff。
  系统提示选择 Modified 来源。
  选择 Clipboard 后创建新 Pane 并打开 Diff。

场景 2：两个 Pane
  左右 Pane 输入文本。
  执行 Diff。
  直接打开 Text Line Diff。
  Exit 后回到两个 Pane，文本不丢。

场景 3：三个 Pane
  执行 Diff。
  Picker 显示 Original/Modified。
  用户选择 Pane A 和 Pane C。
  Diff toolbar 显示 Pane A ↔ Pane C。

场景 4：JSON key 顺序
  Pane A: {"a":1,"b":2}
  Pane B: {"b":2,"a":1}
  JSON Object Diff 显示无语义差异。

场景 5：JSON 字段变化
  Pane A: {"user":{"name":"A","age":1}}
  Pane B: {"user":{"name":"A","age":2,"email":"x"}}
  JSON Object Diff 显示 $.user.age changed，$.user.email added。

场景 6：非法 JSON
  选择 JSON Object Diff。
  Modified parse failed。
  UI 展示错误，并允许切换 Text Line Diff。
```
