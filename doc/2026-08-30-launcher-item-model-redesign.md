# Hiven Global Launcher 通用 LauncherItem 模型重设计

日期：2026-08-30  
状态：设计与交互原型，未修改正式代码  
配套 Demo：`doc/launcher-item-model-redesign-prototype.html?variant=A|B|C`

## 1. 结论先行

`LauncherItem` 不应继续等同于“一行可执行结果”，也不应膨胀成可嵌任意 UI 的小应用。

建议把 Launcher 的通用交互模型拆成四个有明确所有权的概念：

```text
LauncherEntry       可搜索、可排序、占快捷序号的入口
LauncherAction      归属于 Entry/Group 的主动作、附属动作、反馈、恢复或撤销
LauncherDetail      Entry 唯一一层、由 Host 渲染的渐进详情
LauncherGroup       表达同一提供方内的成员关系、选择约束、冲突与合并
```

只有 `LauncherEntry` 进入正常搜索结果、ranking、favorite、usage 和 `⌘/Ctrl+1…8`。接受、拒绝、撤销、关闭、复制、恢复等 `LauncherAction` 不再伪装成同级结果。`LauncherDetail` 只承载短预览、状态、少量动作和简单控件；需要文本焦点、显式提交或较多选项时进入现有 Frame；需要任意布局、长内容、独立滚动或多层导航时进入 Plugin Surface。

三种候选方案分别是：

- A：紧凑 Entry + 外部上下文区；根列表永不展开。
- B：Entry + 一层渐进展开 Detail；动作靠近对象原地完成。
- C：Composite Entry / Group；一个搜索单元内部显式包含成员与约束。

推荐不是从三者中机械选一套再加字段，而是采用分层组合：以 A 的紧凑 Entry 作为默认，以 B 的单层 Detail 作为通用渐进交互，以 C 的 Group 作为关系容器；三者共用同一 Action、状态机和 Frame/Surface 出口。Group 只在确有成员关系时出现，不能成为所有 Item 的默认外壳。

## 2. 设计对象、调用方与约束

### 2.1 模型解决什么问题

它需要统一表达：

- 一个结果的默认意图与非默认意图；
- 对象的短预览、持续状态与可恢复的不可用原因；
- 接受、拒绝、撤销等反馈动作对主对象的从属关系；
- 一次原地展开与进入 Params、Collect Input、Result Frame、Surface 的区别；
- 同一提供方给出的分组、候选变体、互斥、冲突、合并和批量选择；
- 动态结果刷新后如何保持 query、选择、展开和操作反馈。

### 2.2 谁会使用

- 插件作者：声明产品内容、产品语义、动作实现、状态事实和 Group 关系。
- Host provider：应用、窗口、浏览器标签、工作对象、保存动作等系统来源。
- Launcher controller：统一状态转换、权限、执行、刷新、回退和错误。
- Launcher UI：只渲染 Host 允许的原语，不解释插件业务类型。
- 测试：验证 normalizer、状态机、选择约束和 stale/refresh，不测试具体 UI 像素。

### 2.3 不可破坏的约束

- Global Launcher 始终搜索与输入优先。
- 搜索 `<input>` 保持唯一真实 DOM 焦点；列表、详情和动作使用虚拟焦点。
- 不新增依赖。
- 插件产品语义留在插件侧；Host 只理解通用角色、状态和副作用策略。
- 不开放任意 JSX、CSS、renderer、快捷键或无限动作树。
- 所有文案必须有 i18n 形式；Host 文案走 palette locale，插件文案走插件 locale。
- 现有 Params、Collect Input、Result Frame、LauncherOutput 和 Plugin Surface 继续承担合适的流程。
- 正常结果和反馈动作必须有不同身份、排序、快捷键与 telemetry 语义。

## 3. 现状审计

### 3.1 当前类型能表达什么

`src/workspace/launcher/types.ts` 当前把以下概念集中在 `LauncherItem`：

- `display`：图标、标题、副标题、aliases、kind label（约 199 行）；
- `behavior`：只有 `perform` 与 `collect-input`（约 267 行）；
- `params/defaultParams/executeWithParams`；
- `execute`；
- 排序、持久化、权限和 usage 元数据；
- 唯一持续状态 `disabledReason`（约 589 行）。

复杂动作只存在于执行后的 `LauncherResultChoice.secondaryActions`；多选只存在于 `LauncherOutput.selection`。因此 Item 被执行前没有通用附属动作、预览、控件、完成态、撤销态或关系容器。

### 3.2 当前控制器实际是 Frame 状态机

`src/workspace/launcher/controller.ts` 只有四类 Frame：

```text
list → param-input / collect-input / result
```

`selectItem()` 对根 Item 只有三种结果：禁止执行、进入 Params/Collect Input、立即执行。`busy` 与 `error` 是整个 controller 的全局字段，不知道是哪一个 Item、哪一个 action 正在执行。`back()` 能弹出 Frame，但根 `ListFrame` 只有 `{ kind: 'list' }`，query、selected key 和未来的 expanded state 都不在 controller snapshot 中。

### 3.3 当前列表是“单按钮行”

`src/components/launcher/LauncherMixedList.tsx` 把每个结果渲染成：

- `button`；
- `tabIndex={-1}`；
- `mousedown.preventDefault()`，以保持搜索 caret；
- native `disabled`。

这个策略正确保住了输入焦点，但 native `disabled` 让“禁用但可解释”成为矛盾：controller 能返回禁用原因，用户却不能通过鼠标或虚拟选择进入恢复动作。

### 3.4 当前键盘语义不统一

`src/components/launcher/GlobalLauncherKeyboard.ts` 当前语义是：

- 根列表：`↑/↓` 选择，`Enter` 执行，`⌘/Ctrl+Enter` 定制参数，`⌘/Ctrl+1…8` 快速执行，`⌘/Ctrl+P` 固定；
- `Tab` 只对 workflow object 有特殊展开行为，普通 Item 不拦截；
- Collect Input：`↑/↓` 选 suggestion，`Enter` 提交；
- Result：`↑/↓` 选择，`Space/Enter` 都可能触发当前 choice；
- `Esc` 由 capture-phase Host 统一弹层或关闭；
- IME 通过 composition ref、229 与 compositionend 后保护窗口阻止误执行。

这说明 Host 已经拥有虚拟焦点基础，但缺少统一的“当前交互区”概念，导致 Tab、Space 和左右键只能按产品特例分支。

### 3.5 当前返回只恢复了一部分上下文

`src/workspace/launcher/useLauncherSession.ts` 把 query、selected index 与 controller Frame 分开保存。动态 provider 更新时，`resolvePreservedSelection()` 会按稳定 `systemKey` 保住用户主动选择，这是可复用的正确能力。Frame 返回时 query 和根选择通常仍在，但 expanded/action zone 不存在；Launcher 关闭后只可能通过 sticky query 恢复文本，选择会回到 0。

### 3.6 六个真实案例暴露了同一缺口

| 场景 | 当前表达 | 缺口 |
|---|---|---|
| URL 新学习结果 | learned result 与 `buildUndoItem()` 都是 dynamic direct answer | “不是这条”占结果和快捷序号，没有 owner 关系 |
| 浏览器标签/历史 | 每个 target 被压成可执行 Item；provider 自行去重 | close/copy/pin 等附属能力无法保留在通用 Item 模型；`DesktopTarget.secondaryActions` 未映射到 LauncherItem |
| 即时结果 | directAnswer Item 执行后再生成单 choice，单 choice 又被自动执行 | 预览与输出去向在“Item 前”和“Result 后”之间重复绕行 |
| 参数命令 | Item 通过快捷键或 policy 进入 Param Frame | 合理，应保留为 Frame，而不是把文本/复杂选项塞进 Item |
| Diff 多选 | execute 后返回 `LauncherOutput.selection` | 合理，但目前到达 max 即自动提交，缺少显式提交策略 |
| Disabled Saved Action | Item 有 `disabledReason`，DOM 直接 disabled | 看得到但不能理解、修复或恢复 |

另一个值得保留的现有模式是 workflow object：对象本身是根 Item，Tab/执行后产生其 actions 的 Result choices。它已经证明“对象”和“对象动作”不该是同级结果，只是当前实现仍依赖 metadata 特例。

## 4. 共同词汇与状态原则

### 4.1 Entry 不是 View，也不是 Action

`LauncherEntry` 是搜索和排序身份。它回答“用户在找什么对象或意图”。

`LauncherAction` 回答“对当前 Entry/Group 做什么”。主动作也显式建模为 Action，但只有主动作参与 Enter 和数字快捷执行。

`LauncherDetail` 回答“在不离开搜索上下文的前提下，还需要看什么或做什么”。

`LauncherGroup` 回答“这些 Entry 为什么必须被一起理解或选择”。

### 4.2 声明状态与运行状态分离

插件可以声明事实：

- 当前是否可用；
- 当前 toggle/radio 值；
- 是否已完成、可撤销或已失效；
- 预览和动作是什么；
- 成员关系与约束是什么。

插件不能声明：

- hover、selected、expanded；
- spinner 的样式、成功颜色或错误位置；
- 哪个元素获取真实焦点；
- 任意动画、快捷键或 CSS；
- 绕过权限、确认和生命周期的执行路径。

### 4.3 完整状态不是一个巨型 enum

把所有状态塞进一个枚举会产生大量无意义组合，例如“hover + disabled + running + stale”。Host 应使用四个正交轴：

```ts
type LauncherRuntimeState = {
  focus: 'default' | 'hovered' | 'selected'
  disclosure: 'collapsed' | 'loading' | 'expanded'
  operation:
    | { kind: 'idle' }
    | { kind: 'confirming'; actionId: string }
    | { kind: 'running'; actionId: string }
    | { kind: 'success'; actionId: string }
    | { kind: 'failure'; actionId: string; message: string }
  lifecycle:
    | { kind: 'available' }
    | { kind: 'disabled'; reason: LocalizedText; recoveryActionId?: string }
    | { kind: 'completed'; undoActionId?: string }
    | { kind: 'undoable'; undoActionId: string }
    | { kind: 'stale'; refreshActionId?: string }
}
```

Host 校验组合：disabled/stale 可以 selected 和 expanded，但不能执行主动作；running 时禁止同一 action 重入；success 是短时 UI 状态，completed/undoable 是 provider 事实。

## 5. 方案 A：紧凑 Item + 外部上下文区

### 5.1 产品心智模型

Launcher 仍是紧凑搜索结果列表。选中结果后，按 Tab 或点击统一的详情按钮，在列表外部打开一个 Host 控制的 Context Rail。Rail 展示当前结果的预览、状态、控件和附属动作；根行高度永远不变。

它不是“更多菜单”：Rail 是常驻的当前上下文区域，可显示只读内容、持续状态、可解释禁用与控件；菜单只是一列动作。

### 5.2 能力矩阵

| 能力 | 根行 | 外部 Context Rail | Frame / Surface |
|---|---:|---:|---:|
| 直接执行 | 是 | 可重复主动作 | - |
| 展开/收起 | 否 | 打开/关闭 Rail | - |
| 只读预览 | 摘要 | 是，短文本/属性 | 长内容进 Surface |
| 参数编辑 | 只显示摘要 | 入口 | Params Frame |
| 单选 | 否 | 最多 5 项 | 更多进 Params/Result |
| Toggle | 否 | 是，一个或少量互不依赖控件 | 复杂设置进 Surface |
| 多选/批量 | 否 | 只显示已选摘要 | Result/Group Frame |
| 接受/拒绝/撤销 | 状态标记 | 是，feedback/undo action | 复杂治理进 Surface |
| 主/附属动作 | 主动作 | 附属、反馈、恢复 | 可继续进入 Frame/Surface |
| 原地刷新 | 行摘要更新 | Rail 保持并刷新 | - |

### 5.3 完整状态机

```text
LIST_DEFAULT
  pointer move / ↑↓ → LIST_SELECTED

LIST_SELECTED
  Enter              → RUNNING(primary)
  Tab / detail click → CONTEXT_LOADING
  result refresh     → LIST_SELECTED(new snapshot)
  item disappears    → LIST_SELECTED(nearest item) + stale notice

CONTEXT_LOADING
  resolve            → CONTEXT_READY
  fail               → CONTEXT_ERROR(retry available)
  Esc / Shift+Tab    → LIST_SELECTED
  query changes      → abort resolve → LIST_SELECTED

CONTEXT_READY
  ↑↓ / Tab           → ACTION_SELECTED
  Space              → toggle/radio only
  Enter              → RUNNING(selected action)
  Esc / Left         → LIST_SELECTED
  invalidate         → CONTEXT_LOADING(stable shell)

RUNNING(action)
  needs confirmation → CONFIRMING(Result Frame)
  success close       → CLOSED
  success stay        → SUCCESS → refresh → CONTEXT_READY
  completed           → COMPLETED/UNDOABLE → CONTEXT_READY
  failure             → CONTEXT_ERROR(action scoped)
  source invalidated  → STALE(disable commit, offer refresh)

FRAME / SURFACE
  back                → restore query + selected Entry + Rail action
```

hover 只是 focus 轴投影；disabled/completed/stale 是 lifecycle 轴，不另开搜索结果。

### 5.4 键盘与鼠标

- Search zone：`↑/↓` 选 Entry；`Enter` 主动作；`Tab` 进入 Rail；`Space` 和裸数字继续输入；左右键移动搜索 caret。
- Rail zone：`↑/↓` 选 action/control；`Tab/Shift+Tab` 遍历 Host 固定槽位；`Enter` 执行动作；`Space` 只切换 toggle、radio 或 checkbox；`Left/Esc` 返回 Search；`Right` 进入当前 control 的选项，不创建下一层 Rail。
- `⌘/Ctrl+1…8` 只执行可见根 Entry 主动作；不编号 Rail action。
- 鼠标单击行主体执行主动作；单击 detail affordance 打开 Rail；hover 只选中，不加载 Rail。
- 搜索 input 始终保持 DOM focus；Rail 使用 `aria-activedescendant` 与可见虚拟 focus ring。
- composition 期间 Enter、Space、数字快捷执行全部忽略；Esc 仍能返回。

### 5.5 Item 间关系模型

- 普通分组：列表 section，成员仍是独立 Entry。
- 父子/附属：Action 和 feedback 直接归属 Entry，不建子 Item。
- 互斥、冲突、合并、批量：Rail 只显示关系摘要和入口；真正选择进入 Group/Result Frame。
- 同一 provider 的重复变体可先 coalesce 为一个 Entry，Rail 展示变体；跨 provider 合并只能由 Host policy 决定。

这套方案故意弱化根列表中的可见关系，以换取稳定密度。

### 5.6 Frame/Output/Surface 边界

- Rail：短预览、一个简单 control、最多 4 个 action，无新文本焦点、无独立滚动。
- Frame：参数、确认、单/多选、批量提交、输出去向、需要暂时替代搜索上下文的步骤。
- Surface：编辑、长列表、富内容、复杂设置、多层导航、持久工作区。

### 5.7 插件声明接口示例

```ts
type CompactEntryContribution = {
  id: string
  display: LauncherItemDisplay
  primary: LauncherActionContribution
  context?: (ctx: LauncherInteractionContext) => MaybePromise<{
    version: string
    preview?: LauncherTextPreview
    lifecycle?: LauncherLifecycleSnapshot
    controls?: LauncherControl[]
    actions?: LauncherActionContribution[]
  }>
}

const browserTab: CompactEntryContribution = {
  id: 'tab:42',
  display: tabDisplay,
  primary: focusTabAction,
  context: async ({ t }) => ({
    version: tab.updatedAt,
    preview: { kind: 'text', text: tab.url },
    controls: [{ kind: 'toggle', id: 'pinned', label: t('pin'), value: tab.pinned }],
    actions: [copyUrlAction, closeTabAction],
  }),
}
```

### 5.8 Host 隐藏的复杂性

Host 负责 Rail layout、action ordering、虚拟焦点、abort/stale、权限与确认、per-action busy/error、刷新与 selection preservation。插件只给快照与动作实现。

### 5.9 易误用点和限制

- Rail 容易被误当设置面板；硬限制 controls/actions 数量和无滚动。
- 宽度不足时 Rail 只能改为底部区，信息层级可能跳动。
- 关系只能摘要，复杂 group 仍要跳 Frame。
- 不允许插件控制 Rail 位置、列数或动画。

### 5.10 真实使用示例

| 场景 | 表达 |
|---|---|
| URL 学习建议 | suggestion Entry 不默认聚焦；Rail 内显示证据、作用域、接受/试用/拒绝，拒绝不占结果 |
| 浏览器标签 | Enter 聚焦；Rail 复制 URL、pin toggle、关闭 |
| 即时结果 | Enter 默认复制；Rail 显示完整预览与输出去向 |
| 参数命令 | Enter 按 policy 执行；Rail 的“定制参数”进入 Params Frame |
| 多选操作 | Rail 的“选择来源”进入现有 Result Frame |
| 禁用恢复 | Entry 可选但 `aria-disabled`；Rail 展示原因和恢复/配置 action |

核心优点是密度稳定、最接近当前 Launcher；核心缺点是对象与动作空间分离，建议和反馈的从属关系要靠 Rail 标题维持。

## 6. 方案 B：渐进展开 Item

### 6.1 产品心智模型

每个 Entry 是可折叠的 interaction unit。默认只显示紧凑行；用户明确展开后，行下出现唯一一层 Host-rendered Detail。Detail 与 Entry 共享边框和 selected state，因此“这是对谁的反馈或动作”最直观。

### 6.2 能力矩阵

| 能力 | 紧凑态 | 展开 Detail | Frame / Surface |
|---|---:|---:|---:|
| 直接执行 | 是 | 主动作仍可见 | - |
| 展开/收起 | 是 | 一层 | 禁止再嵌套 |
| 只读预览 | 摘要 | 是 | 长内容进 Surface |
| 参数编辑 | 摘要 | 只放入口或 ≤5 项单选 | Params Frame |
| 单选 | 否 | 是，≤5 | 更多进 Frame |
| Toggle | 状态 accessory 可见 | 是 | 复杂设置进 Surface |
| 多选 | 否 | 小型同组成员可选 | 常规批量进 Group/Result Frame |
| 接受/拒绝/撤销 | 状态 badge | 是，紧邻主对象 | 管理进 Surface |
| 主/附属动作 | 主动作 | 附属/反馈/恢复 | 可继续进入 Frame/Surface |
| 原地刷新 | 摘要更新 | 保持高度骨架后替换快照 | - |

### 6.3 完整状态机

```text
COLLAPSED_DEFAULT
  hover / ↑↓          → COLLAPSED_SELECTED

COLLAPSED_SELECTED
  Enter               → RUNNING(primary)
  Tab / disclosure    → EXPANDING
  selection moves     → selected changes; previous detail collapses

EXPANDING
  resolve             → EXPANDED_SELECTED(detail zone inactive)
  failure             → EXPANDED_ERROR(retry)
  Esc / Left          → COLLAPSED_SELECTED
  query changes       → abort + collapse

EXPANDED_SELECTED
  Tab / Right         → DETAIL_ACTIVE(first interactive primitive)
  Enter               → RUNNING(primary)
  Esc / Left          → COLLAPSED_SELECTED
  invalidate          → EXPANDED_LOADING(stable skeleton)

DETAIL_ACTIVE
  ↑↓ / Tab            → move within actions/controls
  Enter               → RUNNING(action)
  Space               → select/toggle only
  Shift+Tab / Left    → EXPANDED_SELECTED
  Esc                 → COLLAPSED_SELECTED

RUNNING(action)
  confirm             → CONFIRMING(Result Frame)
  success stay        → SUCCESS → refresh → EXPANDED_SELECTED
  completed + undo    → UNDOABLE(detail remains)
  failure             → EXPANDED_ERROR(action scoped)
  stale               → STALE(detail disables commit)

FRAME / SURFACE
  back                → restore query + Entry + expanded/detail action state
```

### 6.4 键盘与鼠标

- Search zone：`↑/↓` 选 Entry；`Enter` 只做主动作；`Tab` 展开并进入 Detail；左右键仍移动输入 caret。
- Detail 已打开但 zone 未激活时：`Right/Tab` 进入第一个 control，`Left/Esc` 收起。
- Detail zone：`↑/↓` 在 primitives 中移动；`Enter` 执行动作；`Space` 仅用于 control/selection；`Left/Shift+Tab` 回到 Entry；`Esc` 直接收起。
- 改变 query 会收起当前 Detail；仅 provider partial refresh 不收起，只按 stable key 更新。
- 鼠标行主体执行主动作，chevron/detail button 展开；点击 detail action 不触发行主体。
- `⌘/Ctrl+1…8` 只执行根 Entry 主动作；附件动作无数字快捷键。
- IME 规则与方案 A 相同。

### 6.5 Item 间关系模型

- section 负责普通分组。
- Detail 内的 actions、feedback、recovery、undo 表达附属关系。
- 一个 Detail 可显示同一 Entry 的少量 alternatives；mutual exclusion 用 radio control。
- 冲突显示为 Host warning block，执行前进入 confirm/result Frame。
- merge 后只保留一个 ranked Entry，Detail 列出 variants。
- batch selection 只允许同一 Group 的少量成员；跨插件或大量成员进入 Frame。

### 6.6 Frame/Output/Surface 边界

- Detail：只读 preview、状态、最多 4 actions、最多一个 control group、最多 6 个可见成员；无文本框、无独立滚动、无第二层 detail。
- Params/Collect Input：任何需要新文本焦点或连续参数步骤。
- Result Frame：确认、输出目的地、显式提交的单/多选。
- Surface：超出一屏或需要产品自定义布局。

### 6.7 插件声明接口示例

```ts
type ProgressiveEntryContribution = {
  id: string
  display: LauncherItemDisplay
  primary: LauncherActionContribution
  detail?: (ctx: LauncherInteractionContext) => MaybePromise<LauncherDetailSnapshot>
}

type LauncherDetailSnapshot = {
  version: string
  preview?: LauncherTextPreview
  status?: LauncherStatus
  lifecycle?: LauncherLifecycleSnapshot
  control?: LauncherControl
  actions?: LauncherActionContribution[]
  alternatives?: LauncherAttachedEntry[]
}

const learnedSuggestion: ProgressiveEntryContribution = {
  id: candidate.id,
  display: suggestionDisplay,
  primary: tryOnceAction,
  detail: ({ t }) => ({
    version: candidate.version,
    preview: { kind: 'properties', rows: evidenceRows(candidate, t) },
    actions: [acceptAndOpenAction, rejectAction, editInSurfaceAction],
  }),
}
```

### 6.8 Host 隐藏的复杂性

Host 负责窗口高度稳定、detail skeleton、唯一展开项、scroll anchor、虚拟 zone、ARIA relationship、partial refresh、Frame snapshot 与 action gate。

### 6.9 易误用点和限制

- 多个展开项会把 Launcher 变成长页面，因此全局只允许一个展开 Detail。
- Detail 容易塞表单；禁止 text input 和任意 controls 组合。
- 行高变化会影响鼠标命中和 native window resize，必须保留 skeleton 高度并以 item key 锚定滚动。
- 不允许 hover 自动展开或加载。

### 6.10 真实使用示例

| 场景 | 表达 |
|---|---|
| URL 学习建议 | 展开后同一视觉单元内解释证据、范围和接受/拒绝/试用；feedback 不进 ranking |
| 浏览器标签 | 展开显示完整 URL、访问状态、复制/pin/关闭 |
| 即时结果 | 行显示短结果，展开显示完整只读 preview 与输出去向 |
| 参数命令 | Detail 只显示默认参数摘要；编辑进入 Params Frame |
| 多选操作 | 小型同组选择可在 Detail；Diff 等显式任务进入 Result Frame |
| 禁用恢复 | disabled Entry 仍可选、展开；只开放 recovery action |

核心优点是从属关系最清楚、渐进披露自然；核心缺点是高度、滚动与键盘 zone 的复杂度最高。

## 7. 方案 C：复合 Item / Item Group

### 7.1 产品心智模型

搜索结果不一定是一条原子 Item，也可以是一个有主对象、成员、约束和 Group action 的复合单元。用户先选择 Group，再进入成员。建议、反馈、候选变体和批量选择都通过结构关系表达，而不是依赖相邻排序。

### 7.2 能力矩阵

| 能力 | Group 摘要 | Group 内部 | Frame / Surface |
|---|---:|---:|---:|
| 直接执行 | Group primary | member primary | - |
| 展开/收起 | 是 | 一层成员列表 | 禁止成员再展开 Group |
| 只读预览 | 摘要 | member/detail preview | 长内容进 Surface |
| 参数编辑 | 入口 | member 参数摘要 | Params Frame |
| 单选 | 状态摘要 | 原生能力 | 大列表进 Frame |
| Toggle | 状态摘要 | member/action control | 复杂设置进 Surface |
| 多选/批量 | 选择计数 | 原生能力，显式提交 | 大列表/跨页进 Frame |
| 接受/拒绝/撤销 | Group 状态 | feedback members/actions | 管理进 Surface |
| 冲突/合并 | 可见摘要 | 显式 variants/constraints | 复杂消歧进 Frame |
| 原地刷新 | Group version | 按 member key 保持选择 | - |

### 7.3 完整状态机

```text
GROUP_COLLAPSED
  ↑↓                  → select Group
  Enter               → RUNNING(group primary)
  Tab / expand        → GROUP_LOADING

GROUP_LOADING
  resolve             → GROUP_ENTERED(member 0)
  failure             → GROUP_ERROR(retry)
  Esc / Left          → GROUP_COLLAPSED

GROUP_ENTERED
  ↑↓                  → MEMBER_SELECTED
  Right / Tab         → MEMBER_ACTION_ZONE
  Enter               → member primary OR submit selection
  Space               → toggle member selection/control
  Left / Shift+Tab    → GROUP_COLLAPSED
  invalidate          → GROUP_REFRESHING(preserve member ids)

MEMBER_ACTION_ZONE
  ↑↓ / Tab            → action selected
  Enter               → RUNNING(member/group action)
  Space               → control only
  Left / Esc          → MEMBER_SELECTED

SELECTION_PENDING
  Space               → add/remove member subject to min/max/mutex
  conflict            → CONFLICT_EXPLAINED(commit disabled)
  Enter               → CONFIRMING or RUNNING(group submit)

RUNNING(action)
  success             → refresh Group / close / push Frame
  partial success     → COMPLETED members + remaining selected
  failure             → action/member scoped ERROR
  item removed        → STALE member removed, nearest member selected

FRAME / SURFACE
  back                → restore query + Group + member + selection + action zone
```

### 7.4 键盘与鼠标

- Search zone：`↑/↓` 选 Group/原子 Entry；`Enter` Group primary；`Tab` 进入 Group；左右键移动 caret。
- Group zone：`↑/↓` 选 member；`Space` 选择；`Enter` 执行 member 或显式提交；`Right/Tab` 进入 member action；`Left/Shift+Tab` 回根列表；`Esc` 收起 Group。
- bare 数字始终输入；`⌘/Ctrl+1…8` 执行根 Group primary，不执行内部 member。
- 鼠标点击 Group header primary，点击展开 affordance 进入成员；成员 checkbox/radio 和 action 各自有独立 hit target。
- composition 期间不运行 Group/member/action。

### 7.5 Item 间关系模型

Group 是唯一允许插件声明关系的边界：

```ts
type LauncherGroupContribution = {
  id: string
  display?: LauncherGroupDisplay
  presentation: 'section' | 'composite'
  members: Array<{
    role: 'primary' | 'alternative' | 'supporting'
    entry: LauncherEntryContribution
  }>
  selection?:
    | { mode: 'single'; submit: LauncherActionContribution }
    | { mode: 'multi'; min: number; max: number; submit: LauncherActionContribution }
  constraints?: Array<
    | { kind: 'mutex'; memberIds: string[] }
    | { kind: 'conflict'; memberIds: string[]; message: LocalizedText }
  >
  coalesce?: { key: string; mode: 'dedupe' | 'variants' }
}
```

- 分组：`section`，成员仍可独立编号。
- 父子/附属：`composite` 的 primary/supporting；反馈更优先使用 owned action。
- 互斥：single selection 或 mutex constraint。
- 冲突：结构化 conflict，Host 阻止提交并解释。
- 合并：provider-scoped coalesce；跨 provider 只有 Host 能做。
- 批量：multi selection + group submit，必须显式提交。

### 7.6 Frame/Output/Surface 边界

- Group 内最多 6 个可见 member、一个 selection model、一层 member action。
- 更多成员、搜索成员、跨页选择、需要输入或复杂确认时进入 Result/Collect/Params Frame。
- Group 不允许包含 Surface renderer；只允许 action 打开 Surface。

### 7.7 插件声明接口示例

```ts
const browserMatches: LauncherGroupContribution = {
  id: `browser:${normalizedUrl}`,
  presentation: 'composite',
  display: { title: pageTitle, titleI18n: pageTitleI18n },
  members: [
    { role: 'primary', entry: openTabEntry },
    { role: 'alternative', entry: historyEntry },
  ],
  selection: { mode: 'single', submit: openSelectedAction },
  coalesce: { key: normalizedUrl, mode: 'variants' },
}
```

### 7.8 Host 隐藏的复杂性

Host 负责 scoped identity、Group ranking、成员 quick-number policy、selection validation、mutex/conflict、coalesce、partial refresh、per-member state、ARIA tree/group semantics和 Frame snapshot。

### 7.9 易误用点和限制

- 最容易被滥用成卡片、小表格和嵌套应用，必须限制深度 1、member ≤6、actions ≤4。
- provider 不能引用另一个插件的 item id；跨插件关系由 Host composition policy 产生。
- section 与 composite 的 ranking/usage 语义不同，normalizer 必须拒绝模糊声明。
- Group primary 不明确时禁止数字快捷执行。

### 7.10 真实使用示例

| 场景 | 表达 |
|---|---|
| URL 学习建议 | 一个 composite proposal，解释为 supporting member，接受/拒绝为 owned feedback actions |
| 浏览器标签 | 同 URL 的 open tab/history 合并为 variants；primary 是聚焦已开标签 |
| 即时结果 | 原子 Entry 即可，不强制 Group；输出去向是 actions |
| 参数命令 | 原子 Entry，Params Frame；Group 不介入 |
| 多选操作 | 同一任务来源构成 multi Group，Space 选择、Enter 显式提交 |
| 禁用恢复 | Group/member 都可声明 lifecycle，recovery action 归属具体 member |

核心优点是关系、冲突和批量语义最强；核心缺点是接口与 Host 实现最重，也最容易突破 Launcher 边界。

## 8. 三种方案比较

方案 A 的接口最小，Entry 仍是深模块：插件只声明当前上下文，Host 隐藏焦点、Rail、刷新和权限。它最适合浏览器标签、即时结果和 disabled recovery，也最容易增量迁移；但建议、反馈和 Group 关系需要把视线从列表移到外部区域，批量与冲突仍要离开列表。

方案 B 的正确使用最自然。对象、状态和反馈在同一视觉单元内，URL 建议为何出现、接受与拒绝属于谁都无需额外解释；它也能把 disabled reason、undo 和 stale 放在最靠近来源的位置。代价是 Host 要解决窗口高度、scroll anchor、唯一展开项、虚拟 zone 和 partial refresh，错误实现会直接损伤输入流畅度。

方案 C 的一般性最高，但接口深度最差：插件能表达很多关系，Host 也必须验证很多组合。它非常适合真正的 variants、互斥和 batch，不适合把普通命令全部包装成 Group。若让 Group 成为默认，Launcher 会很快变成卡片式小应用平台。

因此不推荐纯 A：它仍可能把所有复杂性挤成动作区；不推荐纯 B：它难以严谨表达 member selection 与 merge；不推荐纯 C：它过度扩大每个插件的表达面。

## 9. 推荐：Entry + Detail + Group 的分层模型

### 9.1 推荐结构

```text
SearchFrame
├── Section（可选，仅视觉分组）
│   ├── LauncherEntry
│   │   ├── primaryAction
│   │   └── LauncherDetail?（唯一一层）
│   │       ├── preview/status
│   │       ├── control?（最多一组）
│   │       └── actions[0..4]
│   └── LauncherGroup?（只在有真实关系时）
│       ├── members[1..6]
│       ├── selection?/constraints?/coalesce?
│       └── group actions
└── Frame stack / Plugin Surface
```

默认路径是紧凑 Entry。Tab 打开当前 Entry 的 inline Detail；Host 可在窄窗口把同一 Detail 呈现为外部底部区，但插件看不到布局差异。Group 是另一种 search unit，不是 Detail 的子层。

### 9.2 推荐公共接口草图

这不是待直接复制的实现，而是用于确认协议边界的最小形状。

```ts
type LocalizedText = {
  text: string
  i18n?: Partial<Record<Locale, string>>
}

type LauncherActionRole =
  | 'primary'
  | 'secondary'
  | 'feedback'
  | 'recovery'
  | 'undo'

type LauncherActionContribution<TSettings = unknown> = {
  id: string
  role: LauncherActionRole
  label: LocalizedText
  description?: LocalizedText
  icon?: IconRef
  tone?: 'default' | 'danger'
  policy?: ToolActionPolicy
  requiredCapabilities?: LauncherHostCapability[]
  behavior?: LauncherBehavior
  params?: LauncherParamSpec[]
  control?:
    | { kind: 'toggle'; value: boolean }
    | { kind: 'single'; value: string; options: LauncherParamOption[] }
  execute: LauncherExecuteHandler<TSettings>
  executeWithParams?: LauncherExecuteWithParamsHandler<TSettings>
}

type LauncherInteractionSnapshot = {
  version: string
  preview?:
    | { kind: 'text'; text: string }
    | { kind: 'properties'; rows: Array<{ label: LocalizedText; value: string }> }
  status?: {
    tone: 'neutral' | 'success' | 'warning' | 'error'
    label: LocalizedText
  }
  lifecycle?:
    | { kind: 'available' }
    | { kind: 'disabled'; reason: LocalizedText; recoveryActionId?: string }
    | { kind: 'completed'; undoActionId?: string }
    | { kind: 'stale'; reason?: LocalizedText; refreshActionId?: string }
  control?: LauncherActionContribution['control']
  actions?: LauncherActionContribution[]
}

type LauncherEntryContribution<TSettings = unknown> = {
  id: string
  display: LauncherItemDisplay
  primary: LauncherActionContribution<TSettings> & { role: 'primary' }
  detail?: (
    ctx: LauncherInteractionContext<TSettings> & { signal: AbortSignal },
  ) => MaybePromise<LauncherInteractionSnapshot | null>
  group?: LauncherGroupMembership
}
```

`primary` 吸收当前 `behavior + execute + params`，让所有动作都走同一 permission/effect/telemetry gate。旧 contribution 由 compatibility adapter 归一化，不反向限制新模型。

Action 执行结果优先复用 `LauncherExecuteResult`。只需要补一项通用 invalidation 语义，而不是让插件直接 patch Host state：

```ts
type LauncherActionOutcome =
  | (Extract<LauncherExecuteResult, { ok: true }> & {
      invalidate?: 'item' | 'group' | 'list'
    })
  | Extract<LauncherExecuteResult, { ok: false }>
```

持续状态通过 provider/bridge 调用 Host 的 `invalidate(itemId | groupId)`，Host 重新 resolve snapshot；第一版不开放任意 observable、stream 或插件控制的 polling。

### 9.3 推荐 Group 模型

Group 只允许同一 contribution/provider 内的局部关系：

```ts
type LauncherGroupContribution<TSettings = unknown> = {
  id: string
  display?: LauncherGroupDisplay
  presentation: 'section' | 'composite'
  members: Array<{
    role: 'primary' | 'alternative' | 'supporting'
    entry: LauncherEntryContribution<TSettings>
  }>
  selection?:
    | { mode: 'single'; submit: LauncherActionContribution<TSettings> }
    | { mode: 'multi'; min: number; max: number; submit: LauncherActionContribution<TSettings> }
  constraints?: Array<
    | { kind: 'mutex'; memberIds: string[] }
    | { kind: 'conflict'; memberIds: string[]; message: LocalizedText }
  >
  coalesce?: { key: string; mode: 'dedupe' | 'variants' }
}
```

关系规则：

- 普通视觉分组用 `section`，成员仍独立 ranking/快捷执行。
- 父子/附属优先用 owned Action/Detail；只有真正是“若干对象成员”才用 Group。
- mutual exclusion 用 single selection 或 mutex。
- conflict 必须有可解释 i18n message；Host 阻止提交。
- merge/coalesce 只在 provider scope 内生效；跨插件只能由 Host 内部 policy 合并。
- batch 必须是同一 Group 的显式 multi selection；不开放根列表跨插件勾选。

### 9.4 推荐 SearchFrame snapshot

把当前分散在 session 和 controller 的上下文收进根 Frame：

```ts
type SearchFrame = {
  kind: 'search'
  query: string
  selectedKey?: string
  activeZone: 'list' | 'detail' | 'group' | 'action'
  expandedKey?: string
  activeActionId?: string
  groupSelection?: Record<string, string[]>
  scrollAnchorKey?: string
  generation: number
}
```

进入 Params/Collect/Result/Surface 时不清空它；返回时按 stable key 恢复。若 key 已失效，Host 选择同一 Group 的最近 member，再退化到原索引附近，并显示“结果已刷新”；绝不复活 provider 已删除的旧 Item。

Launcher 完全关闭后只沿用现有 sticky query policy，不跨会话恢复 Detail、action zone 或 batch selection，避免陈旧副作用上下文。

### 9.5 推荐状态机

```text
SEARCH(list, selected Entry)
  Enter                  → RUN(primary)
  Tab                    → RESOLVE_DETAIL → DETAIL
  ⌘/Ctrl+Enter           → PARAMS_FRAME（若允许）
  ⌘/Ctrl+1…8             → RUN(visible Entry primary)

DETAIL
  Tab / ↑↓               → action/control virtual focus
  Enter                  → RUN(action)
  Space                  → toggle/single/multi selection only
  Esc                    → collapse → SEARCH
  query printable input  → collapse, event continues to search input
  invalidate             → stable skeleton → re-resolve

GROUP
  ↑↓                     → member
  Space                  → select under constraints
  Enter                  → member primary or explicit group submit
  Right/Tab              → member actions
  Left/Esc               → SEARCH

RUN(action)
  permission missing     → Host Permission Frame
  destructive/confirm    → Host Result Confirm Frame
  params/input required  → existing Params / Collect Input
  output                 → existing Result Frame
  surface request        → existing Plugin Surface
  success + close        → close
  success + invalidate   → refresh item/group/list, preserve key
  success + undo         → lifecycle undoable
  failure                → action-scoped error, stay in context
  source version changed → stale, block commit, offer refresh
```

### 9.6 推荐键盘表

| Key | Search/List zone | Detail/Action zone | Group zone | Frame/Surface |
|---|---|---|---|---|
| `↑/↓` | 选择 Entry | 选择 action/control | 选择 member | 由当前 Frame 定义 |
| `Tab` | 打开/进入 Detail 或 Group | 下一个 primitive；Shift 返回 | 进入 member action | Host 固定顺序 |
| `Enter` | 主动作 | 当前 action | member primary 或显式提交 | 当前 Frame primary |
| `Space` | 输入空格 | 只切 toggle/choice | 选择 member | multi-select 时切换 |
| `Esc` | 关闭 Launcher | 收起并回 Search | 退出 Group | 弹一层 |
| `Left/Right` | 移动搜索 caret | Left 返回；Right 进入当前 control | Left 退出；Right 进 member action | 由 Frame 决定 |
| 裸数字 | 输入 query | 输入并自动回 Search | 输入并自动回 Search | 仅明确数字输入场景 |
| `⌘/Ctrl+1…8` | 执行根 Entry/Group primary | 不生效 | 不执行 member | 不生效 |

`Tab` 是从 Search 进入渐进交互的唯一稳定快捷键；Search zone 不劫持左右键。所有 activation 在 `event.isComposing`、tracked composition、keyCode 229 和 compositionend guard 内禁用，Esc 例外。

### 9.7 Item、Frame、Surface 的硬边界

适合 Item/Detail 原地完成：

- 短只读 preview；
- 最多 4 个 owned actions；
- 一个 toggle 或 ≤5 项 single choice；
- 接受、拒绝、恢复、撤销；
- 简短状态与手动 refresh；
- 同一 Group ≤6 个成员的轻量选择。

必须进入 Frame：

- 文本/数字输入；
- 参数步骤；
- 破坏性确认；
- 输出目的地；
- 显式提交的常规 multi-select；
- 超过 5 个选项、需要过滤的 choice；
- 需要暂时替代搜索上下文，但仍可由 Host 原语表达的流程。

必须进入 Surface：

- 任意布局、富文本/代码/表格编辑；
- 独立滚动、长列表、分页或搜索内部数据；
- 多层导航、复杂配置、长期驻留状态；
- 插件产品专属 toolbar、fallback 或视觉语义。

### 9.8 插件可以声明什么

- display：title/subtitle/icon/aliases/kind label，全部 i18n；
- primary action 与最多 4 个 attached action；
- action role、tone、effect policy、required capability；
- 短 preview、properties、产品状态文案；
- toggle/single 的当前值；
- availability/completed/stale/undoable 事实；
- provider-scoped Group、成员、selection、constraint 与 coalesce key；
- action 实现和进入现有 Frame/Surface 所需的产品数据。

### 9.9 Host 必须统一控制什么

- ranking、quick number、favorite、usage 与 stable identity；
- 行、Detail、Group、badge、tone、spacing、动画和窗口高度；
- 唯一真实 input focus、virtual focus、ARIA、IME、pointer/keyboard 切换；
- action ordering：primary、secondary、feedback、recovery、undo；
- 每个 action 的权限、能力、effect policy、确认、重入锁和 telemetry；
- abort、version、stale、invalidation、刷新与 selection preservation；
- error/success/undo 的位置和生命周期；
- Frame stack snapshot、Surface occupancy 和返回恢复；
- i18n completeness、长度、action/member 数量与非法组合校验。

### 9.10 防止自定义 renderer 破坏一致性

插件不能返回 React node、HTML、CSS class、style、色值、布局、动画、快捷键或任意 `render()`。

Host 只接受：

- `IconRef`；
- `LocalizedText`；
- `text/properties` 两种 preview；
- `neutral/success/warning/error` status tone；
- `default/danger` action tone；
- `toggle/single` control；
- `section/composite` group presentation。

Detail 深度固定为 1；Group member 不再包含 Group；可见 member ≤6；action ≤4；超限时 normalizer 拒绝或要求 Surface，不静默截断会改变语义的内容。

## 10. 推荐模型对真实场景的覆盖

### 10.1 URL 学习建议

`web-open` 产生一个 proposal Entry 或 supporting Group；证据、作用域与目标模板在 Detail 中。`试一次` 可作为 primary，`添加并打开`、`不是这条`、`编辑后添加`、`永久屏蔽` 是 feedback/secondary action。它们不参与 ranking、favorite、usage 或数字快捷键。

接受后 lifecycle 变成 `completed + undo`，Host 原地显示“已添加规则”与撤销；provider invalidate 后重新 resolve。URL 状态机与存储仍完全属于 `web-open`。

### 10.2 浏览器标签与历史

浏览器标签是 Entry，primary 为 focus；Detail 提供完整 URL、copy、pin toggle、close。历史是独立 Entry/section。若同 URL 同时有 open tab 与 history，`web-open` 可在 provider scope 以 variants Group 合并，primary 为 focus open tab；Host 不理解 URL 去重规则。

### 10.3 即时结果

Calculator 等 direct answer 仍是一个 ranked Entry；短结果在 title/subtitle，完整结果在 Detail preview。Enter 执行默认 output action（如 copy），其它 output destination 是 attached action。无需先执行 Item、构造单 choice、再被 controller 自动执行一次。

### 10.4 参数命令

Entry Detail 只展示默认参数摘要和“定制参数”action。需要编辑时进入现有 Params Frame；Collect Input 继续拥有真实输入框。Item 不承载任意表单。

### 10.5 多选操作

Diff 的来源选择继续使用 Result Frame，并建议补 `submitMode: 'explicit' | 'at-max'`，默认新流程用 explicit。确实是同一搜索单元的少量成员时可使用 multi Group；根搜索结果不开放跨插件选择。

### 10.6 禁用与恢复

Saved Action 等 disabled Entry 改用 `aria-disabled`，仍可被 `↑/↓`、hover 和点击选中。Enter 只显示原因或保持无操作；Tab 展开 Detail，recovery action 可打开设置、重新授权或刷新。纯粹不相关的不可用项仍应在 provider/ranking 前过滤。

## 11. 实施影响与验证范围

本轮不实现。确认后建议按以下顺序落地：

1. 先新增纯类型 normalizer 与 runtime state reducer，不改 UI。
2. 把根 `ListFrame` 升级为带 query/selected/zone snapshot 的 `SearchFrame`。
3. 让 primary/secondary/feedback/recovery/undo 全部进入同一 action gate。
4. 先实现 Entry + Detail；Group 只落 section/composite 和 explicit selection 的最小集合。
5. 迁移一个简单案例（browser tab）和一个反馈案例（URL suggestion），再迁其它 provider。

最小逻辑测试：

- action ownership 不进入 ranking/quick number；
- runtime reducer 的 confirm/running/success/failure/stale/undo；
- Frame back snapshot 恢复；
- disabled + recovery；
- Group single/multi/mutex/conflict；
- provider invalidation 后按 key 保持选择；
- normalizer 拒绝 JSX、深度、数量、缺 i18n 与非法 action role。

不为 UI 写单元测试。UI 通过 web validation 检查真实 DOM、input focus、ARIA、IME、键鼠、窗口高度和控制台错误。

## 12. 本轮需要确认的产品决策

推荐默认值如下：

1. `Tab` 是从搜索进入 Detail/Group 的唯一主快捷键；Search zone 的左右键永远留给 caret。
2. Detail 只允许短 preview、4 个 action、一个 toggle 或 ≤5 项 single choice；常规 multi-select 进入 Result/Group Frame。
3. 根列表不支持跨插件批量选择；Group 只在同一 provider scope 内声明，跨 provider 合并由 Host policy 控制。
4. 禁用 Item 可选择、可解释、可恢复，使用 `aria-disabled` 而不是 native `disabled`。
5. URL 学习建议只是验证案例：用 proposal Entry/Group + feedback action 表达，不增加 URL 专用 Host 类型。

确认这些边界后再修改正式代码。
