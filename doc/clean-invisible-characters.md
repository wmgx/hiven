# 清理不可见字符

`line-tools` 3.7.0 在现有文本工作台增加显式“清理不可见字符”操作及中英文搜索入口。用户选择后才实时预览；不自动读取剪贴板、不默认清理、不串联去重，也不覆盖输入。复制、粘贴、使用结果继续处理及带回搜索均复用工作台现有交付动作。

## 固定转换范围

- `U+00A0 NO-BREAK SPACE`、`U+202F NARROW NO-BREAK SPACE` 转为普通空格 `U+0020`。
- 删除 `U+200B ZERO WIDTH SPACE`、`U+00AD SOFT HYPHEN`。
- 其他字符逐字保留，包括 ZWNJ、ZWJ、组合字符、变体选择符、双向控制符、BOM、Tab 及 CRLF／CR／LF。

这些目标字符也可能承载语言或排版意图，因此转换仅是用户明确选择的可预览操作。结果区只在该操作有输入时显示两类计数；没有目标字符时明确显示未发现，不增加常驻规则说明。转换本身不做 Unicode 规范化，不改引号、破折号、段内断行、空行、顺序或重复项。

该入口只是工作台 route，不注册为 tool，不进入 Saved Action、自学习或工作流，也不新增权限、HUD、原生接口或后台行为。

## 验证范围

纯逻辑覆盖四个目标码点、精确计数、空输入，以及 ZWJ emoji、ZWNJ、组合字符、双向符、BOM、CRLF 和 Tab 的逐字保留。工作台模型覆盖搜索入口、初始操作、结果元信息及不注册 learnable tool。

最终 Linux Tauri 原生 UI 验收已于 2026-10-15 09:44:49–09:44:52 UTC 完成：使用仓库最终 `npm run build` 产物，经官方 Debian sysroot 执行 `tauri build --debug --no-bundle`，再用 Tauri bundler 生成 debug AppImage。验收从该 AppImage 启动原生 launcher，并由 Tauri WebDriver 驱动 WebKit 页面；运行时确认存在 Tauri bridge、不存在 browser bridge，加载的最终前端资源为 `index-BFWZxWO9.js`。加载顺序为原生 launcher → 显式粘贴合成文本 → 搜索并选择 `Clean Invisible Characters` → 工作台预览 → 现有交付动作。

真实 UI 流程验证了：两类计数分别为 2，结果保留 8 行重复内容；键盘可到达并触发“使用结果继续处理”“带回搜索”和“复制”；使用结果后出现无变化提示；带回搜索得到完整结果。复制结果后还实际聚焦隔离 Xvfb 中的 Mousepad，粘贴并保存，文件内容与预期逐字相同。第二组文本通过原生剪贴板往返验证 CRLF、Tab、ZWJ、ZWNJ、变体选择符、组合字符、双向控制符及 BOM 均未改变。输入和剪贴板均为隔离环境内的合成数据；没有真实 API、用户剪贴板或用户机器参与。macOS 不在本次验证范围。
