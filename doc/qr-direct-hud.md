# 二维码快捷识别 HUD

用户为“识别二维码”Surface 成功绑定全局快捷键后，该快捷键在原生桌面直接读取一次剪贴板图片、本地解码，并将纯文本结果显示在短期 HUD。通过 Launcher 或插件入口打开二维码工作台的既有行为不变；系统不会自动创建或绑定快捷键。

边界：

- 只复用 `qr-code/scan` 已注册快捷键，不新增插件、命令、workflow 或系统权限。
- 读取前复核 bundled 插件身份、当前权限、快捷键与会话 owner。macOS Concealed/Transient 标记在原生剪贴板临界区内拒绝图片读取；公开文本若已判为敏感也拒绝继续读图。
- 沿用图片读取上限：单边 8192、最多 16 Mi 像素、64 MiB RGBA、10 MiB PNG。原生 image handle、canvas 和临时 Blob 只在当前请求内存在。
- 解码只调用本地 `jsQR`；不联网、不预取、不解释协议。URL、HTML 与未知协议均仅作为纯文本显示，不自动打开。
- JWT、`otpauth://`、带密码的 `WIFI:` 及已有 secret / secret-like 分类默认隐藏正文。再次按同一快捷键显式激活专属窗口后才定向发送全文。
- 被动会话最多 15 秒，active 最多 2 分钟。取消、过期、权限或插件变化、共享 HUD 被另一产品接管及 active 失焦都会清空会话；同步解码本身无法中断，但取消后的结果会被代际检查丢弃，不能重新显示。
- 复制只在 active 中由用户明确触发。普通文本通过不记录 Hiven History 的原生写入；敏感文本只尝试平台支持的 concealed 写入，失败时保留结果并显示固定错误，不降级为普通复制。
- 原图、正文、错误细节不进入 store、storage、toast、telemetry、日志或磁盘。该功能不启动 Clipboard History；系统或用户已启用的其它剪贴板管理器不在此能力控制范围内。

最终 Linux debug AppImage 在隔离 Xvfb/Openbox/WebKitWebDriver profile 中通过原生验收。先在既有二维码工作台生成并显式复制合成二维码，再从外部 Mousepad 发送真实全局快捷键：首按显示 420×168 被动 HUD 且外部焦点不变，次按切为 420×480 active，显式复制后 HUD 关闭，外部粘贴逐字得到完整 URL，前后输入哨兵均保留；没有打开 URL 或其它应用窗口，也没有产生 History 数据文件。剪贴板没有图片时显示固定错误，随后换入有效图片可恢复。合成 WIFI 密码在被动态完全隐藏，次按才显示全文，active 失焦立即取消并隐藏。所有资料均为本轮合成数据；没有读取真实用户剪贴板、调用真实 API 或操作用户设备。macOS 与 Windows 尚未实机验证。
