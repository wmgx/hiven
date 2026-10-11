# 权限解析与截图保存的搜索入口

真实桌面审查发现两处入口断点：`Unix权限` / `unix permissions` 不命中仅支持短前缀的动态权限答案；`save screenshot` 虽可打开图片工具，结果标题却是 Image ⇄ Base64，而 `截图保存文件` 不命中。

权限解析增加 Unix 权限、权限解析、Unix permissions 等显式意图，可在原查询后追加八进制值；提示包含中英文示例、编辑查询和 Enter 复制说明。裸 `755` 仍不触发，命令／路径仍不执行。

截图保存意图使用独立搜索条目，标题与说明明确保存剪贴板图片、选择 PNG 位置、复制完整路径。对应 surface 路由复用原 EncodeDecodeSurface 和 ImageBase64Panel，不新增页面或权限；进入后聚焦已有保存按钮，只在用户再次确认后读取／保存。原 Image/Base64 别名保留原标题与路径，保存别名不再重复挂在 Base64 条目上。

版本：Unix Permissions 1.0.1、Encode / Decode 2.7.1，内置索引 120。

## 验证

在原生 Linux X11、隔离 profile、仅合成数据下验证：

- `Unix权限` / `unix permissions` 显示输入示例，`Unix权限解析 755` 得到同一权限答案；键盘 Enter 完整复制解释。裸 `755` 没有权限答案。复制沿用 Launcher 的完成后关闭／清空查询行为，不承诺复制后保存搜索。
- `截图保存文件` / `save screenshot` 各命中一条保存截图结果；`image base64` 仍只有原 Image ⇄ Base64 入口。
- Enter 打开原图片页，焦点在已有保存按钮；Space 触发原生保存对话框，合成 PNG 保存成功、完整文件路径复制成功。
- 返回搜索后 `save screenshot` 查询及原文本 Object Block 保留；图片页没有改写带入的原文。

证据：隔离目录 `/workspace/hiven-native/discover-fixed-results.json` 与 `discover-fixed-{unix-cn,unix-en,unix-value,bare-number,save-cn,save-en,base64,save-open,saved,back}.png`。针对性权限解析回归、类型检查、架构检查、差异检查、前端与原生构建通过。未调用模型，未修改真实设置／历史，未重测其余工具；其他桌面平台未验证。
