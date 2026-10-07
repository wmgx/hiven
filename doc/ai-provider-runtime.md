# AI Provider Runtime 技术方案

## 1. 交付能力

Hiven Host 向插件提供统一的 `ctx.ai`：插件可以发现当前可用的订阅 Provider、Agent、能力和额度，并以事件流调用 AI。请求中的 `providerId`、`agentId`、`effort` 均可省略；Host 按系统默认值解析，默认值失效时回退到可用 Provider 或其默认 Agent。

当前注册 `openai-chatgpt` 与 `xai-grok` Provider。前者通过 Codex App Server 完成 ChatGPT OAuth、模型发现、流式调用、取消、账户额度读取和 token 用量读取；后者通过 xAI 官方 device-code OAuth 使用 SuperGrok / X Premium 订阅，并通过订阅 CLI proxy 的 Responses API 完成文本/图片理解、Web Search、模型发现、流式调用、取消、订阅额度窗口和 token 用量读取。Provider 框架不包含供应商协议字段，后续 Provider 通过同一 Host registry 接入。

Codex App Server 使用 Hiven 独立的 `CODEX_HOME`，不会读取、覆盖或退出用户在 Codex CLI/桌面应用中的登录。macOS 优先使用 ChatGPT 桌面应用内的 Codex 可执行文件，再回退到 PATH 中的 CLI；也可以通过 `HIVEN_CODEX_BIN` 指定路径。

## 2. 插件契约

```ts
interface PluginAiApi {
  providers(): Promise<AiProviderDescriptor[]>
  preflight?(request?: AiPreflightRequest): Promise<AiPreflightResult>
  subscribePreflight?(listener: () => void): () => void
  stream(request: AiRequest): AsyncIterable<AiEvent>
  cancel(runId: string): Promise<void>
  usage(query?: AiUsageQuery): Promise<AiUsageRecord[]>
}
```

`AiRequest.providerId` 可选。解析顺序为：请求值 → 系统默认 Provider → 第一个 `ready` Provider。`agentId` 采用相同规则；`effort` 为空或 `inherit` 时使用系统默认强度，再回退到 Agent 默认强度。

插件只声明 `ai.use` 权限。`pluginId` 和插件来源由 Host 注入，不能从请求覆盖；Host 用它们形成稳定的消费归因键。 当前调用同时受创建 handle 时的授权上界和实时授权约束；撤权使等待及活动调用失效，重新授予不会恢复旧调用。

### 运行前配置检查

`preflight` 只接受服务、模型、强度、能力和输入模态等元数据，不接受正文或附件，也不发模型试请求。它严格解析当前明确选择或系统默认目标，不使用 `stream` 的历史跨服务回退。

- `ready` 仅表示配置检查通过，不保证额度、网络可达或本次请求成功。
- `blocked` 表示已有确定阻碍；`unknown` 表示目录不全、静态回退或检查失败等不确定情况。未列出模型不等于模型不存在，未知上限不能用于截断文本。
- 配置检查独立缓存约60秒，同一服务合并在途读取；`forceRefresh` 绕过已完成缓存。实际 `stream` 仍重新校验，不靠预检放行。
- `selectionKey` 用于识别旧检查结果，不是授权凭证。`subscribePreflight` 通知配置、权限及显式账户/服务操作造成的失效；卸载调用方时应取消订阅，替换 `host.ai` 后应重新绑定。
- 翻译界面只在打开、AI配置变化或明确刷新时检查，键入和流式片段不触发探测；执行明确传入界面展示的服务和模型。未知但可以明确绑定的目标保留兼容调用；无法确认继承目标时要求用户明确选择。

旧宿主可不提供这两个可选方法，插件应检测其存在。预检不验证供应商工具已全部禁用，也不会自动登录、切换账户或新建服务。


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
