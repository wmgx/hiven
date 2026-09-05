# hiven 可学习个人工具架构

## 单轨增量方案 v1.1：背景、代码约束、接口设计与四周落地计划

- 版本：1.1
- 日期：2026-08-25
- 状态：实施前架构提案，不代表现有产品边界已经变更
- 评审基础：两份 hiven 方向报告、`wmgx/hiven` 公开主分支 `abddb6d`、Fable5 对 v0.9 与 v1.0 的两轮反对优先评审
- 目标读者：产品负责人、架构评审者、Launcher / 插件 / Tauri 持久化负责人

> 核心结论：**不新建 Action Runtime，不取消插件机制，不先引入 Agent，也不先监控整个桌面。先在现有 Launcher 单轨上建立“正式提交、执行完成、明确输出、手动沉淀”的可信事实；只有 Saved Action 被真实复用后，再门控自动学习。**

---

## 0. 执行摘要

hiven 已经具备 Object Block、内容识别、命令推荐、参数流、插件工具、结果 Choice、Usage/Frecency 和一批 first-party 工具。近期缺少的不是更多内容规则，而是一个可靠事实链：

```text
用户正式提交了哪个动作？
动作计算是否成功？
用户明确应用了哪个 Host 输出？
这次配置是否被保存成工具？
保存后是否真的再次运行？
```

v1.1 对前一版做六项关键修正：

1. **正式提交不只等于 `runAndHandle`。** `submitInput` 还存在 `preview-choice` 与 `suggestion` 两条快速提交路径，它们不再调用 `execute`，但必须在用户按下 Enter 时合成一对 `run.started / run.finished`。
2. **Host 输出采用不能靠裸 `choice.id` 判断。** 插件可以创建任意 Choice ID；V1 用 Host 模块私有的 `WeakMap` 标记输出 Choice/Action，Controller 认对象标记，不认字符串名称。
3. **参数持久化改为逐参数 opt-in。** 所有参数默认不可保存；`LauncherParamSpec.saveable: true` 才允许进入 Saved Action。`text` 参数还必须声明最大保存长度，从而支持 `join separator`、`prefix/suffix` 等真正高价值配置。
4. **契约指纹只包含行为字段。** 在归一化后的 `LauncherItem` 上计算，只纳入参数 key、type、required、default 和 option value；label、i18n、description 等展示字段完全排除。
5. **手动保存的主入口是“把上一次运行保存为工具”。** 因为 Global Launcher 的 Enter 常常复制后立即关闭，Result Frame 和 Toast 只作为可选补充入口。
6. **第 2 周进一步减重。** 只交付正式提交事实、三类核心事件、SQLite、导出和清除；HMAC input fingerprint、参数签名、候选分组和隐式输出回执移到后续周次。

四周最小路线：

```text
第 1 周：数据卫生 + policy/saveable 契约
第 2 周：正式提交门 + run 事件 + Experience Journal
第 3 周：手动 Saved Action + 保存上一次运行
第 4 周：输入指纹 + 非默认单动作候选 + 候选分母
```

V1 不交付：

```text
独立 Action Registry / Runner
Canonical Result
Routine
LLM Distiller
Agent
全桌面行为监控
隐式 Editor 输出学习
```

---

## 1. 背景与产品方向

### 1.1 两份方向报告的共同主线

两份报告都不建议 hiven 变成通用 Agent/RPA。更适合的长期方向是：接住当前对象，找到正确动作和去向，并把反复成功的路径折叠成可命名、可解释、可撤销的个人工具。[R1][R2]

```text
当前对象
→ 正确动作
→ 正确去处
→ 执行回执
→ 重复证据
→ 个人工具
```

能力升级顺序仍然是：

```text
单动作预设
→ 纯文本 pipeline
→ 领域 Playbook
→ 有界 Agent
```

规则能解决的不用模型；单动作能解决的不用流程；固定领域 Playbook 能解决的不用开放 Agent。[R1]

### 1.2 当前证据只支持先做手动沉淀

报告给出的本机基线为：

```text
92 个 Launcher 会话
5 次带稳定动作 ID 的执行
没有达到阈值的重复候选
```

因此当前不能假定“单人使用中一定存在足够可挖掘的行为”。正确顺序是：

```text
先允许用户把一次成功操作手动保存
→ 观察 Saved Action 是否跨日复用
→ 再决定是否值得自动挖掘
```

这与报告的 D21 优先、D22 门控结论一致。[R1][R2]

### 1.3 为什么不先做全天行为监控

持续捕获屏幕、键盘、聊天正文或全部应用行为，会引入：

- 旁观者数据和敏感场景；
- 难以解释的行为因果；
- 存储、保留、删除和授权债务；
- 外部行为无法映射为 hiven 的可执行能力；
- 用户无法审计系统到底记住了什么。

V1 只观察 hiven 内部的正式提交和 Host 已知输出，不观察外部桌面完整行为。[R2]

---

## 2. 当前代码事实与关键约束

### 2.1 Launcher 已经是单轨协议

当前主要路径是：

```text
Contribution
→ normalizeContribution()
→ Resolved LauncherItem
→ eligibility / ranking
→ Controller 参数状态机
→ execute / executeWithParams
→ LauncherExecuteResult
→ Result Choice
```

Registry 汇总 Host、插件静态/动态项和工具；`toolAdapter.ts` 把 `PluginToolContribution` 适配为 LauncherItem；Controller 管理提交、结果栈和关闭语义。[C1][C2][C3]

因此 V1 不新增：

```text
ActionDefinition
ActionRegistry
ActionProvider
ActionRunner
```

“Action Runtime”在 V1 中只是现有单轨加政策元数据和事件插桩。

### 2.2 Usage Journal 记录的是选择意图，不是成功事实

现有 Usage Journal 主要记录：

```ts
commandId
surfaceId
executedAt
prevCommandId
objectKind
```

而且 Controller 在实际执行前记录 selection，因此它无法证明：

- 执行是否成功；
- 结果是否被采用；
- 采用的是复制、插入还是回流；
- 参数是否为非默认值；
- 保存后是否再次使用。[C2][C4][C5]

Usage Journal 继续服务 frecency，不承担学习事实源。

### 2.3 正式提交存在三种执行形态

“正式提交”不能简单定义为“进入 `runAndHandle`”。当前至少有三种形态：

#### A. 正常 execute 提交

```text
用户 Enter
→ execute / executeWithParams
→ runAndHandle
→ result
```

这条路径自然拥有 started / finished 边界。

#### B. Preview Choice 快速提交

Live Preview 已经在用户输入过程中计算出最新输出。当 `submitInput` 发现 Preview 对应当前输入时，用户按 Enter 会直接调用：

```text
runChoiceAction(firstPreviewChoice.primaryAction, via='preview-choice')
```

不会再次执行工具。

Preview 计算本身不能写 Experience Event；但用户按 Enter 已经是正式提交。此时必须在提交点创建 run，复用已解析 Choice 而不重新执行工具：

```text
run.started(via='preview-choice')
→ 执行已解析 Choice
→ run.finished(success/failed, via='preview-choice')
→ Host 输出成功时写 output.applied
```

`via` 明确告诉分析器：这次 run 的计算结果来自此前的 Preview，而不是一次新的 `execute`。

#### C. Suggestion 快速提交

当用户高亮 Suggestion 后按 Enter，Controller 可能直接执行 Choice：

```text
runChoiceAction(..., via='suggestion')
```

同样不再进入 `runAndHandle`。它也必须在提交点合成 started / finished，不能产生孤儿 `output.applied`。

### 2.4 Preview 和 Suggest 计算不是正式执行

需要严格区分：

```text
预计算：为了显示预览或建议而调用插件逻辑
正式提交：用户明确按 Enter 接受当前已解析结果
```

硬规则：

```text
Preview/Suggest 的计算阶段：0 个 Experience Event
用户提交 Preview/Suggestion：恰好 1 对 started/finished
```

Provider、`tool.run()` 和 `toolAdapter` 都不知道一次调用究竟是预览还是提交，因此不能在这些层级直接写 Journal。

### 2.5 Result Choice 的字符串 ID 不是可信语义

当前 Host 输出 Choice 使用了一些裸字符串 ID，例如：

```text
copy
insert
return-to-launcher
open-quick-editor
```

插件自定义 Choice/Action 也可以使用任意 ID。若 Controller 仅按字符串映射输出意图，插件确认项恰好叫 `copy` 时会被误判为结果采用。

因此 V1 的输出事实必须满足：

```text
Host 构造该 Choice
且
Host 私有标记声明其 OutputIntent
且
该 Choice 实际执行成功
```

不能仅凭 ID、标题或插件元数据推断。

### 2.6 Choice 既可能是输出，也可能是真正执行

部分工具把危险操作或 Shell 调用放在确认 Choice 的 `primaryAction` 内：

```text
tool.run()
→ 返回确认 Choice
→ 用户 Enter
→ primaryAction 内真正执行副作用
```

因此：

```text
run.finished(success)
```

不总是等于领域操作完成；通用 `choice.activated` 也不等于结果被采用。V1 只对 `pure/read + learnable` 工具和 Host 标记输出建立学习事实。

### 2.7 契约指纹不能包含展示文案

`LauncherParamOption` 包含：

```text
value
label
labelI18n
description
descriptionI18n
```

Saved Action 的行为兼容性只与 value 和参数结构有关。语言切换或文案修改不应使全部 Saved Action 失效。

### 2.8 高价值参数不全是枚举

`line-tools` 的 join separator、prefix/suffix、wrap left/right 等参数是 `text`，但它们正是 Saved Action 最值得保存的配置。

因此不能按参数类型一刀切；需要逐参数显式声明是否可保存，并为 text 参数增加长度上限。

---

## 3. v1.1 架构裁决

| 议题 | v1.1 决定 | 原因 |
|---|---|---|
| Action Runtime | 不新建 | 保持 Launcher 单轨，避免第三套动作表示 |
| Tool policy | 只保留 `effect + learnable` | `replay` 可由 effect 和是否 opt-in 推导，当前无独立消费者 |
| 正式提交边界 | 新增统一 Commit Gate | 同时覆盖 execute、preview-choice、suggestion、Saved Action |
| Preview 计算 | 完全不记事件 | 避免每次击键污染学习事实 |
| Preview/Suggestion 提交 | 合成 started/finished | 它们是用户正式提交，但不会再调用 execute |
| 输出识别 | Host 私有对象标记 | 裸 ID 可被插件碰撞，不能作为可信语义 |
| Canonical Result | 推迟 | 单动作事实与手动保存不需要跨步骤数据绑定 |
| 隐式 Editor 输出回执 | 保留设计、四周内推迟 | 不计自动学习证据；先缩减第 2 周范围 |
| 参数持久化 | 逐参数 `saveable:true` | 支持低敏感 text 参数，默认仍 fail closed |
| text 参数 | 必须声明保存长度上限 | 控制正文和滥用风险 |
| 契约指纹 | 归一化后、展示字段无关 | i18n 或描述变更不应禁用 Artifact |
| Saved Action 入口 | “保存上一次运行”作为主入口 | Launcher 复制后常立即关闭，Result Frame 不可靠 |
| 单动作挖掘 | 仅非默认配置/去向 | 默认动作已由 frecency 覆盖 |
| 候选统计 | 增加 `candidate.surfaced` | 没有曝光分母就无法判断忽略率 |
| 错误分类 | 增加 `error_type` | `status=failed` 不能解释失败类别 |
| No-content 测试 | 显式维护 Source/Sink 清单 | 全盘扫描必然误报，少量路径扫描会漏报 |
| Routine / Distiller / Agent | 推迟 | 先验证手动 Saved Action 的采用率 |

---

## 4. 设计原则与系统边界

### 4.1 产品可以一体化，代码继续插件化

近期可以：

- 只发布 first-party 插件；
- 不建设插件市场；
- 不突出插件概念；
- 不承诺第三方学习契约稳定性；
- 所有内置能力随 hiven 原子发布和测试。

但 JSON、Diff、翻译、飞书和浏览器语义仍归插件。Host 只拥有中性机制：[R2]

| Host / Launcher | 插件 |
|---|---|
| systemKey、参数状态机、提交执行、输出标记、回执摘要 | JSON、Diff、飞书等能力实现 |
| 权限、取消、状态枚举 | 领域失败、幂等和补偿 |
| Experience Journal、Saved Action 投影、候选阈值 | 参数业务含义与实际校验 |
| frecency、抑制、存储配额 | 领域规则最终编辑体验 |

### 4.2 能力必须实现，策略才可以学习

插件决定“能做什么”；学习层只能学习：

```text
在什么输入绑定下调用哪个现有动作
保存哪些已声明可持久化的参数
采用哪个 Host 输出意图
是否值得命名为个人工具
```

### 4.3 用软方法发现，用硬约束落地

发现可以是启发式；落地必须通过：

```text
稳定 systemKey
→ learnable policy
→ saveable 参数白名单
→ 契约指纹
→ 原工具重新校验
→ 用户明确保存
```

### 4.4 Agent 不是学习前提

V1 的重复分组、跨日统计、不同输入计数、证据卡和手动保存都不需要 Agent。只有开放目标无法由固定动作或 Playbook 覆盖时，才考虑 Agent。

---

## 5. V1 总体架构

```text
PluginToolContribution
  │
  ├─ policy?: { effect, learnable }
  └─ params[].saveable / saveableMaxLength
  ▼
现有 toolAdapter
  ▼
现有 LauncherItem / systemKey
  ▼
LauncherController
  │
  ├─ Commit Gate
  │    ├─ execute via runAndHandle
  │    ├─ preview-choice 快速提交
  │    ├─ suggestion 快速提交
  │    └─ Saved Action 调用
  │
  ├─ run.started
  ├─ run.finished
  └─ ResultFrame / resolved choice 带 CommittedRunContext
          │
          ▼
Host Output Action Marker（WeakMap）
          │
          ├─ 标记且执行成功
          │      → output.applied
          │      → 更新 LastSaveableRun（仅内存）
          │
          └─ 未标记插件 Choice
                 → 正常执行
                 → 不计采用证据
                          │
                          ▼
                 Experience Journal
                          │
              ┌───────────┴────────────┐
              ▼                        ▼
     “保存上一次运行”命令       后续 Candidate Miner
              │                        │
              └────────→ Saved Action Launcher Item
```

V1 不旁路 Controller，也不让插件直接写 Experience Journal。

---

## 6. 最小接口设计

### 6.1 ToolActionPolicy

```ts
export type ToolEffect =
  | 'pure'
  | 'read'
  | 'local-write'
  | 'external-write'
  | 'destructive'
  | 'unknown'

export type ToolActionPolicy = {
  effect: ToolEffect
  learnable: boolean
}
```

贡献接口增量：

```ts
export type PluginToolContribution<TSettings = unknown> = {
  // existing
  id: string
  params?: LauncherParamSpec[]
  run(...): Promise<LauncherExecuteResult> | LauncherExecuteResult

  // new
  policy?: ToolActionPolicy
}
```

保守默认：

```ts
export const DEFAULT_TOOL_ACTION_POLICY: ToolActionPolicy = {
  effect: 'unknown',
  learnable: false,
}
```

学习资格：

```ts
function isLearnablePolicy(policy: ToolActionPolicy): boolean {
  return policy.learnable &&
    (policy.effect === 'pure' || policy.effect === 'read')
}
```

注意：`pure` 在这里表示“无外部副作用”，不保证确定性。随机数、当前时间等动作即使无副作用，也应保持 `learnable:false`。

### 6.2 LauncherParamSpec 的保存声明

所有参数默认不可持久化：

```ts
export type LauncherParamSpec = {
  // existing
  key: string
  type: LauncherParamType
  required?: boolean
  default?: unknown
  options?: LauncherParamOption[]

  // new
  saveable?: true

  /** type=text 且 saveable=true 时必填。 */
  saveableMaxLength?: number
}
```

契约规则：

```text
saveable !== true
→ 值不得进入 Saved Action 或 Experience Journal

type = text 且 saveable = true
→ saveableMaxLength 必须为 1..256 的整数
→ 实际值超长时拒绝保存，不做静默截断

select / multi-select
→ 只能保存当前 option value
→ 不保存 label 或 description

任一非 saveable 参数的实际值偏离默认值
→ 本次运行不可保存为 Saved Action
→ UI 解释具体阻断参数
```

最后一条避免“保存时悄悄丢掉非默认参数”，否则下次运行看似成功，行为却已改变。

第一批 text opt-in 可包括：

```text
line-tools.join.separator
line-tools.prefix.value
line-tools.suffix.value
line-tools.wrap.left
line-tools.wrap.right
```

### 6.3 输入绑定收缩

V1 Saved Action 只支持：

```ts
export type InputBinding =
  | 'selection'
  | 'active-text'
  | 'prompt'
```

说明：

- `selection`：要求当前有明确选区；
- `active-text`：读取当前活动编辑器文本；
- `prompt`：复用现有 collect-input 流，运行时再次输入正文；
- `current-object`：依赖稳定对象可用性与生命周期，推迟；
- 不保存任何 prompt 或输入正文。

### 6.4 CommittedRunContext

它只存在于内存和 ResultFrame，不默认写入 Journal：

```ts
export type SaveableParamValue =
  | boolean
  | number
  | string
  | string[]

export type CommitVia =
  | 'execute'
  | 'preview-choice'
  | 'suggestion'
  | 'saved-action'

export type SaveableRunSnapshot = {
  inputBinding: InputBinding
  savedParams: Record<string, SaveableParamValue>
  contractFingerprint: string
}

export type CommittedRunContext = {
  runId: string
  actionKey: string
  surfaceId: LauncherSurfaceId
  via: CommitVia

  /** 不支持 V1 输入绑定的动作可为空，仍能留下执行事实。 */
  inputBinding?: InputBinding

  /** 第 3 周才加入并填充；缺失表示本次运行不可保存。 */
  saveSnapshot?: SaveableRunSnapshot
}
```

禁止出现：

```text
inputText
selectionText
clipboardText
query
outputText
raw error.message
URL / path / window title
```

### 6.5 统一 Commit Gate

建议在 Controller 内建立单一帮助器：

```ts
async function commitResolvedAction(input: {
  item: LauncherItem
  via: CommitVia
  inputBinding?: InputBinding
  params: Record<string, unknown>
  execute?: () => Promise<LauncherExecuteResult>
  resolvedChoice?: LauncherResultChoice
}): Promise<void>
```

语义：

#### execute 路径

```text
started
→ 调 execute
→ finished(success/failed)
→ applyResult
```

#### preview-choice / suggestion 路径

```text
started(via)
→ runChoiceAction(resolvedChoice)
→ finished(success/failed, via)
→ Host 标记输出成功时写 output.applied
```

它们不能重新执行工具，否则会重复计算和产生副作用；也不能省略 run 事件，否则 `output.applied` 会成为孤儿事件。对这两条路径，`run.finished` 表示本次**提交路径**完成，不声称插件自定义 Choice/Action 内部的外部业务目标已经完成。

### 6.6 Host Output Action 私有标记

不根据 Choice ID 识别输出意图。建议在 `output.ts` 内使用模块私有 WeakMap：

```ts
type HostOutputActionNode =
  | LauncherResultChoice
  | LauncherResultAction

const hostOutputIntentByAction =
  new WeakMap<object, OutputIntent>()

function markHostOutputAction<T extends HostOutputActionNode>(
  action: T,
  intent: OutputIntent,
): T {
  hostOutputIntentByAction.set(action, intent)
  return action
}

export function getHostOutputIntent(
  action: HostOutputActionNode,
): OutputIntent | null {
  return hostOutputIntentByAction.get(action) ?? null
}
```

Host 构造输出时标记：

```ts
const copyChoice = markHostOutputAction({
  id: 'launcher.text-output',
  title: text,
  primaryAction: async () => api.copyText(text),
}, 'copy')

const insertAction = markHostOutputAction({
  id: 'insert',
  title: palette(locale, 'insert'),
  run: async () => api.insertText(text),
}, 'insert')
```

规则：

```text
插件自定义 Choice/Action 的 id = 'copy'
→ 无 WeakMap 标记
→ 不产生 output.applied
```

V1 不强制重命名所有既有 Choice ID，避免无必要迁移；可以另加测试禁止 Host 新代码继续使用无命名空间 ID。

### 6.7 OutputIntent

```ts
export type OutputIntent =
  | 'copy'
  | 'replace-active-text'
  | 'insert'
  | 'return-to-launcher'
  | 'open-quick-editor'
```

`output.applied` 的充分条件：

```text
getHostOutputIntent(choiceOrAction) !== null
且
对应 primary/secondary action 成功完成
且
存在有效 CommittedRunContext
```

### 6.8 HostExecutionReceipt

保留该设计，但不作为四周关键路径：

```ts
export type HostExecutionReceipt = {
  output?: {
    intent: OutputIntent
    application: 'implicit'
  }
}
```

它用于未来记录 Editor Surface 内由 `toolAdapter` 自动应用的 replace。因为 adapter 无法区分 Preview 与 Commit，所以 adapter 只返回回执，最终是否写 Journal仍由 Controller 决定。

四周 V1：

```text
只对显式 Host Output Action 建立 Saved Action 和学习事实
隐式 Editor replace 暂不进入候选，也可以暂时没有保存入口
```

### 6.9 契约指纹

在**归一化后的 LauncherItem**上计算，并排除所有展示字段：

```ts
function optionValue(option: LauncherParamOption): string {
  return typeof option === 'string' ? option : option.value
}

export function computeContractFingerprint(
  item: LauncherItem,
): string {
  return hashCanonicalJson({
    systemKey: item.systemKey,
    inputPolicy: item.inputPolicy,
    params: (item.params ?? []).map((param) => ({
      key: param.key,
      type: param.type,
      required: param.required ?? false,
      default: param.default,
      optionValues: (param.options ?? [])
        .map(optionValue)
        .sort(),
      saveable: param.saveable === true,
      saveableMaxLength:
        param.type === 'text' && param.saveable === true
          ? param.saveableMaxLength
          : undefined,
    })),
    policy: item.policy ?? DEFAULT_TOOL_ACTION_POLICY,
  })
}
```

明确排除：

```text
label / labelI18n
description / descriptionI18n
hint / hintI18n
title / aliases / icon
option label / option description
参数展示顺序之外的纯文案变化
```

Saved Action 指纹不一致时禁用，不自动迁移。

---

## 7. Experience Journal V1

### 7.1 与现有日志的分工

```text
Usage Journal
→ frecency 与简单排序

Telemetry / Perf NDJSON
→ 性能诊断

Experience Journal
→ 正式提交、明确输出、Artifact 与候选决策

产品内容存储
→ Clipboard History、Snippets、Quick Editor 历史、Sticky Query 等
```

Experience Journal 是无正文事实源，不是通用用户活动数据库。

### 7.2 单表 Schema

复用现有 Tauri + SQLite 通道，使用单表宽列：

```sql
CREATE TABLE experience_events (
  seq                 INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id            TEXT NOT NULL UNIQUE,
  ts                  INTEGER NOT NULL,
  session_id          TEXT NOT NULL,
  run_id              TEXT,
  event_type          TEXT NOT NULL,

  action_key          TEXT,
  surface_id          TEXT,
  via                 TEXT,
  status              TEXT,
  error_type          TEXT,

  input_binding       TEXT,
  input_fingerprint   TEXT,
  param_signature     TEXT,
  safe_params_json    TEXT,

  output_intent       TEXT,
  output_application  TEXT,

  artifact_id         TEXT,
  candidate_key       TEXT,
  candidate_decision  TEXT
);

CREATE INDEX experience_events_run_idx
  ON experience_events(run_id, seq);

CREATE INDEX experience_events_action_idx
  ON experience_events(action_key, ts);

CREATE INDEX experience_events_candidate_idx
  ON experience_events(candidate_key, ts);
```

约束：

- 不提供任意 `payload JSON` 写入口；
- `safe_params_json` 只能由 Host saveable 参数提取器写入；
- 使用 SQLite `user_version` 迁移；
- 默认按 `ts` 删除过期事件。

### 7.3 事件目录

V1 有七类事件：

```text
run.started
run.finished
output.applied
artifact.saved
artifact.invoked
candidate.surfaced
candidate.dismissed
```

#### `run.started`

用户正式提交动作。Preview/Suggest 的计算不写；Preview/Suggestion 的 Enter 提交会写。

#### `run.finished`

```ts
status:
  | 'success'
  | 'failed'
  | 'cancelled'

errorType?:
  | 'permission-denied'
  | 'timeout'
  | 'validation'
  | 'provider-failed'
  | 'output-failed'
  | 'cancelled'
  | 'unknown'
```

不记录 raw `error.message`。

#### `output.applied`

只在 Host 标记输出 Choice 或 secondary Action 成功完成时写入：

```ts
outputIntent
outputApplication: 'explicit'
```

四周 V1 不写 implicit。

#### `artifact.saved`

用户明确保存 Saved Action。

#### `artifact.invoked`

Saved Action 被正式提交运行。

#### `candidate.surfaced`

候选实际展示给用户。用于统计曝光分母。

#### `candidate.dismissed`

```ts
candidateDecision:
  | 'ignore-once'
  | 'suppress-cluster'
  | 'disable-action-learning'
```

### 7.4 正式提交事件规则

必须覆盖以下测试矩阵：

| 路径 | started | finished | 是否重新 execute |
|---|---:|---:|---:|
| direct perform | 1 | 1 | 是 |
| submit params | 1 | 1 | 是 |
| submit raw input | 1 | 1 | 是 |
| submit matching preview choice | 1 | 1 | 否 |
| submit highlighted suggestion | 1 | 1 | 否 |
| Saved Action invoke | 1 | 1 | 调原动作一次 |
| preview typing | 0 | 0 | 可预计算 |
| suggestion refresh | 0 | 0 | 可查询 |
| param browse/cancel | 0 | 0 | 否 |

不允许出现：

```text
output.applied 存在，但同一 runId 没有 started/finished
同一次 Enter 产生两对 started/finished
Preview 每次击键产生 run
```

### 7.5 Saveable Params 提取

```ts
type SaveableParamsResult =
  | {
      ok: true
      params: Record<string, SaveableParamValue>
    }
  | {
      ok: false
      blockedKeys: string[]
      reason: 'unsaveable-non-default' | 'invalid-saveable-value'
    }

function extractSaveableParams(
  item: LauncherItem,
  params: Record<string, unknown>,
): SaveableParamsResult {
  // 只提取 param.saveable === true
  // text 校验 maxLength
  // select 校验当前值属于 option value
  // 非 saveable 参数若偏离默认值则整体阻断
  // 不认识的值拒绝，不序列化
}
```

第 3 周用于手动 Saved Action，只保留在内存和 Artifact 中。

第 4 周才开始把 canonical 值写入 `safe_params_json`，供 Miner 分组。

### 7.6 Input Fingerprint

第 4 周引入，仅用于 distinct-input 去重：

```text
HMAC-SHA256(
  installationSecret,
  normalizedInputShape + '\0' + rawInput
)
```

规则：

- 不跨安装关联；
- Secret-like 输入不生成；
- 不保存原文；
- 不用于恢复内容；
- 手动 Saved Action 不依赖 fingerprint。

### 7.7 参数签名

```text
param_signature = HMAC(canonical safe_params_json)
```

只包含 `saveable:true` 参数，不含默认外的未知参数和正文。

### 7.8 保留与用户控制

V1 提供 Launcher 命令：

```text
导出学习事件
清除今天的学习事件
清除全部学习事件
暂停个性化学习
```

默认保留 30 天。Saved Action Artifact 不随事件清理删除。

---

## 8. PR0：数据卫生与可验证边界

### 8.1 已确认泄漏点

公开主分支至少有：

1. `queryPreview`：查询前缀进入 always-on NDJSON；
2. raw `error.message`：可能含路径、输入或远端响应；
3. `choice.titlePreview`：文本结果正文直接成为 Choice title，消费时结果前缀可能进入日志。

第三项优先级最高。[C2][C6][C8]

### 8.2 修复原则

允许：

```text
queryLength / queryEmpty / queryShape
actionKey / surfaceId / via
choice origin（host-output / plugin-custom）
outputIntent
errorType / errorCode
durationMs
```

禁止：

```text
queryPreview
choice.title
动态 item title
raw error.message
URL / path / window title
输入与输出正文
```

### 8.3 No-content 测试必须有显式存储清单

不能全盘扫描用户目录，因为以下产品存储**合法包含内容**：

```text
Clipboard History
Snippets
Quick Editor 版本历史
Sticky Query Draft
插件私有正文资产
```

也不能只扫描三四个已知文件，否则新日志或持久化路径可能漏检。

建议维护代码化清单：

```ts
export const CONTENT_SOURCE_STORES = [
  'clipboard-history',
  'snippets',
  'quick-editor-history',
  'sticky-query-draft',
] as const

export const NO_CONTENT_SINKS = [
  'launcher-perf.ndjson',
  'usage-journal',
  'experience-events',
  'saved-action-artifacts',
] as const
```

测试方法：

```text
1. 在合法产品 Source 中放入唯一 canary
2. 执行 Launcher、Preview、Suggestion、Output、Saved Action 等路径
3. 只扫描显式维护的 NO_CONTENT_SINKS
4. canary 出现在任一 Sink → 失败
5. 新增持久化 Sink 未加入清单 → 架构测试失败
```

说明：Saved Action 可以保存明确 `saveable:true` 的参数，因此测试需分别使用：

- 输入/输出正文 canary：绝不允许出现；
- saveable 参数 canary：只允许出现在对应 Artifact 字段，不允许扩散到 telemetry；
- 非 saveable 参数 canary：所有 Sink 均不得出现。

---

## 9. 手动 Saved Action V1

### 9.1 产品价值

手动 Saved Action 不依赖行为样本，而且会产生未来学习所需的稳定事实：

```text
用户明确认为这次配置值得保存
→ 创建 Artifact
→ 后续是否再次调用
→ 是否跨日复用
```

### 9.2 Artifact Schema

```ts
export type SavedActionV1 = {
  schemaVersion: 1

  id: string
  name: string
  aliases: string[]

  baseActionKey: string
  savedParams: Record<string, SaveableParamValue>

  inputBinding:
    | 'selection'
    | 'active-text'
    | 'prompt'

  outputIntent: OutputIntent
  contractFingerprint: string

  createdAt: number
  lastInvokedAt?: number

  disabledReason?:
    | 'missing-action'
    | 'contract-changed'
    | 'input-unavailable'
    | 'output-unavailable'
}
```

不保存：

```text
上一次输入或输出
prompt 正文
选区正文
自由文本参数（除非逐参数 saveable opt-in）
文件内容、URL、路径、token、cookie
```

### 9.3 LastSaveableRun

每次显式 Host 输出成功后，只有 `run.saveSnapshot` 存在才在内存更新；该快照由第 3 周的 `extractSaveableParams()` 与契约指纹逻辑生成：

```ts
export type LastSaveableRun = {
  runId: string
  actionKey: string
  savedParams: Record<string, SaveableParamValue>
  inputBinding: InputBinding
  outputIntent: OutputIntent
  contractFingerprint: string
  completedAt: number
}

// 来源：CommittedRunContext.saveSnapshot + 本次 Host OutputIntent
```

约束：

```text
不含输入/输出正文
仅内存
应用退出后消失
建议 30 分钟 TTL
新一次可保存运行覆盖旧值
```

### 9.4 主保存入口

增加 Host Launcher 命令：

```text
把上一次运行保存为工具
```

它只有在 `LastSaveableRun` 有效时可用。若某个非 saveable 参数偏离默认值，则命令置灰并解释“该参数尚不允许固化”，而不是保存一个不完整动作。

可用时展示：

```text
动作名
已保存参数摘要
输入绑定
输出意图
完成时间
```

用户随后输入名称和别名。

这是 V1 主入口，因为 Global Launcher 的文本结果通常按 Enter 即复制并关闭，Result Frame 很可能来不及提供保存按钮。[C6]

可选补充入口：

- Result Frame 次级动作；
- 低干扰 Toast 按钮。

它们不能成为唯一入口。

### 9.5 Saved Action 仍走现有单轨

Saved Action 投影为 Host LauncherItem：

```text
host:saved-action:<artifactId>
```

运行：

```text
1. 查找 baseActionKey 对应的当前 LauncherItem
2. 比较 contractFingerprint
3. 检查 inputBinding
4. 将 savedParams 注入原参数流
5. 通过 Commit Gate 正式提交一次原动作
6. 对原结果执行保存的 Host OutputIntent
7. 写 artifact.invoked
```

不直接调用插件私有函数，不建立旁路 Runner。

### 9.6 兼容性

| 情况 | 行为 |
|---|---|
| 原动作不存在 | 置灰，允许删除 Artifact |
| 指纹变化 | 禁用，进入原工具重新配置 |
| 选区或活动文本缺失 | 置灰并解释 |
| prompt binding | 正常进入 collect-input，不复用旧正文 |
| 输出在当前 Surface 不可用 | 禁用或要求重新选择输出 |
| 参数不再 saveable | 禁用，不静默丢弃参数 |

---

## 10. 自动学习 V1：只挖掘有信息增量的单动作

### 10.1 默认动作不产生候选

以下路径不需要 Learning Inbox：

```text
默认参数
+
该 Surface 默认输出
```

frecency 已经能够把常用动作排到前面。

至少一项成立才进入候选：

```text
savedParams 与默认参数不同
或
outputIntent 与 Surface 默认值不同
```

### 10.2 候选分组键

```text
actionKey
+ canonical savedParams
+ inputBinding
+ outputIntent
```

### 10.3 初始门槛

```text
至少 4 次 explicit output.applied
至少 3 个不同 inputFingerprint
至少跨 2 个自然日
对应 run.finished 全部 success
不存在同配置 Saved Action
不是默认参数 + 默认输出
```

### 10.4 明确排除

```text
Preview/Suggest 计算
implicit Editor 输出
插件自定义 Choice/Action
确认/取消 Choice/Action
仅 run.finished 而无 output.applied
Secret-like 输入
包含未 opt-in 参数的配置
local-write / external-write / destructive
随机数、当前时间等 learnable=false 动作
```

### 10.5 候选曝光与忽略率

每次候选在一个 Learning Inbox / Launcher session 中首次真正进入可见列表时写：

```text
candidate.surfaced(candidateKey)
```

同一候选因 React rerender、滚动回收或列表刷新重复出现时不得重复计数；建议按 `sessionId + candidateKey` 在 UI 层去重。

用户操作时写：

```text
candidate.dismissed(ignore-once)
candidate.dismissed(suppress-cluster)
artifact.saved（候选转化）
```

由此才能计算：

```text
曝光次数
保存次数
忽略次数
永久抑制次数
```

不能再用“候选主要被忽略”这种没有分母的停止条件。

### 10.6 Learning Inbox

```text
可能值得保存

按 “, ” 连接多行
输入：当前选区
输出：复制

过去 14 天：
5 次明确采用
4 个不同输入
跨 3 天

[保存为工具] [忽略] [不再建议]
```

V1 不使用模型命名；保存时由用户命名。

---

## 11. 四周实施计划

### 第 1 周：PR0 — 数据卫生与契约元数据

#### 交付

- 删除 `queryPreview`、Choice/Action 正文预览和持久 raw `error.message`；
- 建立 `CONTENT_SOURCE_STORES / NO_CONTENT_SINKS` 清单；
- 增加 `ToolActionPolicy { effect, learnable }`；
- 增加 `LauncherParamSpec.saveable / saveableMaxLength`；
- 给约 10 个 first-party 动作分类；
- 给 line-tools 的少量低敏感 text 参数 opt-in；
- 增加 policy/saveable/fingerprint Contract Test。

#### 验收

```text
学习/遥测 Sink 正文泄漏 = 0
Legacy 工具 learnable = false
saveable text 无长度上限 → 构建失败
切换语言或修改 label → 契约指纹不变
修改 option value / type / default → 契约指纹变化
```

### 第 2 周：PR1 — Commit Gate 与最小 Journal

#### 交付

- Controller 统一 Commit Gate；
- 覆盖 execute、preview-choice、suggestion、Saved Action 提交形态；
- `run.started / run.finished / output.applied`；
- Host Output Action WeakMap 标记；
- `error_type`；
- 新建 Experience SQLite 表；
- 导出、清除、暂停命令。

明确推迟：

```text
inputFingerprint
paramSignature
safe_params_json 持久化
implicit HostExecutionReceipt
候选挖掘
```

#### 验收

```text
Preview 输入 100 次 → 0 对 run
Suggestion 刷新 100 次 → 0 对 run
普通正式执行 → 恰好 1 对
Preview Choice Enter → 恰好 1 对，不重新 execute
Suggestion Enter → 恰好 1 对，不产生孤儿 output.applied
插件自定义 id='copy' → 不产生 output.applied
Host copy Choice → 产生 1 个 output.applied
失败事件有 error_type，无 raw message
```

### 第 3 周：PR2 — 手动 Saved Action

#### 交付

- Saveable params 提取器；
- `LastSaveableRun` 内存存储；
- “把上一次运行保存为工具”命令；
- SavedAction Store；
- 命名、别名、删除；
- Launcher 投影；
- 契约指纹检查；
- `artifact.saved / artifact.invoked`。

#### 验收

```text
执行 line join(separator=', ')
→ copy
→ Launcher 已关闭
→ 再呼出并执行“保存上一次运行”
→ 命名
→ 重启应用
→ 对新选区成功复用

旧输入/输出正文不进入 Artifact
非 saveable text 参数不能保存
契约文案/i18n 改动不禁用
参数 value/default 变化会禁用
```

### 第 4 周：PR3 — 非默认候选

#### 交付

- HMAC input fingerprint；
- canonical `safe_params_json` 与 param signature；
- 默认签名比较；
- 候选分组、阈值和 Fixture 回放；
- `candidate.surfaced / candidate.dismissed`；
- 证据卡和永久抑制。

#### 验收

```text
默认 JSON format 20 次 → 无候选
非默认 join separator 跨日、跨输入重复 → 1 个候选
Preview 100 次 → 候选计数不变
候选展示 5 次、忽略 4 次 → 分母和忽略率可计算
已有相同 Saved Action → 不重复提示
```

---

## 12. 建议的逐文件改动

### 修改现有文件

```text
src/workspace/pluginTypes.ts / launcher/types.ts
  + ToolActionPolicy
  + LauncherParamSpec.saveable
  + LauncherParamSpec.saveableMaxLength
  + CommittedRunContext / CommitVia

src/workspace/launcher/controller.ts
  + Commit Gate
  + preview-choice / suggestion synthetic run pair
  + ResultFrame run context
  + output.applied only for Host-marked Choice
  - persistent titlePreview / raw error.message

src/workspace/launcher/output.ts
  + Host output WeakMap marker
  + markHostOutputChoice / getHostOutputIntent
  + existing IDs kept for compatibility

src/workspace/launcher/toolAdapter.ts
  + policy / saveable metadata passthrough
  + future optional HostExecutionReceipt
  - direct Journal writes

src/workspace/telemetry/track.ts
  - queryPreview
  - raw error.message
  - dynamic title/choice preview

src-tauri/src/lib.rs
  + Experience Journal commands
  + SQLite user_version migration
```

### 新增模块

```text
src/workspace/experience/types.ts
src/workspace/experience/journal.ts
src/workspace/experience/errorType.ts
src/workspace/experience/storageInventory.ts
src/workspace/experience/fingerprint.ts       # 第 4 周
src/workspace/experience/saveableParams.ts

src/workspace/savedActions/types.ts
src/workspace/savedActions/store.ts
src/workspace/savedActions/provider.ts
src/workspace/savedActions/lastSaveableRun.ts
src/workspace/savedActions/contractFingerprint.ts

src/workspace/learning/singleActionMiner.ts   # 第 4 周
src/workspace/learning/candidateStore.ts
src/workspace/learning/suppressionStore.ts
```

明确不新增：

```text
actionRuntime/actionRegistry.ts
actionRuntime/actionRunner.ts
routines/*
agent/*
```

---

## 13. 测试与质量门

### 13.1 提交语义测试

- direct execute：恰好一对 started/finished；
- submit params：恰好一对；
- submit input：恰好一对；
- matching preview choice：恰好一对，不重新 execute；
- highlighted suggestion：恰好一对；
- Preview/Suggest 计算：零事件；
- 不允许孤儿 `output.applied`；
- 不允许同一次 Enter 双重记录。

### 13.2 Host Output Action 身份测试

- Host 构造的 primary copy Choice：有 output.applied；
- Host 构造的 secondary copy/insert Action：有 output.applied；
- 插件 Choice 或 secondary Action `id='copy'`：无 output.applied；
- 插件 Choice 标题等于结果正文：不写 telemetry；
- Choice/Action 对象若被克隆导致 WeakMap 标记丢失，应 fail closed，不误记采用；
- Host output builder 不得返回未标记的输出 Choice 或 secondary Action。

### 13.3 契约指纹测试

以下变化不改变指纹：

```text
locale
label / labelI18n
description / hint
option label
icon / aliases
```

以下变化必须改变指纹：

```text
systemKey
inputPolicy
param key/type/required/default
option value
saveable policy / text max length
action effect / learnable
```

### 13.4 参数保存测试

- 默认参数不可保存，除非 `saveable:true`；
- saveable text 无 max length → Contract Test 失败；
- text 超长 → 保存失败，不截断；
- select 值不在 options → 保存失败；
- 非 saveable 参数不进入 Artifact 或 Journal；
- 非 saveable 参数偏离默认值时整次保存被阻断；
- line separator `', '` 可以成功保存和复用。

### 13.5 Journal Schema 测试

- failed 必须有 `error_type`；
- candidate 每个 session 首次展示写一次 `candidate.surfaced`，rerender 不重复；
- 忽略或抑制写 `candidate.dismissed`；
- 不接受任意 payload JSON；
- SQLite migration 使用 `user_version`；
- ts 保留策略可删除旧事件。

### 13.6 No-content 测试

- 显式维护 Source/Sink 清单；
- 新增持久 Sink 未登记 → 测试失败；
- 合法产品 Source 中的 canary 不导致误报；
- Source canary 不得扩散到 No-content Sink；
- saveable 参数只允许出现在 Artifact / `safe_params_json` 对应字段；
- 输入、输出、query、error 正文在所有 No-content Sink 中为零。

### 13.7 性能门

```text
Journal 写入 fire-and-forget
候选挖掘离线/空闲执行
Launcher 排名不实时扫描 Experience 表
LastSaveableRun 为纯内存小对象
Saved Action Provider 使用小型索引
```

---

## 14. 风险与缓解

### 风险 1：提交路径漏记

**表现：** Preview Choice 或 Suggestion Enter 产生输出，却没有 run。

**缓解：** 用统一 Commit Gate 覆盖所有正式 Enter 路径；增加孤儿 output 测试。

### 风险 2：Preview 污染执行事实

**缓解：** Provider 和 adapter 不写 Journal；预计算阶段零事件。

### 风险 3：插件 Choice 冒充 Host Output

**缓解：** 认 WeakMap 对象标记，不认 ID 或标题；丢失标记时 fail closed。

### 风险 4：契约指纹因文案变化大面积失效

**缓解：** 只 hash 行为字段和 option value，所有展示字段排除。

### 风险 5：参数策略过严导致 Saved Action 无用

**缓解：** 逐参数 opt-in，允许有长度上限的低敏感 text 参数；默认仍不可保存。

### 风险 6：LastSaveableRun 过期或指错动作

**缓解：** 短 TTL、显示时间和动作摘要、新运行覆盖旧值、保存前重新检查指纹。

### 风险 7：候选忽略率无法计算

**缓解：** 每次真正渲染写 `candidate.surfaced`，保存/忽略/抑制均有事件。

### 风险 8：No-content 测试变成假红或假绿

**缓解：** 区分合法 Content Source 与禁止 Content Sink；清单本身进入架构质量门。

### 风险 9：单人数据仍不足

**缓解：** 手动 Saved Action 是独立价值；自动候选为空时不降阈值，不加 Agent。

### 风险 10：执行成功被误称为工作成功

**缓解：** V1 只声称动作执行成功和明确 Host 输出应用，不推断外部任务完成。

---

## 15. 四周后的决策门

### 15.1 继续 Saved Action 的条件

```text
用户主动保存了动作
Saved Action 被跨日再次调用
至少部分动作明确减少步骤
契约漂移和输入缺失能被可靠解释
正文泄漏为 0
```

### 15.2 继续自动学习的条件

```text
出现自然的非默认重复配置
candidate.surfaced 有足够曝光
候选保存率明显高于忽略/抑制率
候选没有被 Preview 或隐式输出污染
至少一个候选转化后被跨日复用
```

建议报告原始计数，而不是低样本百分比：

```text
展示 N 次
保存 N 次
忽略 N 次
永久抑制 N 次
保存后复用 N 次
```

### 15.3 停止自动挖掘的条件

出现任一项即冻结 Miner：

```text
手动 Saved Action 也很少使用
直接搜索原工具同样快
三周没有非默认重复配置
候选曝光后主要被忽略或抑制
候选保存后不再运行
数据卫生无法做到正文泄漏为 0
```

保留：

```text
Launcher
插件工具
frecency
正式执行回执
手动 Saved Action
```

冻结：

```text
Habit Compiler
Routine
Distiller
Agent
```

### 15.4 Routine 重新立项条件

```text
至少 3 条 Saved Action 被跨日高频复用
用户自然重复两步以上的数据流
Closure Result 无法表达步骤输出绑定
出现第二个非 Launcher Consumer
```

届时才评估 Canonical Result、Action Runner seam 和线性 Routine。

### 15.5 Agent 重新立项条件

固定 Playbook 已被真实使用，但开放目标仍无法由稳定步骤覆盖；同时已经有白名单、可审计、可取消的工具协议。否则不引入 Agent。

---

## 16. 最终产品叙事

V1 不应宣称“hiven 已经会观察并自动学习你的全部工作”。准确表述是：

> **hiven 能把一次明确成功、被你采用的操作保存成自己的工具；当某个非默认配置在不同日期和不同输入上反复出现时，它会用可检查的证据询问你是否值得保存。**

它不做：

```text
不监控整个桌面
不把 Preview 当执行
不依赖裸 Choice ID 猜语义
不偷存输入和输出正文
不自动编排外部副作用
不把默认高频动作包装成“AI 学会了”
```

最小循环：

```text
正式提交
→ 明确 Host 输出
→ 保存上一次运行
→ 跨日复用
→ 非默认重复被发现
→ 用户决定是否沉淀
```

---

## 17. 本轮 Fable5 评审处理结果

| 评审发现 | 处理 |
|---|---|
| `submitInput` 两条快速提交绕过 `runAndHandle` | 采纳：统一 Commit Gate，并为 preview-choice/suggestion 合成 run pair |
| 裸 `copy/insert` ID 会与插件 Choice 冲突 | 采纳：Host 私有 WeakMap 标记，不按 ID 分类 |
| 指纹包含 label/i18n 会易碎 | 采纳：只 hash 行为字段与 option value |
| text 参数一刀切会使 line-tools Saved Action 失去价值 | 采纳：逐参数 `saveable:true` + text max length |
| Journal 缺 `error_type` | 采纳：新增列和受控枚举 |
| 缺 `candidate.surfaced`，忽略率无分母 | 采纳：新增事件和 candidate_key |
| `replay` 字段无独立价值 | 采纳：从 V1 policy 删除 |
| 保留 HostExecutionReceipt | 采纳设计，但推迟到四周关键路径之外 |
| inputBinding 收缩 | 采纳：只保留 selection/active-text/prompt |
| 保存入口应以“保存上一次运行”为主 | 采纳：内存 LastSaveableRun + Launcher 命令 |
| 第 2 周过重 | 采纳：fingerprint 数据与 Miner 所需参数持久化移到第 4 周 |
| No-content 全盘扫描或少量路径扫描都不可靠 | 采纳：维护 Content Source / No-content Sink 清单 |

---

## 18. 参考资料

### 内部方向报告

- [R1] `personal-ai-os-direction.md`：个人 AI 操作系统方向；主线、能力梯度、当前基线与停止条件。
- [R2] `personal-workbench-future-directions.md`：个人工作台未来方向全景；D21 Saved Actions、D22 Habit Compiler、D29/D30 和 Host/Plugin 边界。

### hiven 公开主分支代码

- [C1] `src/workspace/launcher/registry.ts`
- [C2] `src/workspace/launcher/controller.ts`
- [C3] `src/workspace/launcher/toolAdapter.ts`
- [C4] `src/workspace/usageJournal.ts`
- [C5] `src-tauri/src/lib.rs`
- [C6] `src/workspace/launcher/output.ts`
- [C7] `src/workflow/pipeline.ts`
- [C8] `src/workspace/telemetry/track.ts` 与 `events.ts`
- [C9] `src/workspace/pluginTypes.ts`
- [C10] `src/workspace/pluginRegistry.ts`
- [C11] `src/workspace/pluginBackgroundManager.ts`

### 参考架构

- Pi：最小核心、扩展事件、工具注册、会话自定义状态和可信扩展模型。
- DeepSeek Harness：Capability Seam、Service Definition / Provider / Consumer、effect 生命周期和 append-only typed event log。

采用其原则，不复制完整 Agent Loop 或运行时。

---

## 19. 一句话收束

> **先不要建设“会学习一切”的新运行时；先让现有 Launcher 单轨在每一种正式提交路径上都能可靠回答：执行了什么、是否成功、哪个 Host 输出真的被应用、这次配置是否被用户保存并再次复用。**
