# Pinned Action 与脚本自适应专项

## 背景

FluxText 当前的 Action 主要是一次性命令：

```text
Editor 文本 / 选区 -> Cmd+K 选择 Action -> 执行 -> 替换文本
```

这个模式适合偶发处理，但对高频、小工具型场景不够顺手。例如时间戳转换、Base64、URL 编解码、进制转换、Query String 转换等，用户更想要：

```text
固定一个工具 -> 左侧粘贴输入 -> 右侧实时看到输出
```

同时，很多现有脚本的参数其实可以由输入自动判断，不应该强迫用户先选择模式。

本专项拆成两个独立轨道：

```text
1. 脚本自适应增强
   扫描现有脚本，把可由输入判断的 mode 逻辑内置进去，减少用户参数选择。

2. Pinned Action / Live Runner
   把高频 Action 固定成常驻工具，支持私有输入区、实时输出区和可选控制面板。
```

## 设计原则

### 先推断，再询问

```text
能从输入推断的，不展示参数。
只有用户意图无法从输入判断时，才展示控制面板。
```

例如时间戳：

```text
10 位数字 -> 秒级 timestamp
13 位数字 -> 毫秒 timestamp
16 位数字 -> 微秒 timestamp
19 位数字 -> 纳秒 timestamp
ISO 日期字符串 -> 日期转 timestamp
常见日期字符串 -> 日期转 timestamp
```

用户不应该先选择“秒 / 毫秒 / 日期转时间戳”。脚本应该自己判断。

### 参数面板是补充意图，不是默认门槛

Pinned Action 可以有控制面板，但控制面板只用于无法从输入推断的选择：

```text
时区
输出格式
大小写敏感
排序方向
哈希算法
正则表达式 pattern
```

这些参数应通过之前设计的 Panel 能力承载，而不是塞进主输入区。

### Pinned Action 不是简单收藏

Pinned Action 的本质是：

```text
把一次性 Command 固定成一个可驻留的 Live Tool。
```

它有自己的输入 buffer、输出 surface、运行状态、控制面板和生命周期。

### 配置常驻，实例懒加载

Pinned Action 不等于一直挂载一个完整工具实例。

必须区分：

```text
Pinned Definition:
  被 pin 的配置，轻量、可持久化，启动时可以全部读取。

Pinned Runtime:
  输入 editor、输出 editor、panel、Monaco model、运行任务、decorations 等重资源，只在用户打开时创建。
```

应用启动时只能加载 Pinned Definition，不允许为每个 pinned action 创建 Monaco editor 或 panel。

如果用户 pin 了 20 个 action，启动时应只是 sidebar 多 20 个入口。只有点击某个 pinned action 时，才创建该 action 的 Live Runner runtime。

## 轨道一：脚本自适应增强

### 目标

先不改整体架构，只优化现有内置脚本的判断逻辑，让用户少选参数、少走一次命令配置。

验收目标：

```text
用户粘贴明显可判断的输入时，脚本直接给出合理结果。
参数仍保留作为 override 或高级设置。
无法判断时，不胡乱转换，返回明确提示。
```

### 候选脚本扫描

基于当前 `src/builtin-scripts/manifest.json` 和重点脚本初扫，建议优先处理：

```text
timestamp.ts
  当前需要 mode: to-date / to-ts / now。
  可新增 auto mode，并把默认改成 auto。

base64.ts
  当前需要 mode: encode / decode。
  可检测输入是否像合法 Base64，并默认自动 decode；否则 encode。

url.ts
  当前需要 mode: encode / decode。
  可检测是否包含百分号编码或 URL query 特征，默认自动 decode；否则 encode。

querystring.ts
  当前需要 mode: json2qs / qs2json。
  可检测输入是否 JSON object；否则检测 query string。

hex.ts
  当前需要 mode: dec2hex / hex2dec / dec2bin / bin2dec。
  可检测 0x、纯二进制、纯十进制、纯 hex，并输出多种常用表示。

json.ts
  当前需要 mode: pretty / compact。
  Pretty/compact 不是总能从输入唯一推断，但可做 toggle 策略：已压缩 JSON 默认 pretty，已 pretty JSON 默认 compact 或继续 pretty。

sort.ts / dedup.ts
  ignoreCase、direction 不能可靠从输入判断。
  保留参数，将来通过 Pinned Action 控制面板调整。

hash.ts
  algorithm 不能从输入判断。
  保留参数，将来通过 Pinned Action 控制面板调整。

case.ts
  目标大小写不能从输入判断。
  保留参数，将来通过 Pinned Action 控制面板调整。
```

### 自适应脚本规则

每个增强脚本都应遵守：

```text
1. 增加 auto mode，默认使用 auto。
2. 保留原显式 mode，避免老用户失去控制。
3. auto mode 必须返回确定性结果。
4. 判断置信度不足时，返回错误或提示，不要猜。
5. 多行输入按行处理，除非脚本语义要求整体处理。
6. 错误输出不要覆盖成模糊文本，应包含原因和建议。
```

建议统一返回格式：

```text
成功：
  直接返回转换结果。

无法判断：
  Error: Cannot infer input type. Choose a mode explicitly.

非法输入：
  Error: Invalid <type>: <reason>
```

### 具体脚本设计

#### Timestamp Convert

输入判断：

```text
空输入：
  输出当前时间：seconds、milliseconds、ISO。

纯数字：
  10 位 -> seconds to ISO
  13 位 -> milliseconds to ISO
  16 位 -> microseconds to ISO
  19 位 -> nanoseconds to ISO

包含日期分隔符或 T/Z：
  Date.parse 成功 -> 输出 seconds、milliseconds、ISO。

多行：
  每行独立转换。
```

失败规则：

```text
数字长度不是 10/13/16/19 且无法合理 parse：
  Error: Cannot infer timestamp unit.
```

#### Base64 Encode/Decode

输入判断：

```text
trim 后符合 Base64 字符集，长度为 4 的倍数，decode 后可得到有效 UTF-8：
  decode

否则：
  encode
```

注意：

```text
纯英文短词可能误判为 Base64。
为避免误 decode，decode 后需要满足：
  - 可打印字符比例高
  - 或包含常见结构字符，如 { [ < : / 空格 换行
否则按 encode 处理。
```

#### URL Encode/Decode

输入判断：

```text
包含 %XX 且 decodeURIComponent 成功：
  decode

包含明显未编码空格、中文、特殊符号：
  encode

已是普通 URL 且没有编码片段：
  默认 encodeURIComponent 整体可能破坏 URL。
  应提示选择显式模式，或只 encode query value 需要未来面板支持。
```

#### JSON ↔ Query String

输入判断：

```text
trim 后以 { 开头并能 JSON.parse 成 object：
  JSON -> Query String

以 ? 开头，或包含 a=b / & 分隔：
  Query String -> JSON

其他：
  Error: Cannot infer JSON or query string.
```

#### Number Base Convert

输入判断：

```text
0x 前缀 -> hex input
0b 前缀 -> binary input
只含 0/1 且长度 > 1 -> binary input
只含 0-9 -> decimal input
只含 0-9a-fA-F 且包含 a-fA-F -> hex input
```

auto 输出不应该只输出一种方向。建议输出多表示：

```text
dec: 255
hex: FF
bin: 11111111
oct: 377
```

这更符合“自适应工具”的心智。

## 轨道二：Pinned Action / Live Runner

### 目标

支持用户把高频 Action 固定为常驻工具：

```text
左侧 sidebar 累积展示 pinned actions。
点击 pinned action 后进入 Live Runner。
Live Runner 左侧输入，右侧实时输出。
参数和高级控制通过动态 Panel 提供。
```

### 用户体验

Sidebar 增加 Pinned 区域：

```text
Editor
Scripts
Debugger
Settings

Pinned
  Timestamp
  Base64
  Regex Tester
```

同一个 Action 默认只 pin 一次。再次 pin 时聚焦已有 pinned item。

Pinned Runner 页面：

```text
┌────────────────────────────────────┐
│ Timestamp Convert   Auto  Controls │
├────────────────────────────────────┤
│ Input              │ Output         │
│ paste here         │ live result    │
├────────────────────────────────────┤
│ Ready · inferred milliseconds · 2ms │
└────────────────────────────────────┘
```

基础操作：

```text
Auto Run on/off
Run Now
Copy Output
Apply Output to Active Pane
Send Output to New Pane
Clear Input
Clear Output
Open Controls
Unpin
```

`Apply Output to Active Pane` 必须显式点击，Pinned Runner 不自动改主 Editor。

### 全局命令面板

增加全局 launcher，用于快速跳转：

```text
Pinned Actions
Recent Commands
Workspace Views
Open Panels
Settings
```

推荐快捷键：

```text
Cmd+K:
  当前上下文命令面板。

Cmd+Shift+K:
  全局 launcher。
```

在任何地方触发全局 launcher，都可以快速切到 pinned action。

### Pinned Action 状态

```ts
type PinnedAction = {
  id: string
  actionId: string
  title: string
  icon?: string
  inputText: string
  outputText: string
  outputKind: 'text' | 'error' | 'presentation'
  params: Record<string, unknown>
  autoRun: boolean
  debounceMs: number
  controlsOpen: boolean
  controlPanelInstanceId?: string
  lastRunAt?: number
  lastDurationMs?: number
  lastError?: string
}
```

持久化：

```text
pinned action 列表
顺序
params
autoRun
debounceMs
controlsOpen
inputText，可由设置决定是否持久化
```

不持久化：

```text
outputText
lastError
lastDurationMs
controlPanelInstanceId
运行中的 promise
Monaco editor instance
Monaco model
Panel instance
decorations/widgets/view zones
```

### Pinned Runtime

Pinned Runtime 是可创建、可暂停、可释放的重资源。

```ts
type PinnedRuntime = {
  pinnedId: string
  status: 'cold' | 'loading' | 'active' | 'idle' | 'disposing' | 'disposed'
  inputModelId?: string
  outputModelId?: string
  inputEditorId?: string
  outputEditorId?: string
  controlPanelInstanceId?: string
  disposables: Disposable[]
  lastActivatedAt: number
  lastInteractedAt: number
  pendingRunId?: string
}
```

状态含义：

```text
cold:
  只有 PinnedAction 配置，没有 runtime。

loading:
  用户打开 pinned action，正在创建 Monaco model/editor/panel。

active:
  当前可见或刚刚交互过。

idle:
  不可见或长时间未交互，但暂时保留 runtime，便于快速切回。

disposing:
  正在释放 editor、model、panel、subscriptions。

disposed:
  runtime 已释放，保留 PinnedAction 配置。
```

### 动态加载规则

打开 pinned action 时：

```text
1. 读取 PinnedAction definition。
2. 如果 runtime 不存在或已 disposed，创建 runtime。
3. 创建 input/output Monaco model。
4. 按需 mount input/output editor。
5. 如果 controlsOpen=true，打开 control panel。
6. 如果 inputText 非空且 autoRun=true，触发一次 debounce run。
7. 设置 status=active。
```

切换到另一个 pinned action 时：

```text
1. 当前 pinned action 标记为 idle。
2. 新 pinned action 按上述规则 activate。
3. idle runtime 不立即释放，等待 idle timeout。
```

切回 idle pinned action 时：

```text
如果 runtime 仍存在：
  直接恢复 editor/model/viewState。

如果 runtime 已释放：
  从 PinnedAction definition 重新创建 runtime。
  inputText 从持久化状态恢复。
  outputText 如未持久化，则显示 stale，需要重新运行。
```

### 超时释放规则

Pinned Runtime 必须支持空闲释放。

建议默认：

```text
idleTimeoutMs = 5 * 60 * 1000
maxWarmRuntimes = 3
```

释放触发条件：

```text
1. runtime 状态为 idle。
2. 当前时间 - lastInteractedAt > idleTimeoutMs。
3. runtime 没有 pending run。
4. control panel 没有 dirty 状态。
5. runtime 不是当前可见 pinned action。
```

如果 warm runtime 数超过 maxWarmRuntimes：

```text
按 lastInteractedAt 从旧到新释放。
当前 active runtime 不释放。
dirty runtime 不自动释放。
```

释放时必须：

```text
dispose input/output editor。
dispose Monaco model。
close 或 dispose control panel。
dispose runtime disposables。
清理 owner 下的 decorations/widgets/view zones。
取消 pending debounce timer。
如果有 pending async run，标记 runId invalid，结果返回后丢弃。
status -> disposed。
```

释放时不应该：

```text
删除 PinnedAction definition。
清空 inputText。
修改 params。
改变 sidebar pin 顺序。
自动写回主 Editor。
```

### 释放前保存

释放 runtime 前需要把轻量状态写回 PinnedAction：

```text
inputText
params
autoRun
debounceMs
controlsOpen
```

outputText 默认不持久化。原因：

```text
输出可以由输入重新计算。
持久化大量 output 会增加存储压力。
某些输出可能包含临时错误或敏感派生内容。
```

如果未来需要，可增加 per-action 设置：

```ts
persistOutput?: boolean
```

但默认必须是 false。

### Tombstone 机制

Pinned Action 的超时释放应采用类似 Apple 系统的 tombstone 思路：

```text
Runtime 被释放时，不把这个工具当成完全没存在过。
系统保留一个轻量 Tombstone，记录足够恢复用户上下文的信息。
用户再次打开时，根据 Tombstone 快速恢复输入、参数、滚动位置、上次状态，再按需重建 Monaco runtime。
```

这比单纯 `dispose runtime` 更适合 Pinned Action，因为用户会把 pinned action 当成常驻工具。如果切走一段时间再回来，应该感觉是“刚才那个工具还在”，而不是“重新打开一个空工具”。

需要区分三层：

```text
Pinned Definition:
  用户 pin 了哪个 action，以及它的长期配置。

Pinned Tombstone:
  runtime 被释放后的轻量现场快照。

Pinned Runtime:
  当前真实挂载的 editor、model、panel、运行任务和 Monaco 资源。
```

Tombstone 类型：

```ts
type PinnedTombstone = {
  pinnedId: string
  actionId: string
  inputText: string
  params: Record<string, unknown>
  autoRun: boolean
  debounceMs: number
  controlsOpen: boolean
  controlPanelState?: Record<string, unknown>
  inputViewState?: unknown
  outputViewState?: unknown
  outputSummary?: {
    kind: 'empty' | 'text' | 'error' | 'stale'
    preview?: string
    hash?: string
    generatedAt?: number
  }
  lastRunAt?: number
  lastDurationMs?: number
  lastError?: string
  disposedAt: number
  reason: 'idle-timeout' | 'memory-pressure' | 'manual' | 'navigation'
}
```

Tombstone 保存什么：

```text
inputText:
  必须保存。恢复后用户输入不能丢。

params:
  必须保存。控制面板选择不能丢。

controlsOpen:
  保存。恢复时可以重开 controls panel。

viewState:
  尽量保存 Monaco saveViewState 结果；恢复失败时忽略。

outputSummary:
  保存轻量摘要，不保存大块完整 output。
  用于恢复后先显示 “上次结果摘要 / stale”。

lastError:
  保存最近错误，便于恢复后提示。
```

Tombstone 不保存什么：

```text
完整 outputText 默认不保存。
Monaco editor instance 不保存。
Monaco model 不保存。
decorations/widgets/view zones 不保存。
pending promise 不保存。
panel DOM 状态不保存。
```

Tombstone 恢复流程：

```text
1. 用户点击 pinned action。
2. 如果有 active runtime，直接显示 runtime。
3. 如果没有 runtime，但有 tombstone：
   3.1 创建 input/output Monaco model。
   3.2 恢复 inputText、params、autoRun、debounceMs。
   3.3 尝试 restoreViewState。
   3.4 如果 controlsOpen=true，重建 controls panel，并注入 controlPanelState。
   3.5 output 先显示 tombstone.outputSummary。
   3.6 如果 autoRun=true 且 inputText 非空，后台重新运行。
   3.7 如果 autoRun=false，标记 output stale，等待用户 Run Now。
4. 如果没有 tombstone，按 definition 创建空 runtime。
```

Tombstone 生命周期：

```text
active runtime -> idle runtime:
  不创建 tombstone，只记录 lastInteractedAt。

idle runtime -> disposed:
  创建或更新 tombstone，然后释放 runtime。

disposed -> active runtime:
  从 tombstone 恢复 runtime。

unpin:
  删除 definition、runtime、tombstone。
```

内存压力处理：

```text
如果未来支持 memory pressure 信号或手动释放：
  先 tombstone 当前非 active runtime。
  再按 lastInteractedAt 释放最久未使用 runtime。
  active runtime 默认不释放；除非用户显式关闭或系统进入极端降级模式。
```

用户可见状态：

```text
Sidebar pinned item 可以显示轻量状态：
  cold      只有 definition，从未打开。
  warm      runtime 仍在内存中。
  tombstoned runtime 已释放，可恢复。
  running   有 active run。
  error     tombstone 或 runtime 记录了错误。
```

UI 不需要把 “tombstoned” 作为吓人的文字展示给用户，可以显示为：

```text
Ready
Sleeping
Running
Error
```

但内部状态必须明确区分。

### Tombstone 持久化策略

Tombstone 不应只存在内存中。否则应用重启后，Pinned Action 虽然还在 sidebar，但用户刚才的输入、参数、控制面板状态都会丢失。

建议持久化：

```text
Pinned Definition:
  必须持久化。

Pinned Tombstone:
  默认持久化。

Pinned Runtime:
  绝不持久化。
```

启动时加载规则：

```text
1. 启动时读取所有 Pinned Definition。
2. 启动时读取对应 Tombstone。
3. 不创建任何 Runtime。
4. Sidebar 展示 pinned action 列表，并根据 tombstone 显示 Sleeping/Error 等轻量状态。
5. 用户第一次打开 pinned action 时，才从 tombstone 恢复 runtime。
```

持久化内容限制：

```text
inputText:
  默认持久化，但需要给用户一个全局设置关闭。
  原因是输入可能包含敏感文本。

params:
  默认持久化。

controlPanelState:
  默认持久化，但不得包含 DOM、函数、Monaco 对象。

outputSummary:
  默认持久化轻量摘要。
  preview 必须截断，例如最多 2KB。

outputText:
  默认不持久化。
```

建议增加设置：

```ts
type PinnedPersistenceSettings = {
  persistPinnedInput: boolean
  persistPinnedTombstone: boolean
  outputPreviewLimit: number
  tombstoneTtlDays: number
}
```

默认值：

```text
persistPinnedInput = true
persistPinnedTombstone = true
outputPreviewLimit = 2048
tombstoneTtlDays = 30
```

清理规则：

```text
Unpin:
  删除 definition、runtime、tombstone。

Clear Input:
  清空 runtime inputText，同时更新 tombstone inputText。

Reset Pinned Action:
  保留 definition，清空 tombstone 和 runtime。

超过 tombstoneTtlDays:
  可以清理 tombstone，但保留 definition。

关闭 persistPinnedInput:
  后续 tombstone 不再写入 inputText。
  已存在 inputText 应在设置切换时询问是否清除。
```

隐私提示：

```text
因为 Pinned Action 的 inputText 可能被持久化，设置页需要明确说明：
Pinned tools can remember input text to restore sleeping tools.
```

### Live Action Capability

Action 可以声明是否适合 pin/live：

```ts
type LiveActionCapability = {
  pinnable?: boolean
  live?: {
    enabled: boolean
    debounceMs?: number
    trigger?: 'on-input' | 'manual' | 'on-blur'
    sideEffects: 'none' | 'read-only' | 'writes'
  }
  controls?: {
    panelId: string
    placement: PanelPlacement
    defaultOpen?: boolean
  }
}
```

默认策略：

```text
sideEffects = none:
  可 auto run。

sideEffects = read-only:
  可 auto run，但必须 debounce，且显示 running 状态。

sideEffects = writes:
  不允许 auto run，只能 manual。

未声明 live:
  可以 pin，但默认 manual run。
```

### 控制面板

Pinned Action 的参数使用 Panel 能力，而不是固定表单。

```text
简单参数：
  可以由 Host 自动生成 controls panel。

复杂参数：
  Action 或插件提供自定义 panelId。
```

控制面板作用域：

```text
scope = pinned-action
placement = right / bottom / popover
```

为此需要补一个新的 PanelScope：

```ts
type PanelScope =
  | { type: 'pane'; paneId: PaneId }
  | { type: 'workspace' }
  | { type: 'presentation'; sessionId: string }
  | { type: 'pinned-action'; pinnedId: string }
```

控制面板修改 params 后：

```text
1. 更新 PinnedAction.params。
2. 如果 autoRun = true，触发 debounce run。
3. 如果 autoRun = false，标记 output stale。
```

### 运行模型

Live Runner 不直接复用主 Editor 的 active pane 输入。它使用自己的 input buffer：

```ts
type LiveRunContext = {
  input: {
    text: string
    mode: 'pinned-input'
  }
  params: Record<string, unknown>
  pinned: {
    id: string
    actionId: string
  }
}
```

运行顺序：

```text
1. inputText 改变。
2. 如果 autoRun=false，只标记 output stale。
3. 如果 autoRun=true，debounce。
4. debounce 到期后创建 runId。
5. 执行 action。
6. 如果返回时 runId 不是最新，丢弃旧结果。
7. 把结果渲染到 output surface。
8. 更新 lastRunAt / duration / error。
```

错误处理：

```text
Action 抛错：
  outputKind = error
  outputText = Error message

Action 返回 Error: 前缀：
  先保持兼容，作为 error 样式展示。

异步 action 超时：
  标记 timeout，可手动 retry。
```

动态释放与运行并发规则：

```text
如果 runtime 正在 active run，不进入 disposing。
如果用户离开 runner，pending run 可继续完成，但完成后只更新 PinnedAction 的轻量状态，不强制 remount UI。
如果 runtime 已 disposed 后旧 run 返回，必须根据 runId 丢弃结果。
如果用户重新打开 action，新 runtime 使用新的 runId 序列。
```

### 输出渲染

Live Runner 输出不只支持纯文本：

```ts
type PinnedOutput =
  | { type: 'text'; text: string }
  | { type: 'error'; message: string }
  | { type: 'presentation'; renderer: string; props: Record<string, unknown> }
```

初期内置：

```text
text output
error output
readonly Monaco output editor
```

后续可接：

```text
JSON tree
Markdown preview
Diff output
Table preview
```

## 与 Workspace Extension 架构的关系

Pinned Action 应建立在之前的 Command/Effect/Panel 架构上：

```text
Pinned Runner 是一种 Workspace Presentation / View Surface。
Controls 是 Panel。
Action 执行结果通过 Effect Runner 应用到 runner output。
Apply Output to Active Pane 通过 text.replace effect 显式写回主工作区。
```

它不应该绕过已有机制：

```text
不直接操作主 Editor 文本。
不绕过 Surface Coordination。
不绕过 Panel lifecycle。
不绕过 owner/disposable 清理。
```

## Milestone 拆解

### Milestone A：脚本自适应增强

目标：

```text
先提升现有脚本的智能判断能力，不引入 Pinned Action UI。
```

范围：

```text
timestamp.ts auto mode
base64.ts auto mode
url.ts auto mode
querystring.ts auto mode
hex.ts auto mode
保留原显式参数模式
```

验收：

```text
明显输入可以自动转换。
无法判断时给出明确错误。
老参数模式仍可用。
现有 Action 运行流程不变。
```

测试：

```text
npm run build
每个脚本增加 auto mode 测试用例
浏览器手动验证 timestamp/base64/url/querystring/hex
```

### Milestone B：Pinned Action 数据模型与 Sidebar

目标：

```text
支持 pin/unpin/reorder，并在 sidebar 显示 pinned actions。
```

范围：

```text
新增 pinned action store slice
Command Palette action item 增加 pin 操作
Sidebar 增加 Pinned 区域
同 action 只 pin 一次
```

验收：

```text
可以 pin action。
重复 pin 会聚焦已有 pinned action。
可以 unpin。
刷新后 pinned 列表保留。
启动时不会创建 pinned runner editor 或 panel。
```

### Milestone C：Live Runner 基础形态

目标：

```text
点击 pinned action 后进入左右两栏 Live Runner。
```

范围：

```text
PinnedRunnerView
input editor
readonly output editor
manual run
copy output
clear input/output
```

验收：

```text
Timestamp pinned 后可手动运行。
输入区和主 Editor 独立。
输出区不自动写回主 Editor。
Copy Output 可用。
只有打开该 pinned action 时才创建 runner runtime。
```

### Milestone D：动态加载与超时释放

目标：

```text
Pinned Definition 常驻，Pinned Runtime 懒加载，并支持 idle timeout + Tombstone 释放。
```

范围：

```text
PinnedRuntime registry
PinnedTombstone state
activate/deactivate/dispose lifecycle
idleTimeoutMs
maxWarmRuntimes
runtime disposable cleanup
```

验收：

```text
应用启动时不会 mount pinned runner editors。
打开 pinned action 才创建 input/output editor。
切走后 runtime 进入 idle。
超过 idleTimeout 后 runtime 被释放。
释放前生成 tombstone。
重新打开已释放 action，会按 definition 重新创建 runtime。
inputText、params、controlsOpen 和 viewState 从 tombstone 恢复。
outputText 默认不保存，只显示 outputSummary 并重新计算或标记 stale。
pending run 返回后不会污染新 runtime。
```

测试：

```text
npm run build
单测：runtime 状态机、idle timeout、maxWarmRuntimes、tombstone restore、dispose cleanup
浏览器验证：pin 多个 action，观察只 mount 当前/少量 warm runtimes
```

### Milestone E：Auto Run 与并发控制

目标：

```text
支持输入变化后 debounce 自动运行。
```

范围：

```text
LiveActionCapability
autoRun toggle
debounce
runId 丢弃旧结果
running/error/stale 状态
```

验收：

```text
输入变化后自动更新输出。
快速输入不会展示旧结果覆盖新结果。
异步 action 有 running 状态。
错误结果可见且不崩溃。
```

### Milestone F：Controls Panel

目标：

```text
Pinned Action 参数通过动态 Panel 控制。
```

范围：

```text
pinned-action PanelScope
自动参数 panel
自定义 controls panel 接口
params 改变触发 rerun 或 stale
```

验收：

```text
Hash pinned 后可通过 controls panel 选择算法。
Sort pinned 后可选择方向和 ignoreCase。
Timestamp 默认不要求用户选择秒/毫秒。
关闭 controls 不影响 runner。
```

### Milestone G：全局 Launcher

目标：

```text
支持在任何位置快速切换到 pinned action。
```

范围：

```text
Cmd+Shift+K 全局 launcher
展示 pinned actions、recent commands、views
选择 pinned action 后切换到 runner
```

验收：

```text
在 Editor、Diff、Panel 中都能打开全局 launcher。
可以搜索并跳转到 pinned action。
不会影响当前 active pane 文本。
```

### Milestone H：Apply / Send Output

目标：

```text
把 Live Runner 输出显式送回工作区。
```

范围：

```text
Apply Output to Active Pane
Send Output to New Pane
冲突确认
undo step
```

验收：

```text
Apply 必须用户显式点击。
Apply 使用 active pane 当前选区/全文规则。
Send New Pane 创建新 pane。
输出为空或 error 时禁用 apply。
```

## 执行注意事项

```text
不要把 Pinned Action 做成只保存 actionId 的收藏夹。
不要默认让所有 Action auto run。
不要把可推断参数继续强迫用户选择。
不要让 Live Runner 自动改主 Editor。
不要让 controls panel 绕过 Panel lifecycle。
不要把 outputText 作为必须持久化内容。
```

每个阶段完成后，交付说明必须包含：

```text
改了哪些脚本或能力
哪些输入可以自动判断
哪些场景仍需要参数面板
验证用例
已知误判风险
```
