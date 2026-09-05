# hiven 自学习个人工具系统

**背景、架构设计与落地方案（评审稿）**

- 面向：Fable5 / 架构评审
- 版本：0.9
- 日期：2026-08-25
- 状态：设计提案，不代表现有产品边界已经变更

> 核心主张：hiven 不应先变成一个持续监控桌面的通用 Agent，而应先把插件能力标准化，把每次执行变成可审计事实，再把真实、跨时间、被采用的成功路径编译成用户确认的个人工具。

<!-- pagebreak -->

## 0. 执行摘要

hiven 当前已经能识别文本形态、推荐命令、运行插件工具并把结果返回给用户。继续增加更多识别规则或单点插件，会获得局部收益，但不能解决两个结构性问题：第一，每个新场景都容易演变为一个独立插件和独立状态机；第二，系统没有统一证据判断“用户做过什么、结果是否被采用、哪些步骤值得沉淀”。

本设计建议采用以下决策：

1. **不删除插件机制。** 产品上可以是一体化的，代码上仍保留插件化；近期只发布 first-party bundle，暂缓插件市场与第三方稳定 SDK。
2. **把 Feature Plugin 升级为 Capability Provider。** 插件不再只是暴露回调，而要声明稳定动作 ID、版本、输入、参数、输出、副作用、重放和敏感度。
3. **建立统一 Action Runtime。** Launcher、Saved Action、Routine、Learner 和未来 Agent 都通过同一运行时调用能力；权限、确认、取消、超时、runId、结果与回执由 Host 统一。
4. **建立独立的 Experience Journal。** 默认只记录 hiven 内部的结构化行为，不记录正文；它与产品 telemetry、frecency Usage Journal、长期记忆和插件私有状态分离。
5. **先做无模型学习。** 重复动作、固定参数、连续数据流和上下文排序可以用统计与序列挖掘完成；模型仅作为可选 Distiller，负责命名、解释和变量建议。
6. **Agent 最后接入。** Agent 是 Action Runtime 的一个 Consumer，只在开放目标无法由 Saved Action、Routine 或领域 Playbook 覆盖时启用。

建议的首个可落地范围不是“完整自学习系统”，而是：

```text
Action Contract V1
→ 统一 run.started / run.finished / result.consumed
→ 本地 Experience Journal 与审计页
→ 单动作重复候选 Learning Inbox
→ 用户确认后生成 Saved Action
```

在此闭环稳定之前，不做全天屏幕/键盘/录音捕获，不做自动外部写入，不做通用 Agent Loop。

### 本文需要 Fable5 重点评审的内容

- Action Runtime 的边界是否足够中性，是否仍把过多产品语义放进 Host；
- Canonical Result 与现有 Launcher closure result 的迁移方式是否合理；
- Experience Journal 的事件与隐私模型是否足以支持学习；
- Routine V1 是否过早，能否再缩小；
- 是否需要借用 Cordis/DSH 运行时，还是只借原则自行实现；
- 能否提出一个更小、四周内可验证的替代方案。

## 1. 背景与问题定义

### 1.1 产品方向的来源结论

两份内部报告给出的共同主线是：hiven 不应扩成通用 Agent/RPA，而应成为本地优先的个人上下文路由工作台，从当前对象出发，把正确动作送到正确去处，并把被真实重复证明的成功路径沉淀为个人工具。[R1][R2]

```text
当前对象
→ 正确动作
→ 正确去处
→ 执行回执
→ 重复证据
→ 个人工具
```

报告同时明确了升级顺序：

```text
单动作预设
→ 纯文本 pipeline
→ 领域 Playbook
→ 有界 Agent
```

规则能解决的不用模型，单动作能解决的不用流程，领域 Playbook 能解决的不用开放 Agent。[R1]

### 1.2 当前 hiven 不是从零开始

从公开主分支与报告可以确认，hiven 已经具备：

- Launcher Registry、动态 provider、参数、choices、稳定 `systemKey`、usage/frecency；
- Object Block、内容检测、编辑器选区、双 pane、剪贴板历史、工具结果对象；
- 插件 tools、Launcher items、surface、settings、private storage、background/hooks；
- Clipboard、network、shell、paste、DesktopTarget 等能力；
- 纯文本线性 pipeline；
- 插件启停、后台 stop/restart 和部分贡献清理；
- 现有行为与性能 telemetry。[R2][R3]

因此，近期无需重建第二套命令系统，也无需先引入完整 Agent 框架。

### 1.3 为什么现有能力仍不足以“自学习”

当前问题不在于缺少更多内容识别，而在于系统缺少统一、可验证的动作事实。

#### 问题 A：插件工具主要是回调，不是完整能力契约

当前 `PluginToolContribution` 可以声明标题、参数、输入策略、匹配规则和执行函数，再由 `toolAdapter.ts` 转为 `LauncherItem`。Host 可以运行它，却通常不知道它是否纯、能否安全重放、是否会写外部系统、输出结构是什么、哪些参数可进入学习。[R3]

#### 问题 B：Usage Journal 记录“选过”，不等于“成功且被采用”

公开主分支的 Usage Journal 只记录 command、surface、时间、前序 command 和可选 object kind。Controller 在执行前记录选择；执行失败、结果未使用和立即撤销都无法被完整区分。[R3]

学习需要至少分清三层成功：

| 层级 | 定义 | 是否足够用于学习 |
|---|---|---|
| 执行成功 | 工具正常返回，没有权限或运行错误 | 不足，只说明程序跑完 |
| 使用成功 | 用户复制、粘贴、选用、回流、再次运行，且未立即撤销 | 可作为纯动作的弱证据 |
| 结果成功 | 外部任务真实完成，或来源插件/用户明确确认 | 只有领域插件或用户能够声明 |

#### 问题 C：结果行为以 closure 表示，不容易序列化和重放

Launcher 的结果 choice 当前经常直接捕获 `copyText()`、`replaceActiveText()`、`returnToLauncher()` 等闭包。UI 使用很方便，但日志只能知道“某个 choice 被调用”，难以稳定表示“run A 的 text result 被 copy，或成为 run B 的输入”。[R3]

#### 问题 D：Text Pipeline 与插件动作不是同一运行时

现有 pipeline 是纯函数数组，并不按稳定插件 action ID 调用工具。它适合 demo 和同步文本链，但不能自然组合来自不同插件的能力，也无法直接复用插件权限、版本、结果和回执协议。[R3]

#### 问题 E：报告分支与公开 main 的数据边界需要先对齐

报告描述的实验分支已经把新学习埋点收紧为 shape-only；但公开主分支的 telemetry helper 仍可见 `queryPreview`、`titlePreview` 和原始错误 message 等字段。[R1][R3]

在建设 Experience Journal 前，必须先统一事实源和隐私字段，否则会形成“新系统不记正文、旧系统仍写 preview”的矛盾。

## 2. Pi 与 DSH 的参考价值

### 2.1 Pi：极小核心，扩展拥有工作方式

Pi 的扩展可以注册模型工具、命令、UI、事件拦截和会话自定义状态；其 session 使用 JSONL，扩展状态可以持久化且不必进入模型上下文。[R4]

值得借鉴：

- 核心只提供少数稳定原语；
- 扩展可以观察统一生命周期；
- 扩展状态与模型上下文分离；
- 用户不必等待核心实现每一种工作方式。

不应照搬：

- Pi 扩展属于可信代码模型，拥有完整系统权限；
- hiven 涉及剪贴板、浏览器、飞书、窗口、网络和后台观察，必须保留能力授权和风险分级。

### 2.2 DSH：Capability Seam、生命周期和事件事实

DSH 将可替换能力拆为三个角色：[R5]

```text
Service Definition：能力契约是什么
Service Provider：能力如何实现
Consumer：谁使用这项能力
```

DSH 还强调：

- Provider 和 Consumer 只在确实需要独立演进时拆包，不预防性过度拆分；
- 注册、事件、服务和长生命周期资源都有明确 disposer；
- Session 使用 append-only typed event log，其他状态由事件推导；
- 工具参数先校验，执行返回 canonical value，结果渲染是另一层；
- 观察者可以统一监听所有工具调用与结果。[R5]

### 2.3 hiven 应采用的混合方案

| 参考 | 采用 | 不采用 |
|---|---|---|
| Pi | 小核心、扩展事件、会话外状态、可替换模型能力 | 完全可信扩展、Agent-first 产品形态 |
| DSH | Definition / Provider / Consumer、effect 生命周期、事件事实、canonical tool result | 立即引入完整 Cordis Fiber、完整 Agent Loop、全包拆分 |
| hiven 自身 | Object Block、Launcher、Quick Editor、插件 surface、权限与本地优先 | 把所有领域语义吸入 Host |

本设计可概括为：

> **Pi 式产品边缘 + DSH 式能力内核 + hiven 自己的对象化 Launcher。**

## 3. 架构决策

### 3.1 ADR 总览

| 决策 | 结论 | 直接后果 |
|---|---|---|
| ADR-01 插件去留 | 保留内部插件化，暂停开放生态 | first-party 与 Host 同步发布，但仍通过能力协议接入 |
| ADR-02 能力模型 | 插件升级为 Capability Provider | Learner 和 Agent 不再依赖插件私有回调 |
| ADR-03 执行入口 | 所有能力统一经过 Action Runtime | runId、权限、取消、状态、结果和事件可统一 |
| ADR-04 行为事实 | 新建 Experience Journal | 与 telemetry、usage、memory、plugin state 分离 |
| ADR-05 学习权限 | Learner 只提候选，不直接执行或修改 | 用户通过 Learning Inbox 授权沉淀 |
| ADR-06 Agent 位置 | Agent 是可选 Consumer | 关闭 Agent 不影响 Launcher、Saved Action 和 Routine |

### 3.2 为什么不删除插件机制

删除插件并不会消除对以下协议的需要：

```text
稳定动作 ID
输入与参数
输出结构
副作用等级
权限
版本兼容
重放与验证
生命周期
```

把 JSON、飞书、浏览器、Diff 和 Shell 全部迁入 Host，只会把插件孤岛变成 Host 巨石，并让 Launcher、Learner 和 Agent 依赖领域实现。

建议采用三层信任：

| 层 | 定位 | 近期策略 |
|---|---|---|
| Kernel Service | 高权限、中性、稳定 | Host 维护 |
| First-party Bundle | 随产品发布、可信、内部 seam | 当前主力；产品 UI 不必强调“插件” |
| External Extension | 未来第三方 | 暂缓市场；未来考虑 worker/subprocess/sandbox |

### 3.3 目标架构图

![hiven Experience Kernel 架构](/tmp/hiven_doc_work/architecture.png)

## 4. 核心技术设计

### 4.1 Action Definition V1

第一版不必建设完整通用 JSON Schema 平台，可以复用现有参数定义并补齐行为政策。

```ts
export type ActionEffect =
  | 'pure'
  | 'read'
  | 'local-write'
  | 'external-write'
  | 'destructive'
  | 'unknown'

export type ReplayPolicy = 'safe' | 'verify' | 'never'
export type ActionSensitivity = 'public' | 'private' | 'secret'

export interface ActionDefinitionV1 {
  key: string
  version: string
  title: string
  description?: string

  input: {
    kinds: string[]
    min: number
    max: number
  }

  params: LauncherParamSpec[]

  output: {
    kinds: string[]
  }

  policy: {
    effect: ActionEffect
    replay: ReplayPolicy
    sensitivity: ActionSensitivity
    learnable: boolean
    routineVisible: boolean
    agentVisible: boolean
  }
}

export interface ActionProvider {
  definition: ActionDefinitionV1
  execute(
    context: ActionExecutionContext,
    input: ActionInput,
    params: Record<string, unknown>,
  ): Promise<ActionRunResult>
}
```

### 4.2 旧插件兼容策略

现有工具不应一次性重写。Legacy Adapter 使用最保守默认值：

```ts
policy: {
  effect: 'unknown',
  replay: 'never',
  sensitivity: 'private',
  learnable: false,
  routineVisible: false,
  agentVisible: false,
}
```

只有显式完成分类的 first-party Action 才能进入 Learner、Routine 或 Agent。

第一批建议分类的动作：

| Action | effect | replay | learnable | agentVisible |
|---|---|---|---:|---:|
| `json.format` | pure | safe | 是 | 是 |
| `json.minify` | pure | safe | 是 | 是 |
| `base64.decode` | pure | safe | 是 | 是 |
| `text.trim` | pure | safe | 是 | 是 |
| `line.dedupe` | pure | safe | 是 | 是 |
| `url.extract` | pure | safe | 是 | 是 |
| `feishu.search-docs` | read | verify | 暂否 | 可选 |
| `web.open` | read/navigation | verify | 仅排序 | 可选 |
| `feishu.send-message` | external-write | never | 否 | 默认否 |
| `shell.run` | unknown/destructive | never | 否 | 默认否 |

### 4.3 Canonical Result 与 Output Presenter

新协议中，Provider 返回可序列化的规范结果，UI 操作由 Presenter 生成。

```ts
export type ActionValue =
  | { kind: 'text'; text: string; contentType?: string }
  | { kind: 'object-ref'; source: string; stableId: string; title: string }
  | { kind: 'choices'; items: ActionChoiceValue[] }
  | { kind: 'none' }

export interface ActionRunResult {
  status: 'success' | 'partial' | 'failed' | 'cancelled'
  value?: ActionValue
  error?: { type: string; code?: string }
  domainReceiptRef?: string
}
```

Host 再把 text value 表现为：

```text
复制
替换当前编辑器文本
插入
返回 Launcher 继续处理
打开 Quick Editor
```

这些 Output Intent 也必须可序列化：

```ts
export type OutputIntent =
  | { kind: 'copy' }
  | { kind: 'replace-active-text' }
  | { kind: 'insert' }
  | { kind: 'return-to-launcher' }
  | { kind: 'open-quick-editor' }
```

迁移期允许两条路径并存：

- 旧 `LauncherExecuteResult` 标记为 opaque，不进入学习和 Routine；
- 新 Action 返回 canonical value，由 Host 生成结果 UI。

### 4.4 Action Runner 与统一执行生命周期

```text
resolve action
→ validate input and params
→ evaluate permission and confirmation
→ append run.started
→ provider.execute
→ normalize canonical result
→ append run.finished
→ present result
→ user chooses output intent
→ append result.consumed / result.dismissed / feedback.undone
```

建议状态：

```ts
export type RunStatus =
  | 'success'
  | 'partial'
  | 'rejected'
  | 'permission-denied'
  | 'timeout'
  | 'failed'
  | 'cancelled'
  | 'unknown'
```

`runId` 在 Controller 选择动作时生成，并贯穿参数、provider、结果 frame 和 output intent。连续步骤通过 `parentRunId` 或明确的数据指纹关联，而不是只靠时间相邻猜测。

### 4.5 Experience Journal

Experience Journal 专门用于本机个性化学习，不替代现有 telemetry 或 frecency。

```ts
export interface ExperienceEventEnvelope {
  seq: number
  eventId: string
  timestamp: number
  sessionId: string
  runId?: string
  parentRunId?: string
  type: string

  actionKey?: string
  actionVersion?: string
  inputShape?: string
  inputFingerprint?: string
  paramSignature?: string
  outputShape?: string
  outputFingerprint?: string
  outputTarget?: string
  status?: string

  payload?: Record<string, JsonValue>
}
```

建议事件词汇：

```text
session.opened
run.started
run.finished
result.consumed
result.dismissed
feedback.undone
artifact.saved
artifact.invoked
candidate.dismissed
learning.paused
```

默认禁止进入 Journal：

- clipboard、query、editor、chat、file 的正文；
- 生成结果正文；
- 窗口标题和完整路径；
- URL query；
- 完整 shell command；
- token、cookie、secret；
- 原始错误 message。

允许记录：

- 稳定 action ID 与版本；
- 输入输出 shape；
- 经 allowlist 的参数签名；
- 本机 HMAC fingerprint；
- run 状态、耗时区间、output intent；
- 复用、撤销、忽略和抑制。

Experience Journal 应使用独立 SQLite 表，并提供本地查看器、暂停、按时间/插件清除和无正文导出。

### 4.6 Artifact Registry

学习的产物不是隐藏规则，而是显式 Artifact。

#### Saved Action

```ts
export interface SavedActionArtifactV1 {
  version: 1
  id: string
  name: string
  aliases: string[]

  action: {
    key: string
    versionRange: string
  }

  fixedParams: Record<string, JsonValue>
  inputPolicy: 'manual' | 'selection' | 'active-editor' | 'clipboard'
  outputIntent: OutputIntent

  createdBy: 'user' | 'learner' | 'model'
  status: 'enabled' | 'disabled'
  disabledReason?: string
}
```

#### Routine

```ts
export interface RoutineArtifactV1 {
  version: 1
  id: string
  name: string
  description?: string
  steps: RoutineStepV1[]

  evidence: {
    occurrenceCount: number
    distinctInputCount: number
    distinctDayCount: number
    consumedSuccessCount: number
    undoCount: number
  }

  createdBy: 'user' | 'learner' | 'model'
  status: 'candidate' | 'enabled' | 'disabled'
}

export interface RoutineStepV1 {
  action: { key: string; versionRange: string }
  input:
    | { from: 'routine-input' }
    | { from: 'step-output'; step: number }
    | { from: 'context'; key: string }
  params: Record<string, JsonValue | { variable: string }>
}
```

Routine V1 严格限制：

```text
线性
最多 5 步
无分支
无循环
无定时
无后台触发
pure/read 可连续执行
任何 write 都暂停并显式确认
每步由原 Provider 重新校验版本、参数与权限
```

### 4.7 不依赖 Agent 的学习算法

#### A. 重复单动作候选

分组键：

```text
actionKey
+ actionVersion family
+ paramSignature
+ inputPolicy
+ outputIntent
```

保守原型阈值：

```text
采用成功 ≥ 4 次
不同 inputFingerprint ≥ 3
跨日期 ≥ 2 天
失败或撤销 = 0
```

产物：Saved Action Candidate。

#### B. 连续动作候选

优先使用明确数据流：

```text
run A outputFingerprint = run B inputFingerprint
或
run B.parentRunId = run A.runId
```

而不是单纯使用“五分钟内相邻”。候选长度先限定为 2-4 步，所有步骤必须为 `pure/read`，并要求多个不同根输入与跨日证据。

产物：Routine Candidate。

#### C. 上下文排序偏好

只在同一匹配层级内做有上限的 tie-breaker：

```text
surface + object shape + invocation source
→ action preference score
```

必须有衰减、恢复默认和“不要再学这一类”的抑制机制，不能隐藏其他动作。

### 4.8 LLM Distiller 与 Agent 的位置

LLM Distiller 可以较早加入，但没有执行权。它只接收经过脱敏的结构化候选，用于：

- 命名；
- 一句话说明；
- 提议哪些参数应成为变量；
- 合并语义近似候选；
- 解释推荐原因。

其输出必须经过 Schema 校验、用户确认和必要的重放验证。

Agent 则只在用户给出开放目标、固定 Artifact 无法覆盖时出现。Agent 只能调用 `agentVisible=true` 的白名单 Action，并受步数、时间、网络、token、权限和取消预算约束。

## 5. 端到端系统流程

### 5.1 用户直接执行一个动作

```text
Object Block / editor selection / clipboard
→ Launcher Consumer 选择 ActionDefinition
→ Action Runner 校验输入与参数
→ 权限与确认
→ Provider.execute
→ Canonical Result
→ Presenter 生成 copy / replace / return 等操作
→ 用户消费结果
→ Experience Journal 形成完整 run 链
```

### 5.2 学习形成个人工具

![自学习闭环](/tmp/hiven_doc_work/learning_loop.png)

Learning Inbox 应显示证据而不是“AI 猜到你需要”：

```text
可能的个人工具

Base64 解码 → JSON 格式化 → 复制

过去 14 天出现：5 次
不同输入：4 个
跨越日期：3 天
结果被采用：5 次
失败：0 次
撤销：0 次

[试运行] [保存为工具] [暂时忽略] [永远不要学习这类路径]
```

### 5.3 Routine 执行

```text
resolve artifact
→ validate every action version
→ resolve routine input
→ execute step 1
→ bind canonical output to step 2
→ append per-step receipt
→ 遇到 write 暂停确认
→ final result presented by current surface
```

Routine 自身不拥有 JSON、飞书、浏览器或 Shell 语义；每一步仍由原 Provider 负责。

### 5.4 未来 Agent 执行

```text
用户开放目标
→ Agent Consumer 读取允许的 ActionDefinition
→ 生成最多 N 步计划
→ Host 展示来源与权限范围
→ Action Runner 逐步执行
→ 范围扩大时重新审批
→ 最终只生成草稿或明确目标结果
```

Agent 不能绕过 Action Runtime 调用插件私有函数。

## 6. Host、插件与 Kit 的边界

| 能力 | Host / SDK 最小职责 | Provider / Plugin 职责 |
|---|---|---|
| 对象 | 引用、类型、来源、失效、当前可用动作 | 什么是项目、会议、承诺、JSON、飞书对象 |
| 上下文 | 一次性快照、来源和能力状态 | 哪些上下文对某领域任务有意义 |
| 动作 | Definition、注册、版本、统一 Runner | 实际执行、领域校验、业务失败 |
| 权限 | 声明、授权、撤权、确认框架 | 为什么需要、如何降级、目标语义 |
| 输出 | canonical value、copy/paste/editor/surface intent | 领域布局、解释和下一步 |
| 学习 | 证据、阈值、衰减、抑制、Artifact | 领域规则最终编辑体验 |
| 存储 | namespace、quota、retention、导出入口 | schema、TTL、迁移和领域删除语义 |
| Kit | 纯算法、无状态、无副作用、多处复用 | 不拥有产品状态和生命周期 |

Host 不应理解：

```text
排障是什么
会议是什么
承诺是什么
什么时候应该催人
JSON path 的业务影响
飞书消息何时算完成
Git 检查应该跑什么
```

这些仍属于领域 Provider 或 Playbook。

## 7. 插件生命周期收敛

当前 hiven 已有背景 start/stop、registry unregister、editor cleanup、permission/settings watcher，但责任分散。[R3]

建议增加轻量 `PluginEffectScope`，借用 DSH 的 effect 思想，不立即引入完整 Fiber：

```ts
export class PluginEffectScope {
  private disposers: Array<() => void | Promise<void>> = []

  own(disposer: () => void | Promise<void>): void {
    this.disposers.push(disposer)
  }

  async dispose(): Promise<void> {
    for (const disposer of this.disposers.reverse()) {
      await disposer()
    }
    this.disposers = []
  }
}
```

所有注册操作逐步返回 disposer：

```ts
scope.own(actionRegistry.register(...))
scope.own(surfaceRegistry.register(...))
scope.own(eventBus.on(...))
scope.own(backgroundManager.start(...))
scope.own(shortcutRegistry.register(...))
```

这样插件 disable、reload、permission revoke 时只需释放 Scope，减少残留 watcher、快捷键、动态 provider 和候选引用。

## 8. 逐文件迁移方案

### 8.1 新增目录

```text
src/workspace/actionRuntime/
  types.ts
  actionRegistry.ts
  actionRunner.ts
  actionEvents.ts
  legacyToolAdapter.ts

src/workspace/experience/
  experienceEventTypes.ts
  experienceJournal.ts
  fingerprints.ts
  retention.ts

src/workspace/artifacts/
  artifactTypes.ts
  artifactStore.ts
  savedActionRunner.ts
  routineRunner.ts

src/workspace/learning/
  candidateMiner.ts
  sequenceMiner.ts
  evidence.ts
  suppressionStore.ts

src/workspace/pluginEffectScope.ts
src-tauri/src/experience_journal.rs
```

### 8.2 修改现有模块

| 文件 | 主要改动 |
|---|---|
| `launcher/types.ts` | 增加 Action 引用、runId、canonical result、output intent metadata |
| `launcher/toolAdapter.ts` | 由“Tool → callback LauncherItem”改为“Tool → Action Provider → Launcher Consumer” |
| `launcher/controller.ts` | 所有执行进入 Action Runner；生成 run 事件；结果 frame 保存 runId |
| `launcher/output.ts` | closure 增加可序列化 Output Intent；消费后写 result event |
| `pluginTypes.ts` | first-party tool 增加 action policy 字段 |
| `pluginRegistry.ts` | 注册 Action Provider；逐步返回 disposer |
| `pluginRuntime.ts` | 建立并释放 PluginEffectScope |
| `usageJournal.ts` | 保留 frecency 用途，不继续承担学习事实 |
| `workflow/pipeline.ts` | 长期迁移为 Action Runtime 上的 Routine；短期保留兼容 |

## 9. 分阶段实施计划

以下工期是基于当前代码规模的工程估算，不是报告中的已验证事实。假设一名熟悉 TypeScript、Tauri 和现有代码的工程师。

### PR0：架构与数据边界对齐（2-3 天）

交付：

- Action / Journal / Artifact ADR；
- 核对报告分支与公开 main；
- 移除学习路径中的 query/title preview；
- 错误改为 errorType/errorCode；
- 分类 10 个 first-party 纯动作。

验收：

```text
新学习日志正文泄漏 = 0
旧 Launcher 行为不变
至少 10 个 Action 有明确 policy
```

### PR1：Action Contract V1（8-10 天）

交付：

- Action Definition、Registry、Runner；
- Legacy Adapter；
- 10 个纯动作 opt-in；
- runId、run.started、run.finished；
- canonical text result 的第一条新路径。

验收：

```text
现有工具仍可运行
所有 opt-in Action 都有最终 run 状态
Legacy 工具默认不可学习
超时、取消、权限失败均可分类
```

### PR2：Experience Journal V1（5-7 天）

交付：

- SQLite Journal；
- HMAC fingerprint；
- 参数 allowlist；
- result.consumed / dismissed / undone；
- 本地审计页和清除策略。

验收：

```text
一次动作可重建完整链：started → finished → consumed
用户可看见系统实际保存的字段
正文与敏感参数进入 Journal 的数量 = 0
```

### PR3：Learning Inbox V0（7-10 天）

交付：

- 单动作重复候选；
- 证据卡；
- 忽略与永久抑制；
- 固定 fixture 回放测试；
- 不自动执行。

验收：

```text
高质量固定事件能够产生候选
噪声、失败和同一输入重复不会产生候选
每个候选都能解释证据
```

### PR4：Saved Action + 两步 Routine V1（8-12 天）

建议先把 Routine 收缩为 **两步纯动作**，确认价值后再扩到 5 步。

交付：

- Saved Action Artifact；
- 两步 pure/read Routine；
- 数据流绑定；
- 版本与 schema 漂移禁用；
- 每步回执。

验收：

```text
Base64 解码 → JSON 格式化 可保存并按名称运行
不同工具版本不兼容时禁止静默执行
external-write / shell 不进入自动候选
```

### PR5：可选 LLM Distiller（5-8 天）

只做命名、说明、变量提议和语义聚类，无工具执行权。

### 建议的最小切线

若希望四周内验证，停在：

```text
PR0 + PR1 + PR2 + PR3 的单动作候选
```

不要在第一轮同时做多步 Routine、Agent、全桌面观察和第三方插件隔离。

## 10. 测试与质量门

至少应增加以下可运行检查：

1. **Action Contract Test**：缺 key/version/input/output/policy 的 opt-in Action 无法注册。
2. **Legacy Safety Test**：旧工具自动得到 `unknown/never/not-learnable`。
3. **Run Finalization Test**：成功、抛错、超时、取消、权限拒绝都必须有唯一最终事件。
4. **Canonical Result Test**：新 Action 结果可 JSON 序列化，不包含 closure。
5. **Consumption Correlation Test**：copy/replace/return 能关联原 runId。
6. **No-content Journal Test**：query、clipboard、result、window title、raw error 不得写入。
7. **HMAC Fingerprint Test**：相同本机输入稳定，不同安装不可关联。
8. **Param Allowlist Test**：未知和敏感参数不进入 signature。
9. **Candidate Precision Test**：失败、撤销、同一输入反复运行不产生候选。
10. **Suppression Test**：用户选择“不是这个”后，同簇候选不再出现。
11. **Schema Drift Test**：Action 版本不兼容时 Artifact 禁用。
12. **Routine Policy Test**：write、destructive、unknown Action 不能被自动编入。
13. **Plugin Dispose Test**：disable/reload 后 Action、event、watcher、shortcut 全部释放。
14. **Performance Gate**：新 Journal 写入不得阻塞 Launcher first paint 和按键路径。
15. **Recovery Test**：Journal 写入失败不得阻断用户动作；失败可见但降级运行。

## 11. 观察范围与隐私等级

不建议先做“监控我所有行为”。应分级推进：

| 等级 | 观察内容 | 当前建议 |
|---|---|---|
| Level 0 | hiven 内部展示、选择、执行、结果消费、撤销 | 立即做 |
| Level 1 | 可选的无正文上下文：surface、App 类别、repo fingerprint、browser domain | 有明确用途后 opt-in |
| Level 2 | 用户显式交给 hiven 的选区、剪贴板、链接 | 只在对应任务生命周期内使用 |
| Level 3 | 持续屏幕、键盘、音频、全应用正文捕获 | 当前不做 |

原因不是模型能力不足，而是 Level 3 会引入旁观者数据、同意、敏感 App、删除、加密、跨应用权限和法规问题；同时它也不能替代能力契约和结果验证。[R2]

## 12. 产品验证与停止条件

当前报告基线是：92 个 Launcher 会话中只有 5 次带稳定 Action ID 的执行，没有达到阈值的重复候选。这支持“先收集稳定执行事实”，不支持立即建设完整 Habit Compiler。[R1][R2]

建议门槛：

### Action/Journaling 技术门

```text
连续 14 天运行稳定
无正文泄漏
run 最终状态丢失率 = 0
结果消费可关联率 ≥ 95%
```

### Learning 产品门

```text
三周内至少出现 3 条跨日重复路径
至少 1 条固定参数单动作
至少 1 条明确数据流两步链
候选必须来自不同输入并有消费证据
```

### 停止条件

- 三周仍无高质量候选：冻结 Routine 自动发现，保留手动 Saved Action；
- 候选多数被忽略：只做排序和手动保存；
- 无法稳定判断结果消费：先修 Output Runtime，不增加模型；
- Action 无法声明 effect/replay：不得进入 Learner 或 Agent；
- 任意正文进入 Experience Journal：暂停试验、清理数据并复测；
- 两步 Routine 已覆盖主要重复：不引入 Planner Agent；
- 固定 Playbook 能覆盖开放目标：不引入 Agent。

## 13. 主要风险与裁决

### 风险 1：Action Runtime 变成新的通用 DSL

裁决：Action Runtime 只运行单个能力；Artifact V1 只保存固定参数或线性数据流，不提供条件、循环、事件触发和跨系统事务。

### 风险 2：为了学习而收集过多数据

裁决：先做 Level 0；默认 shape、HMAC 和 allowlist；Learning Journal 与长期记忆严格分离。

### 风险 3：插件政策字段维护成本高

裁决：Legacy 默认保守；仅 first-party 高频 Action 逐个 opt-in；未知 Action 不影响现有功能，只是不参与自动化。

### 风险 4：Canonical Result 改造面过大

裁决：双轨迁移。旧 closure result 继续运行但标记 opaque；新学习闭环只要求 5-10 个 opt-in Action 完成 canonical path。

### 风险 5：Agent 反向绑架架构

裁决：Action Contract 为人类 Launcher 和 Routine 设计；Agent 只消费同一协议，不为模型专门暴露 Host 私有能力。

### 风险 6：插件仍在同进程，不是真正沙箱

裁决：近期只支持可信 first-party；权限 UI 不宣传为恶意代码隔离；第三方生态重启前再引入 worker/subprocess、签名和供应链验证。

### 风险 7：引入 Cordis/DSH 导致重写

裁决：只借 Capability Seam、effect 和 event log 原则。除非 hiven 出现多个可替换 Provider 和复杂依赖热替换需求，否则不引入完整 Cordis 运行时。

## 14. 请求 Fable5 的评审问题

请按“反对优先”的方式评审本方案，并明确给出理由：

1. **架构边界**：Action Runtime 中哪些字段仍属于插件语义，不应进入 Host？
2. **最小契约**：ActionDefinition V1 哪些字段可以删，哪些关键字段缺失？
3. **结果模型**：Canonical Result 是否值得迁移，还是可以仅为现有 closure 增加 metadata？
4. **日志模型**：append-only Experience Journal 是否过重；是否有更简单但仍可审计的实现？
5. **学习精度**：单动作与两步序列的证据门槛是否能避免短期调试 burst？
6. **插件机制**：保留 first-party 插件化是否合理，还是应改为内部 package/service、仅外部能力使用插件？
7. **生命周期**：轻量 PluginEffectScope 是否足够，何时才需要 Cordis Fiber/Pending 依赖模型？
8. **Agent 时机**：是否存在必须先有 Agent 才能验证的关键价值？若有，请给出不可由统计、Routine 或 Playbook覆盖的例子。
9. **四周 MVP**：请提出一个更小的实现切线，并指出必须牺牲什么。
10. **失败模式**：请列出最可能导致项目失败的三个隐性耦合或产品假设。

期望评审输出：

```text
A. 总体判断：采纳 / 修改后采纳 / 不采纳
B. 最强反对理由
C. 建议保留的最小内核
D. 四周落地方案
E. 需要推迟或删除的模块
F. 关键接口的修改建议
```

## 15. 最终建议

本方案的核心不是“做一个会观察用户的 Agent”，而是先建立一个可靠的 Experience Kernel：

```text
能力由插件实现
执行由 Host 统一
事实由 Experience Journal 保存
模式由 Learner 发现
用户决定是否沉淀为 Artifact
模型只做可选归纳
Agent 最后作为受限 Consumer 接入
```

落地起点应是 **PR0 数据边界 + PR1 Action Contract + PR2 Experience Journal**。只有当系统能可靠回答“刚才调用了什么、是否成功、结果去了哪里、用户是否采用”之后，谈自学习、Routine 和 Agent 才有工程基础。

## 附录 A：术语

| 术语 | 定义 |
|---|---|
| Capability Provider | 实现一项能力的 first-party 或未来 external provider |
| Action Definition | 可被 Launcher、Routine、Learner、Agent 共同理解的能力契约 |
| Action Runtime | Host 中统一注册、校验、执行、权限和事件的运行时 |
| Canonical Result | 与 UI 无关、可序列化的动作结果 |
| Output Intent | copy、replace、return 等用户选择的结果去向 |
| Experience Journal | 本地、无正文、可审计的个性化学习事实日志 |
| Artifact | 用户可见、可编辑、可删除的 Saved Action 或 Routine |
| Learner | 从经验事件中发现候选的确定性模块 |
| LLM Distiller | 无执行权的模型归纳器 |
| Agent Consumer | 面对开放目标，受预算和白名单约束地调用 Action Runtime 的消费者 |

## 附录 B：来源与证据边界

本文把内容分为三类：

- **来源事实**：来自两份内部报告、hiven 公开主分支、Pi 与 DSH 官方仓库；
- **设计提案**：Action Runtime、Experience Journal、Artifact Registry、PluginEffectScope 等目标结构；
- **工程估算**：PR 工期、原型阈值和阶段切线，均需由实际代码与用户数据校准。

### 参考资料

- [R1] 《个人 AI 操作系统方向》，内部报告，2026-08-24。
- [R2] 《hiven 个人工作台未来方向全景》，内部探索报告，2026-08-24。
- [R3] `wmgx/hiven` 公开主分支：`launcher/controller.ts`、`toolAdapter.ts`、`output.ts`、`usageJournal.ts`、`pluginTypes.ts`、`pluginRuntime.ts`、`pluginBackgroundManager.ts`、`workflow/pipeline.ts` 等。
- [R4] Pi 官方仓库与文档：minimal coding harness、extensions、session format。
- [R5] DeepSeek Harness 官方仓库与文档：capability seams、services、lifecycle/effects、session、tools。

