# Hiven LauncherItem 行为与交互设计

日期：2026-08-30  
状态：设计提案，未实现

## 1. 结论

`LauncherItem` 继续代表“可搜索、可排序、可直接执行的入口”，扩展为：

```text
LauncherItem
├── 主动作：现有 behavior + execute
└── Action Menu：显式打开的附属动作
    ├── 普通动作
    ├── Toggle
    └── 执行后进入现有 Frame
        ├── Params
        ├── Collect Input
        ├── Result Choices / Preview
        ├── Multi-select
        └── Plugin Surface
```

不把 item 变成任意 UI 容器，不开放自定义 renderer，不把附属动作注册成新的搜索结果。

## 2. 为什么这样分层

当前系统已经有两层能力：

- `LauncherItem`：搜索前的入口，承担匹配、排序、收藏、快捷执行和主行为。
- `LauncherOutput / LauncherResultChoice`：执行后的结果、预览、确认、附属动作和多选。

真正缺少的是两者之间的一层：用户想对“这个 item 本身”做其它操作，例如复制 URL、固定、编辑、关闭、查看详情或切换开关。

因此只增加 Action Menu，不重做现有 Frame。

## 3. Item 类型不按产品语义扩张

所有 item 仍使用同一结构，不增加 `browser-item`、`history-item`、`learning-item` 等 host 类型。差异来自已有 display、主行为和可选动作。

| Item 能力 | 展示 | Enter | Action Menu |
|---|---|---|---|
| 普通命令 | 标题、说明、类型 | 执行 | 固定、定制参数 |
| 即时结果 | 结果用途、预览 | 默认复制/去向 | 其它去向、在编辑器打开 |
| 导航目标 | 名称、路径/URL | 打开/切换 | 复制地址、固定、关闭 |
| 有参数命令 | 标题、默认参数摘要 | 走现有参数策略 | 使用默认值、定制参数 |
| 可切换对象 | 名称、当前状态 | 默认动作 | Toggle、编辑、删除 |
| 不可用项 | 名称、不可用原因 | 禁止 | 修复/授权入口 |

## 4. 最小协议

```ts
export type LauncherItemActionControl = {
  type: 'toggle'
  checked: boolean
}

export type LauncherItemActionChoice = LauncherResultChoice & {
  actionPolicy: ToolActionPolicy
  requiredCapabilities?: LauncherHostCapability[]
  control?: LauncherItemActionControl
}

export type LauncherItemActionsOutput = {
  choices: LauncherItemActionChoice[]
}

export type LauncherItemActionsHandler<TSettings = unknown> = (
  ctx: LauncherExecutionContext<TSettings> & {
    query: string
    signal: AbortSignal
  },
) => LauncherItemActionsOutput | null | Promise<LauncherItemActionsOutput | null>

export type LauncherItemContribution<TSettings = unknown> = {
  // 现有字段不变
  id: string
  display: LauncherItemDisplay
  behavior?: LauncherBehavior
  execute: LauncherExecuteHandler<TSettings>

  // 新增；缺失时交互完全不变
  actions?: LauncherItemActionsHandler<TSettings>
}
```

Action Choice 复用 `LauncherResultChoice` 的标题、图标、subtitle、preview、tone 和执行函数。只增加逐动作 policy/capability 与 toggle control。

不增加 `renderDetail()`、任意 JSX、动作自定义快捷键或 action 子菜单。

## 5. Action Menu

### 5.1 打开方式

- 键盘：`Tab`。
- 鼠标：选中/hover 行尾的 `…`。
- 鼠标：右键 item。
- 不使用 `→`，避免与搜索输入光标冲突。

### 5.2 内容

Host 自动把原 item 主动作放在第一项，标记“默认”。插件只声明附属动作。

```text
←  Chrome · Production Logs

切换到标签页                         默认  ↵
复制 URL
固定标签页                              [开关]
关闭标签页                              危险

当前动作预览
https://cloud.example/log/abc
```

- 动作菜单不是搜索结果，不参与排序、收藏和快捷序号。
- hover/选择动作时可以显示它的纯文本 preview。
- Toggle 成功后保持菜单，并重新 resolve actions；不乐观假设插件状态。
- 危险色只表示视觉语气，不能替代 action policy、权限和确认。
- 超过 8 个动作说明产品已复杂，应打开插件 surface。

## 6. 状态机

```text
SEARCH
  Enter        → 执行 item 主动作
  Tab / …      → ACTION_MENU_LOADING

ACTION_MENU_LOADING
  Esc          → SEARCH
  resolve      → ACTION_MENU
  failure      → ACTION_MENU（保留主动作，显示错误）

ACTION_MENU
  ↑ / ↓        → 选择动作
  Enter        → EXECUTING_ACTION
  Space        → 执行当前 toggle
  Esc / ←      → SEARCH

EXECUTING_ACTION
  success      → 关闭 / 按 keepOpen 留在菜单
  toggle       → 重新 resolve 菜单
  output       → 现有 L2 Frame
  failure      → 菜单内错误，可重试

L2 FRAME
  Esc / back   → ACTION_MENU
  complex flow → Plugin Surface
```

Action Menu 最多一层。Result Choice 不再拥有自己的 Action Menu；复杂度超过 L2 时进入 surface。

## 7. 键盘模型

### Search

- 输入框保持真实焦点，item 使用虚拟焦点。
- `↑ / ↓`：选择 item。
- `Enter`：执行主动作。
- `Tab`：打开 Action Menu。
- `⌘1…⌘8`：执行对应 item 主动作。
- `⌘P`：保持现有固定/取消固定。
- `⌘Enter`：保持现有参数定制。
- IME composition 期间 Enter 不执行。

### Action Menu

- `↑ / ↓`：选择动作。
- `Enter`：执行动作。
- `Space`：仅对 toggle 生效。
- `Esc / ←`：返回搜索列表，恢复原 query 和 item。
- 可打印字符：返回搜索并继续输入。
- query 变化或原 item 消失：取消异步 resolve，安全返回搜索。

## 8. 鼠标模型

- 单击 item 主体：执行主动作，保持现有习惯。
- 单击 `…`：只打开菜单。
- 右键 item：打开同一个菜单，不实现第二套 context menu。
- hover item：只更新选择，不加载 Action Menu。
- hover action：更新 preview，不执行。
- Toggle 点击 switch 或整行均可切换；一次只能执行一个动作。

## 9. Item 状态

Host 统一渲染以下状态，插件不能传颜色或 CSS：

| 状态 | 行为 |
|---|---|
| selected | 完整背景选中，footer 显示主动作和“更多” |
| disabled | 仍可被选择和读屏读取，但主动作禁止；说明原因与恢复动作 |
| loading | 保持行宽和位置，动作区域显示进行中，禁止重复提交 |
| error | 错误靠近 item 或菜单动作显示，不只用 toast |
| stale | 动态 item 在菜单打开后消失时，退出菜单并说明结果已更新 |
| checked | 只出现在 Action Menu 的 toggle，不把根 item 变成 checkbox |

当前根行使用原生 disabled button 会导致不可选择；实现时应改为 `aria-disabled` 并由 controller 阻止执行。

## 10. Preview

Preview 是 Action Menu / Result Frame 的只读区域，不是根列表自动展开：

- 纯文本，最多 6 行。
- 允许选择复制。
- 不请求网络，不在 hover item 时异步加载。
- 不解析 Markdown、JSON、URL 等产品语义。
- 长内容、富交互、独立滚动进入插件 surface。

## 11. Toggle

Toggle 只用于明确二态设置，例如固定、启用、静音：

- `checked` 由 actions provider 返回。
- `primaryAction` 执行真实变更。
- 成功后重新 resolve，插件状态是真相源。
- 失败保留旧值并显示错误。
- destructive 状态变化不能伪装成 toggle，应使用明确动作和确认。

## 12. 多选

不支持根搜索列表跨插件多选。原因是不同 item 没有统一批处理语义，且会破坏主动作与快捷执行。

某个 item 需要选择多个对象时，执行其 action 后复用现有 `LauncherOutput.selection`：

```ts
type LauncherResultSelection = {
  type: 'multi'
  min: number
  max: number
  submitMode?: 'at-max' | 'explicit'
  submitTitle?: string
  submit: (choices: LauncherResultChoice[]) => MaybePromise<LauncherExecuteResult | void>
}
```

默认 `at-max` 保持兼容；`explicit` 使用 Space 选择、Enter 提交。

## 13. 主动作和附属动作的边界

主动作应当是用户搜索该 item 时最常见、最可预测的动作。

附属动作适合：

- 复制、固定、编辑、关闭、删除；
- 使用另一种输出去向；
- 查看详情；
- 启用/停用；
- 进入参数、多选或确认流程。

不适合：

- 与 item 无关的推荐；
- 另一个可以独立搜索的命令；
- 超过一层的动作树；
- 表单、复杂配置、长内容编辑；
- 任意插件 UI。

独立意图应注册为独立 Item；复杂产品流应打开 surface。

## 14. 与现有系统的复用

| 需求 | 复用现有能力 |
|---|---|
| 主动作 | `behavior + execute` |
| 动作行 | `LauncherResultChoice` |
| 预览 | `preview` |
| 动作输出 | `LauncherExecuteResult.output` |
| 参数 | `ParamInputFrame` |
| 继续输入 | `CollectInputFrame` |
| 确认/选择 | `ResultFrame` |
| 多选 | `LauncherOutput.selection` |
| 复杂 UI | Plugin Surface |
| 权限/副作用 | Commit Gate + action policy |

只新增 `actions` provider、Action Menu frame 和 toggle control。

## 15. 验收标准

- 没有 actions 的旧 item 行为完全不变。
- Enter 永远走现有主动作完整路径，不绕过参数、权限、usage 或 telemetry。
- 附属动作不进入搜索、排序、收藏、快捷序号和主 item frecency。
- Tab、`…` 和右键打开同一个 Action Menu。
- Action Menu 支持普通动作、preview、toggle、危险动作和进入现有 Frame。
- Toggle 成功刷新、失败回滚。
- disabled item 可选择、可解释，但不能执行。
- query 改变或 item 消失能取消异步菜单并恢复搜索。
- 搜索输入、IME 和返回栈行为稳定。
- 插件不能注入自定义 renderer、CSS、任意快捷键或无限动作层级。
- 只为 controller、normalize 和状态转换写最小测试；UI 不写单元测试。

