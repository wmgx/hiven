# 不支持平台的选区读取提前拒绝

## 实际问题

Linux X11 的 SHA-256 空输入页原本显示可执行的“读取前台选区”。2026-10-10 在合成 QA 中，先将固定 `qa-selection-sentinel-1424` 复制到剪贴板，再仅点击一次：窗口先隐藏，随后恢复为全黑/空 Web 容器；稳定检查未看到错误消息或输入页。该证据证明这条用户路径未正常恢复，不证明持久草稿丢失，也未定位 WebKit 的底层原因。

源码原顺序为隐藏窗口、读取剪贴板、尝试平台复制；Linux 最后一步必定报不支持。JS 原先将错误归为一般失败并重新显示窗口。

## 最小修复

原生命令在非 macOS/Windows 分支立即返回 `SELECTION_CAPTURE_UNSUPPORTED`，在 paste recovery 失效、隐藏、焦点交接和剪贴板读取之前结束。新增只读平台能力查询仅表示可尝试，不表示已授予平台权限。

现输入页 footer 在不支持、未知或能力查询未完成时显示短手动粘贴说明，没有可执行的假捕获动作；普通浏览器和验证 relay 也不会冒称支持。旧 TS 调用同样先预检，并精确分类原生不支持返回，不恢复从未隐藏的窗口。

macOS/Windows 原有捕获和 trim 行为保留。直接 tool adapter 捕获失败后使用空输入的旧合同未改变。本批不实现 PRIMARY、Linux 模拟复制、新权限、自动观察或新的选区接口语义。

## 验证与限制

针对实际捕获/runtime/adapter 的脚本覆盖 Linux、未知平台、浏览器、relay 不调用 hide/read/restore，稳定原生拒绝不误恢复，以及受支持平台成功/空值/权限错误的原恢复与 trim。原生 cfg 分支的静态检查核对副作用在受支持分支；独立审查复跑通过。test:launcher-material-edit 通过。

现有 test:self-learning-pr1 的静态源码断言与既有 showPluginSurfaceWindow 第二参数不符；本批未修改该路径，不将此脚本列为通过。

300ms 能力查询超时会保守降级为手动输入，入口资格变化或重挂才重查。不声称全部 Mac/Windows 真实环境已验，也不宣称黑屏底层原因已修复。代码 `4ad43c3` 的 typecheck、architecture、Vite 和官方 Tauri debug AppImage 构建均通过，最终真实界面结果如下。


## 最终真实界面

旧合成 QA 16839 正常结束后，末包 `4ad43c3` 启动新进程17165。SHA-256空输入页同一footer显示“选区读取不可用 · 请手动粘贴文本”，没有可执行的读取选区按钮，也未新增面板。

同页逐键输入固定 `qa-manual-1439` 正常预览；清空后 Ctrl+V 精确取得本轮合成 Mousepad 明确复制的 `qa-selection-sentinel-1439`。窗口保持正常显示，随后正常返回 sha256 搜索。没有再次调用旧必失败入口或读取真实外部内容，没有执行结果交付。协调者亲看三张截图，提示和操作布局完整。

本地证据目录 `selection-manual-4ad43c3` 含空输入、手动粘贴预览、返回搜索三态。结论限定平台能力真实表达与手动替代路径通过；不声称已支持Linux选区读取、修复WebKit根因，或验证macOS/Windows真实选区。
