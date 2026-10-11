# History 队列初始状态读取

2026-10-11，承接原生复审中首次打开 History 出现“无法读取队列状态”、重开后消失的现场。

## 定位证据与边界

- 旧截图记录了错误残留；随后两次进程启动未再次复现。一次事件追踪中，状态请求到 `ok: true / idle` 回执约 29 ms，未见监听未注册造成的 8 秒超时。追踪仅含事件、请求标识和状态，不含剪贴板正文。后来发现 WebDriver 结束会话会遗留应用进程，这两次启动不计作单实例冷启动验收；最终验收前已停止本轮创建的所有旧实例。
- 代码存在可达竞态：独立窗口 `visible` 回调同步使旧 delivery owner 失效，取消其 RPC；React effect 清理尚未执行时，旧 catch 仍可能把取消显示成读取失败。新 owner 查询成功仅更新队列状态，旧错误提示没有被清除。
- 独立审查确认了上述调用链。它解释了已见现象，但尚未通过冷启动追踪实证为唯一原因；不把猜测记为运行环境故障，也不声称复现了所有冷启动时序。

## 修复

状态读取具有独立的 loading / ready / failed 状态，继续使用原状态区，补齐中英文加载文案。读取结果、错误和订阅更新必须属于当前 owner；旧 owner 的取消不能覆盖新会话。新有效状态读取只清除读取失败，不会清掉队列启动、取消或交付反馈。

宿主对非成功状态回执显式报错，避免权限拒绝被误当成 idle。没有忽略所有 `QueueCancelledError`：现有 RPC 超时也使用这个码，当前 owner 的真实超时仍显示读取失败。没有增加任意延时、自动重试或扩大插件权限。

History 发布版本为 1.6.1，内置包索引为 118。交接逻辑测试覆盖旧 owner 撤销、晚回执、新 owner 正常读取、当前 owner 超时和拒绝回执；不调用真实 API、不为样式或 UI 添加单元测试。

## 原生验收

前端、原生 AppImage 重新构建后，确认旧应用实例均已退出，再启动一个隔离实例。实际加载的 History manifest 为 1.6.1。

- 首次打开 History：状态读取完成，未出现加载残留或读取失败。
- 两次不同搜索各选一条合成文本：队列进入 `Next 1/2`，完整快照保留。
- Hiven 前台触发队列粘贴：产生真实目标失败，未改写剪贴板；重新打开 History 后仍显示第 1 条未送达、剩余 2 条及重试指引。失败反馈没有被成功状态查询抹掉。
- Cancel queue：显示取消完成，保留文本选择。最后退出选择，恢复历史记录关闭、各记录类别开关开启。

临时证据在 `/workspace/hiven-native/queue-cold-after-{idle,ready,failure,cancelled}.png` 与 `queue-cold-after-result.json`。类型检查、架构检查、差异检查、构建和针对性交接测试通过。验证范围仅 Linux X11、隔离 profile 与合成数据；macOS、Windows、Wayland 未验证。未调用真实 API、未访问用户密钥。

## 暂停记录导致的确定性拒绝（2.0.2）

保留策略验收后再次观察到读取失败，本次在原隔离 profile、单个存活 Hiven 进程、同一 `launcher` 窗口中记录完整不含正文的原生 status 请求／回执，并只改变录入开关：

- 录入关闭：36 ms 返回 `ok:false`、`errorCode:QueueUnavailableError`、`phase:idle`。
- 录入开启但文本／图片／文件三类采集均关闭：44 ms 返回 `ok:true`、`errorCode:null`。
- 再次关闭录入：112 ms 返回相同 `QueueUnavailableError`。

请求通过同一 `history_queue_request → take → reply` 通道，UUID 与回执一致；builtin History 没有显式权限覆盖。相同进程开启录入就通过，证明当前插件身份、声明权限和调用通道均可通过。全部响应远短于 8 秒超时；没有并发旧进程、没有旧 session 延迟回执。原始非秘密证据为隔离目录 `queue-root-cause-before.json`，界面截图为 `queue-recording-disabled-before.png`。

具体根因是 `historyPasteQueueHandoff.allowed()` 仍检查 History 的 `settings.enabled`，并在所有队列请求（包括只读状态）前统一拒绝。这个字段现在只表示暂停后台采集，不能否定用户对既有历史的显式操作。本次与 e790085 修复的旧 owner 晚回执竞态不同；保留那个修复及其拒绝／超时反馈，不吞错误或添加重试。

修复只解除录入开关与队列授权的耦合；继续要求当前可信 bundled History、原声明的三项权限、当前 owner、原生限定窗口和平台检查。插件撤销、权限撤销与定义替换仍使队列失效。录入开关变化不再取消已经显式创建的快照队列。版本为 History 2.0.2，内置包索引 119。

针对性回归先在旧实现复现 `QueueUnavailableError`，修复后验证暂停录入下读取 idle、显式 start、切换录入后仍 ready、cancel、权限撤销仍拒绝；这些步骤不执行粘贴或真实 API。原有 owner 失效、晚回执、超时和权限拒绝用例保留。

真实桌面复验使用隔离 profile、合成文本和实际安装的 2.0.2：录入始终关闭，打开 History 读取 idle 成功（29 ms）；跨搜索选择两条合成文本，点击加入队列，读取 ready／remaining=2 成功（61 ms）；点击取消队列，读取 cancelled 成功（18 ms）。三个回执均为 `ok:true`、`errorCode:null`，读取失败横幅消失。截图为 `queue-recording-disabled-after-{idle,ready,cancelled}.png`，完整非秘密回执在 `queue-recording-after.json`；此次未触发粘贴快捷键。类型、架构、差异检查、前端与原生构建及针对性测试通过。

另有独立的验收环境配置问题：首次启动 driver 未设置 `XDG_SESSION_TYPE`，状态读取已成功，但 Start 正确报告平台不支持。确认实际运行 Xvfb／xfwm4 且具备 XTEST 后，以 `XDG_SESSION_TYPE=x11` 重启 driver 完成上述流程；没有修改或绕过应用平台检查。该问题不是读取状态失败的根因，原回执保留在 `queue-after-platform-preflight.json`。本次验证仅 Linux X11；macOS、Windows、Wayland 未验证。

顺带复核保留策略：条目实际进入回收区后起算 30 天，到期会在后续有界后台维护中永久删除，并按引用数清理图片；不是无限恢复，也不保证恰好到点执行。固定／未纳入的旧记录豁免自动过期，但用户主动删除同样进入该恢复周期。旧库迁移只加保护标记，用户明确纳入后从确认当天重新起算完整保留期，不因升级立即按原年龄删除。恢复撤销原删除计划并重设保留起点。本次只审查代码，不对真实历史执行任何清理。
