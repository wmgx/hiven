# Codex App Server 连接生命周期

原生桥为每次启动的进程分配字符串连接 ID。RPC 的成功对象结果与所有 `hiven://ai-codex-event` 通知都附带顶层 `_hivenConnectionId`；它是桥接元数据，不会写进发给 App Server 的 JSON-RPC 消息。

## 关闭与恢复

- stdout EOF、读取失败或 stdin 写入失败会关闭该连接，拒绝尚未完成的 RPC，并且只发送一次 `hiven/transport/closed` 通知。诊断在 `params.message`。
- 即使 `turn/start` 的 RPC 已经返回，关闭通知仍然发出，让等待输出的前端流明确失败。
- 前端以连接 ID 绑定握手和活动流，旧代通知不能影响新连接。绑定后的 turn 不跨代重放。
- 后续未绑定的发现请求可以重新启动并初始化进程。旧连接的关闭、错误和清理不会改动新连接的状态。
- RPC 等待超时或被丢弃时，其 pending 登记会清理。

## 初始化与 turn 的代际检查

`ai_codex_rpc` 和 `ai_codex_notify` 接受可选 `expectedConnectionId`。提供后仅允许使用匹配的存活连接，否则返回 `HIVEN_CODEX_CONNECTION_CHANGED`，不会启动替代进程。

`initialized` 通知必须携带 `initialize` 返回的连接 ID，且绝不启动进程。成功写入和原生 `initialized` 状态更新在同一进程锁内完成，避免旧握手确认误初始化新进程。`turn/start`、`turn/interrupt` 使用活动流绑定的连接 ID。

## 本地验证

```bash
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib ai_codex::
```

生产 transport 模块的回归覆盖：RPC 已回复后的 EOF、读写故障只关闭一次、旧连接通知隔离、初始化和 turn 跨代拒绝、超时及丢弃后的 pending 清理。Unix 额外用本地假 App Server 进程验证：读取一条请求、返回 `turn/start` 结果，然后直接退出。

测试不会运行真实 Codex、登录账号、访问模型或改动凭据。实际桌面 IPC 和付费服务未在这些测试中验证。
