# Ollama 本地文本 Provider

首版在桌面端复用现有 `PluginAiApi`，Provider ID 为 `ollama-local`。只声明 `text.generate` 与文本输入，不提供工具调用、结构化输出、图像、文件、自动操作或云端回退。

## 设置与发现

在设置的 AI Provider 页面启动手动 Refresh。hiven 只连接原生 HTTP 客户端的固定地址 `http://127.0.0.1:11434`，禁用环境代理和 HTTP 重定向；没有外部地址、密钥或账号配置。页面不会要求登录或退出本地服务。

`describe` 只请求 `/api/tags` 与 `/api/show`，不会发送用户输入、加载模型进行试推理或下载模型。目录与详情返回后，只有满足全部证据的条目才出现：

- tags 返回完整模型名、非零安装大小、SHA256 digest 与 `gguf` 格式
- show 返回 `gguf` 格式、`model_info.general.architecture` 和 `completion` 能力
- 没有已知的 cloud/remote 路由字段，没有 cloud/remote 标签片段，没有本版尚不支持的多 manifest/runner 选择

名称只用于排除明显的云端变体，绝不靠名称猜测支持能力。缺失或无法验证的详情不进入可用目录。当前版本保守地只支持可确认的 GGUF completion 模型；其他本地格式也可能显示不支持。服务不可达、空目录、没有可确认模型以及元数据超时分别显示可操作状态；用户可自行启动已有服务、准备合适的本地模型后再刷新。hiven 不自动安装、pull、登录或启动 Ollama。

目录最多检查 128 个条目；单个元数据响应上限 2 MiB，单次 metadata 请求 2 秒，总发现期限 8 秒。已有可确认模型但后续检查失败时，目录标为 partial；没有可确认模型就不可用。ready 仅代表元数据配置检查通过，不承诺模型可加载、输出质量或推理成功。

## 本地服务信任边界

固定 loopback、禁代理、禁重定向、拒绝已知远端模型可以约束 hiven 的 HTTP 目的地和正常 Ollama 的已知路由元数据。但 loopback 不是服务身份认证，也不能证明一个被替换、恶意或配置特殊的本地服务不会转发输入。用户需要信任本机运行的 Ollama 服务及其配置。

运行前重新请求 tags → show → tags，确认选择仍存在、仍是受支持的本地 completion 模型，且 digest 在这次检查期间未改变。此检查不是原子锁定，也不是对本地服务行为的证明；它主要阻止普通的删除、云端切换、模型标签变更和陈旧目录造成的误用。实际 chat 响应还必须匹配所选模型名，并拒绝远端路由字段。

本地 Provider 必须被明确配置为默认或由请求显式指定；它不参加其他服务离线、或者尚未配置默认服务时的自动候选。设置列表仍允许用户手动选择本地服务，空选择会提示先选服务，不会把“只有本地可用”描述成“没有可用服务”。用户明确选择的本地 Provider 不可用时，Host 保留该选择并失败；不会改用云端 Provider。已配置的本地模型缺失时也不会换一个模型。内建本地 Provider 的 `fallbackPolicy: 'never'`、无账号认证与严格输入边界在初始化时独立保存，不能被之后的 adapter 注销、同 ID 替换或 metadata 结果抹除。启动前已经缺失或不可用的本地 Provider 也会失败，不会改用云端；设置页面保留不可用的本地选择。后台发现和刷新不会更改用户保存的默认设置。用户首次手动选中本地 Provider 时，设置同时保存当时界面显示的模型 ID；后续目录重排不会改选。本地请求必须通过请求本身或属于同一本地 Provider 的已保存默认设置明确给出模型 ID；缺失时直接要求选择模型，不会取目录 first/default。若请求显式选了本地 Provider，但全局默认仍是另一 Provider，则请求必须显式给出本地模型 ID，不会继承另一个 Provider 的同名模型配置。发现期间 adapter 被移除或替换，也会终止已经开始的本地请求，而不是调用替代实现。

兼容差异：任何已明确配置的 Provider 若根本没有注册，运行现在都会直接失败；这也适用于云端 Provider。云端 Provider 注册仍存在但暂不可用时，原有云端到云端的自动回退仍保留。本地 Provider 不会作为此类自动回退目标。

## 请求、流与取消

原生层只发送 `/api/chat` 的 `model`、一条 user `messages` 和 `stream: true`。多个文本输入按顺序以换行连接。所有输入都计入 UTF-8 256 KiB 上限，序列化请求另限 2 MiB；超过上限直接失败，应用不截断。没有 tools、format/schema、effort、think 或推测的模型参数。

这些是传输和内存边界，不是 token 预算。hiven 尚未确认模型实际 `num_ctx`、tokenizer、输出上限或思考控制；所以不声明 `contextWindow`、`maxOutputTokens` 或 supported effort。服务端仍可能按照自己的版本和模型配置处理、压缩或截断上下文，不能从通过字节检查推导“全部输入都被模型使用”。模型未能明确返回正常终帧时不能当作成功。

NDJSON 按字节累积到完整行再解析 UTF-8/JSON，支持 LF/CRLF、空行和 EOF 前无换行的完整终帧。每行上限 1 MiB，总流上限 8 MiB，总运行时限 180 秒。流只映射：

- message.content → text.delta
- message.thinking（服务返回时）→ reasoning.delta
- 终帧 prompt_eval_count / eval_count → input_tokens / output_tokens
- done=true 且 done_reason=stop、有非空文本 → completed

缺失终帧、空文本、异常 JSON、UTF-8、计数或模型名、HTTP 错误、流内 error、大小超限均失败。done_reason=length 明确报告截断。第一终帧后不再处理尾部。返回工具调用直接失败，不会将工具内容变成可执行事件，更不会执行生成动作。原生错误使用固定错误码，不把服务返回正文或输入回显给用户。

取消复用从现有 xAI 传输中纯提取的 `RunRegistry`，不接入任何账号状态。每个 Provider 仍使用自己的运行集合。runId 在第一 await 前注册；取消与 HTTP send/read 竞争，丢弃待处理 future 以关闭实际请求。注册前的取消保留原有 60 秒、有界 256 条记录的门控。RAII 在完成、失败、取消与命令 future 被丢弃时清理注册。前端取消会清空未消费的输出并拒绝晚到块，消费者提前结束也触发原生清理。

## 验证范围

针对性测试使用合成文本和 fake invoke / loopback HTTP 服务，覆盖模型资格、目录、请求形状、UTF-8 分块、终帧、截断、错误、限制、取消以及本地默认不回退。socket 关闭测试能证明客户端真实请求被取消，不能证明 Ollama 的 GPU/CPU 已停止计算。

完整官方 AppImage 已在隔离配置的 Linux Xfce 桌面验证设置页：本地服务未启动时显示连接失败及启动后刷新说明；Ollama 行只有刷新入口，不要求登录；两次刷新及关闭重开均保留不可用状态，没有自动选择服务或模型。

本次未下载或运行真实模型；没有模型质量、真实延迟、内存占用或服务端算力回收的验证结论。真实模型推理与模型可用时的桌面选择仍待验收，不能用合成服务测试或编译代替。

针对性命令：

```sh
node scripts/test-ollama-provider.mjs
node scripts/test-ollama-runtime.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib ai_ollama -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml --lib ai_run_registry -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml --lib ai_xai::stream::tests::loopback_cancel -- --test-threads=1
```

参考：

- [Ollama tags API](https://docs.ollama.com/api/tags)
- [Ollama show API](https://docs.ollama.com/api-reference/show-model-details)
- [Ollama chat API](https://docs.ollama.com/api/chat)
- [Ollama 官方 API 数据结构](https://github.com/ollama/ollama/blob/main/api/types.go)，包括 tags/show/chat 的 remote_model、remote_host 字段
