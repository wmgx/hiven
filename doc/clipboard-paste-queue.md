# 顺序粘贴队列：会话内核心与接入边界

## 用户语义

在 History 中按选择顺序选择文本，显式加入临时队列。加入时读取完整文本，最多 20 条，总 UTF-8 大小不超过 1 MiB；超限整次失败，不截断。历史之后的编辑、删除不改变已加入的快照。队列不写入后台存储，不读取未选择条目，不自动粘贴。

每次明确按键只尝试当前一条，调用期间重复动作丢弃。只有交付返回 `ok: true` 才推进；仅复制到剪贴板的 fallback 仍算失败，当前条目保留供重试。失败不显示底层原始错误。用户可在已有 History 状态区域查看当前项、剩余数量并取消，HUD 仅显示计数及通用结果，不展示正文、路径或原生错误。

## 核心契约

`queue/clipboardPasteQueue.ts` 提供 `createClipboardPasteQueue({ deliver, owner? })`：

- `replace(snapshots)`：先验证全部快照，成功才替换；无效新输入不破坏旧队列。
- `next()`：只调用一次 `deliver({ snapshot, signal, isCurrent })`。结果为 `delivered`、`failed`、`stale`、`busy` 或 `empty`。
- `getSnapshot()` / `subscribe()`：不可变状态包含版本、阶段、忙碌、总数、成功数、剩余数及当前完整条目。
- `cancel()` / `dispose()`：撤销未完成请求的 owner，释放队列文本；销毁时解除订阅。

取消、替换、owner 变化后的晚回执不消费新旧队列。旧 transport 尚未 settle 时，即使已经取消或替换，仍保留排他标志，防止新旧剪贴板写入交叠。接入方必须让取消请求最终 settle，并在剪贴板写入和原生目标交接前检查 `signal` / `isCurrent()`。已送到外部应用的按键不能回滚；取消不声称撤回已送达内容。

`queue/readClipboardQueueSnapshots.ts` 提供完整读取事务：开始时复制选择 id/hash；完整读取后再次读取新索引，验证没有被编辑或删除。选择变化、离开页面和 owner 变化必须让 `isCurrent` 失效。失败保留 History 原选择，允许重试。

## 已集成的受限入口

`src/historyPasteQueueHandoff.ts` 在长期存活的 Launcher 中持有队列。History 仅取得绑定当前 bundled definition 与 surface owner 的桥；原生只允许 Launcher 和指定 History 窗口发起该协议，不接受其它插件或任意目标。状态广播只有会话、版本、计数和条目 ID，不含正文。取消、权限变化、设置禁用或插件 definition 替换会使旧请求失效。

`src/hotkeys/pluginSurfaceShortcuts.ts` 在原 surface 快捷键回调打开窗口之前截获显式队列。已有 History Control+Shift+V 时复用原注册，否则尝试临时注册；冲突明确失败，不抢占。按下/释放锁避免同一次长按反复尝试；注销失败保留同一释放句柄以便重试。完成或取消释放临时注册，复用注册则恢复原开窗语义。

首版仅 Linux X11 可启用；macOS、Windows、Wayland 明确提示不支持并保留选择。每次按键捕获当前已确认的外部 X11 窗口，等待键盘释放，并在剪贴板写入及发送按键前重验目标。不会激活其它窗口、把 HUD 当作目标或猜测前台应用。每次只送一条，不加自动分隔符。

## 验证

定向逻辑覆盖完整保序、失败不推进、长调用期间重复动作、取消与替换晚回、owner 变化、读取时删除/编辑、UTF-8 上限及错误内容隐藏。`test:history-queue-handoff` 运行真实组合层与队列核心、模拟 IPC，覆盖插件替换和权限撤销；原生单元检查限制和状态格式。

隔离 Linux X11 原生实测已通过：在三次搜索中选择三条合成全文 → 加入队列 → 返回 Mousepad → 三次 Control+Shift+V，逐次将外部编辑器全文复制出来核对顺序与原文。长按超过键盘等待期限时失败，HUD 显示 0/3、正文不可见；松开重试仍交付第一条全文。Hiven 前台拒绝交付且不写剪贴板。再次打开 History 能刷新进度；取消后临时 Control+Shift+V 注册已释放。

本隔离 profile 原来没有配置 History 全局快捷键，因此“复用已配置键后恢复原开窗”仅覆盖代码路径审查，未声称该分支有原生验收。macOS / Windows 未做实机验证。
