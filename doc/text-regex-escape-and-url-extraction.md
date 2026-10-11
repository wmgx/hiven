# 正则字面转义与 URL 提取

复用 line-tools 文本工作台，不创建新页面或独立复制系统，插件版本 3.2.0。

## 正则转义

搜索“正则转义”/“escape regex”进入同一个工作台并选中操作；编辑器动作也可调用同一纯算法。`a.b` → `a\.b`。转义 `\ ^ $ . * + ? ( ) [ ] { } | /`，CR/LF/Tab 等变为模式转义序列，保留 Unicode 文本。输出是独立字面正则模式，不是 JavaScript 字符串字面量、不加引号、不二次转义。它不用于直接拼接到字符类或另一个转义序列尾部。

产品只做字符串变换，不编译或执行模式。空输入保留工作台空态、复制不可用；编辑器空输入返回说明，不改原文。原复制按钮完整复制结果，保留既有交付失败与取消行为。

## URL 提取

继续使用既有“提取链接 / 邮箱”入口及预览，默认去重改为关闭；已保存动作中显式设置的去重值仍然生效。文本工作台 URL 分类也新增“提取 URL”操作，无第二个同义搜索入口。

只提取显式 HTTP(S) 目标，按出现顺序每行一个，默认保留重复。完整输入扫描，结果不截断。无匹配返回现有错误状态，源文可继续修改，不覆盖剪贴板。

Markdown 仅本地词法分析，使用正式直接依赖 marked 14.0.0（锁文件固定包与 integrity）。普通文本使用既有 URL 边界扫描，支持嵌套成对括号、句末标点与中文标点。Markdown 行内/引用式链接、图片链接与自动链接提取目标，不把标签、alt、title 字段里的 URL 当目标；引用多次即保留多次。普通标题行仍按正文处理。保留 URL 大小写和转义拼写，不用 URL.href 重写。不是完整 HTML 网页爬取器。

不渲染 Markdown、不请求 URL、不加载图片、不执行任何协议。ftp、file、javascript、data、mailto 等目标不产生 HTTP(S) 结果，且不从被拒绝的链接标签中回收 URL。

本地验证：

- `node scripts/test-regex-escape-and-markdown-urls.mts`
- `node scripts/test-text-list-extraction.mjs`
- `node scripts/test-text-workbench-model.mjs`

逻辑验证覆盖元字符/换行/Unicode、模式精确匹配、Markdown 标题排除、重复/顺序、完整长 URL、错误后恢复。原生实际画面、复制与键盘验收由集成者统一执行。

2026-10-11 原生验收：正则元字符、换行、反斜杠和 Unicode 输出完整复制；工作台 URL 分类中提取 Markdown 目标、图片目标和重复 URL，排除标签/title URL，保持顺序，复制到外部 Mousepad 再取回全文一致。未访问任一合成 URL。
