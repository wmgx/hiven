# HUD 单次翻译

本功能以用户已经明确复制的公开文本为输入，通过翻译 Surface 已绑定的快捷动作启动单次会话；不打开 Launcher 或翻译页面。首期只允许 readiness 已确认且支持真实 AbortSignal 的 AI profile。传统网络翻译尚无底层取消协议，不进入该入口。

产品边界：

- 读取前先确认 profile、provider、model 与权限可执行；未准备好时不读剪贴板。
- 读取一次公开文本后复用现有 secret / secret-like 分类，敏感、空、含 NUL 或超限输入不发送且不进入 HUD。
- 源文、完整译文与 provider 错误只存在单会话内存，不进入 toast、telemetry、历史或磁盘；HUD 只接收限长预览和固定状态，复制使用未截断的完成结果。
- 一次只有一个会话。运行中或结果态再次触发都会进入 active，不取消翻译。新会话、取消、过期和关闭均使旧 delta、完成与错误失效。
- 普通 `toast-hud` 保持原固定回执、不可聚焦和鼠标穿透协议。翻译使用独立 `translation-hud` 与独立 capability / focus lease。
- active 只提供复制全文与关闭/取消，不自动粘贴、替换原文、保存历史或创建 workflow。

当前 `HudTranslationSession` 已完成合成执行器逻辑验证；原生窗口、快捷键接线和真实 UI 验收尚未完成，因此本分支不得推送。macOS 目标窗口与焦点恢复未做实机验证。
