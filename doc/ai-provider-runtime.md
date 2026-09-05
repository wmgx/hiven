# AI Provider Runtime 技术方案

## 1. 交付能力

Hiven Host 向插件提供统一的 `ctx.ai`：插件可以发现当前可用的订阅 Provider、Agent、能力和额度，并以事件流调用 AI。请求中的 `providerId`、`agentId`、`effort` 均可省略；Host 按系统默认值解析，默认值失效时回退到可用 Provider 或其默认 Agent。

当前注册 `openai-chatgpt` 与 `xai-grok` Provider。前者通过 Codex App Server 完成 ChatGPT OAuth、模型发现、流式调用、取消、账户额度读取和 token 用量读取；后者通过 xAI 官方 device-code OAuth 使用 SuperGrok / X Premium 订阅，并通过订阅 CLI proxy 的 Responses API 完成文本/图片理解、Web Search、模型发现、流式调用、取消、订阅额度窗口和 token 用量读取。Provider 框架不包含供应商协议字段，后续 Provider 通过同一 Host registry 接入。

Codex App Server 使用 Hiven 独立的 `CODEX_HOME`，不会读取、覆盖或退出用户在 Codex CLI/桌面应用中的登录。桌面包需要携带或安装可执行的 `codex`；也可以通过 `HIVEN_CODEX_BIN` 指定路径。

## 2. 插件契约

```ts
interface PluginAiApi {
  providers(): Promise<AiProviderDescriptor[]>
  stream(request: AiRequest): AsyncIterable<AiEvent>
  cancel(runId: string): Promise<void>
  usage(query?: AiUsageQuery): Promise<AiUsageRecord[]>
}
```

`AiRequest.providerId` 可选。解析顺序为：请求值 → 系统默认 Provider → 第一个 `ready` Provider。`agentId` 采用相同规则；`effort` 为空或 `inherit` 时使用系统默认强度，再回退到 Agent 默认强度。

插件只声明 `ai.use` 权限。`pluginId` 和插件来源由 Host 注入，不能从请求覆盖；Host 用它们形成稳定的消费归因键。

## 3. Provider 契约与责任

Provider Adapter 负责：

- 返回订阅状态、Agent、支持的输入模态和能力；
- 把统一请求转换为供应商请求；
- 把供应商事件转换成 `AiEvent`；
- 返回供应商真实报告的用量和额度，不推算缺失值；
- 按 `runId` 取消运行。

Host 负责默认值解析、权限校验、插件归因和持久化。插件负责提示词、业务交互、输出展示以及是否实现图片、文本等产品能力。

## 4. 用量与额度

每次运行记录 `runId`、插件身份、Provider、Agent、强度、状态、起止时间和标准化 metrics。Provider 报告 token、图片、音频或工具调用时，Host 原样记录对应单位；未报告的指标不补零。

账户额度单独来自 Provider。Codex App Server 当前提供额度窗口的 `usedPercent`、重置时间、credits 和账户 token 活动；这些是账户整体状态，不能精确拆成单个插件消耗的订阅百分比。插件统计页应展示标准化用量，系统账户页展示 Provider 额度。

## 5. 异常行为

- 没有可用 Provider：流返回 `provider_unavailable`。
- 指定 Provider 或 Agent 不存在：直接失败，不静默换源；只有省略字段时才使用默认与回退。
- Provider 进程不可用：Provider 保留在列表中并标记 `unavailable`，附带可展示错误。
- 登录失效：Provider 标记 `login_required`，已开始的流以认证错误结束。
- 取消是幂等操作；已完成或未知 `runId` 不报错。
- 用量持久化失败不改变模型调用结果，但记录 Host 警告。

## 6. 当前边界

当前不接 API Key，也不把供应商原始事件暴露给插件。xAI Provider 当前开放文本、图片理解和服务端 Web Search；图片生成/编辑、音频和视频仍未接入，不声明对应能力。Codex 原生桥不开放 `command/exec`、配置写入等 RPC；普通 turn 固定使用 `approvalPolicy: never`、restricted read-only sandbox、空读取根和独立空工作目录，避免继承 Hiven 启动目录的文件权限。插件获得的是生成能力，不是供应商的编码环境。
