# 原生 HUD 与 History 集成验收

本批在隔离 Linux X11 桌面（Xvfb / xfwm4）运行内嵌生产前端的 Tauri AppImage，通过 WebKitWebDriver 与真实系统键鼠操作验收。外部目标为隔离 Mousepad；所有输入均为合成文本和图片，没有访问真实用户历史或调用真实 API。没有发布应用或部署。

## HUD

仅在普通 Hiven 窗口都不可见时显示一个不可聚焦、置顶、鼠标穿透的临时窗口。普通窗口可见时沿用现有 toast；带恢复操作的通知仍留在原窗口可供查看。HUD 接收固定等级、语言/主题、截止时间，以及可选的受限数字计数，不接收原始通知文本、路径或剪贴板正文。

已实测 Launcher 当前全文复制成功 HUD；外部编辑器在提示前、中、后输入的合成字符串连贯且完整，焦点不变。截止后检查原生窗口 `is_visible=false`。队列长按交付失败产生错误 HUD，显示 0/3 和剩余数量，不展示正文；随后重试成功。普通可见窗口通知没有额外显示 HUD。截图已查看。

验收发现并修复：Linux 首次创建需避开 UI 线程上的同步 WebView 创建；鼠标穿透必须在首次 show 完成 GTK 窗口创建后设置，否则 Tao 对未创建 GdkWindow 解引用会崩溃。状态锁现不跨窗口 API 调用，晚 ready、取消、过期、owner 变化有身份与顺序检查。保留无正文的固定阶段原生 telemetry 供跨平台排障。

macOS / Windows 的焦点、透明背景和多显示器位置没有本批实机证明；Linux 验收不替代这些平台验证。

## History 与队列

固定/编辑/纯文本验收见 `clipboard-history-quick-actions.md`；三次跨搜索选择、逐条全文交付、失败重试、取消释放的原生验收见 `clipboard-paste-queue.md`。仍使用原选择区、预览区与底部状态区。

隔离 History 原设置在结束时恢复为 enabled=false、recordText=true、recordImages=true、recordFiles=true；临时通知 fixture 已禁用，队列取消，临时快捷键释放。

## 检查范围

应用 TypeScript 检查、架构边界、diff check、生产前端构建、原生构建及新增关键逻辑检查通过。本批未运行整个历史测试集。此前检查发现 `test-current-text-delivery.mjs` 的 VM mock 缺少现有 `pasteRecovery` 依赖，并沿用“原生粘贴失败关闭会话”的旧断言；未为使测试变绿而改回该过时行为。
