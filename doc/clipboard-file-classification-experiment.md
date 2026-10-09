# 剪贴板文件分类实验

- 基线：`dot/ai-reliability` / `7ee7742a29b4a7f3723350317bc18d41e7a62fee`
- 实验分支：`dot/clipboard-file-classification`，独立 worktree，与主开发分支分离
- 目标：普通路径文字不要冒充文件对象；不删除历史；保留明确选择/读取文本文件的路径

## 查明的问题

1. 历史记录的文件分类与原生文件对象无关。
   - `src/workspace/pluginClipboard.ts` 的 `extractFilePaths()` 只检查每行前缀 `/`、`~/`、Windows 盘符、UNC。
   - `watch()` 对这些普通剪贴板文本发出 `kind: 'files'`，不核对来源、是否存在、是否目录。
   - 因而 `/开头正文`、不存在的路径、目录等都会变成“文件”；带空格路径被接受，多行要求每行都像路径；`file://` 反而不属于这套历史分类。
2. “复制文件/粘贴文件”并没有复制文件对象。
   - `createPluginClipboard().writeFiles()` 与 `createPluginPaste().pasteFiles()` 都仅将路径按换行连接并写为文字。
3. Launcher 是另一套规则。
   - 基线 `detectClipboardFilePath()` 根据扩展名猜 JSON/CSV 等；甚至 `https://example.test/report.json` 也可能先被当作文件路径。
   - `readLauncherClipboard()` 在原生返回多个路径时只取第一条。
   - `resolveSurfaceInitialText()` 与推荐动作的 `open-plugin-surface` 会在用户打开工具时按路径猜测调用 `read_file`。这不同于用户点击“读取文本文件”：原材料可能在无明确文件读取选择时被替换。
4. 当前基线的原生边界有限。
   - `src-tauri/src/lib.rs::read_clipboard_file_paths` 只有 macOS 分支读取 pasteboard；当前 Linux/Windows 分支返回空列表。
   - macOS 优先 `NSFilenamesPboardType`；`public.file-url` 后备只构造一个字符串，不能据此承诺多文件 URI 列表完整支持。
   - 以上为该提交的源码结论，不是所有版本的永久平台能力判断。本实验没有 macOS/Windows 真机验证。

## 最小实验取舍

- 剪贴板历史停止请求 `files` 捕获，只记录用户启用的文本和图片。路径文字按原文保存，空格和换行不改写。
- 去掉历史“文件”筛选、独立 Launcher 发现入口和“记录文件路径”开关。
- `recordFiles` 旧设置字段、`files` 旧存储结构保持兼容，不迁移、不清空、不删除历史。
- 旧 `files` 记录仍在“全部”和“文本”中可见，标签为“文件路径”，操作明确写“复制路径/粘贴路径”。旧 surface 路由转到文本视图，避免已有快捷入口失效。
- Launcher 中路径/文件名本身保持文本，不凭扩展名附成结构化内容或读取文件。支持的绝对路径仍可作为文本材料附加，以保留明确“读取文本文件”入口；裸文件名不会触发。HTTP URL 不进入本地路径探测；原生返回的多个路径保留全部。
- 打开工具只传递当前材料原文；明确“读取文本文件”操作及文件选择器保持可用，并继续使用原有有限大小、UTF-8、普通文件检查与错误恢复。
- clipboard-history 最终发布版本为 `1.4.4`，内置索引为 `97`，确保新代码被实际释放。

没有新建原生文件捕获能力，也没有删除通用 clipboard SDK 的旧 files 事件/写入接口。此实验仅停止历史插件使用不可靠的推断分类；兼容旧记录和其它调用方。

## 验证

### 已完成的合成生产模块测试

新增 `npm run test:clipboard-file-classification`，执行实际 `pluginClipboard`、历史 background、repository/store/cache；只用内存存储、合成字符串和 mock IPC，不读系统剪贴板或真实历史。

- 16 组：文件路径、目录形状、不存在路径、空格、首尾空白、LF/CRLF 多行、file URI、HTTP URL、Windows/UNC/tilde、中文正文、混合多行、裸文件名。
- 全部按原文存成 text；不会新增 files 项。
- 保留合成旧 files 项的完整内容和索引可见性。
- 文本记录关闭时，即使旧 recordFiles 为 true 也不会继续记录路径文字。
- 原生多路径结果全量保留；HTTP URL 不触发原生文件路径查询。
- 同一脚本在基线生产模块上第一条 `/synthetic/report.json` 即失败，在实验实现上全部通过。

相关测试通过：
- `test-file-text-material.mjs`：保留明确 picker/文件读取，重复点击、取消、关闭、替换、晚到返回、失败重试、材料身份与原文传递
- `test-clipboard-object-block.mjs`
- `test-clipboard-history-settings.mjs`
- `test-clipboard-history-storage.mjs`
- `test-clipboard-content-kit-bridge.mjs`
- `test-clipboard-object-block-mvp-closure.mjs`
- `test-builtin-plugin-release.mjs`
- TypeScript、architecture、前端 production build、diff whitespace 检查

已有 `test-clipboard-history-integration.mjs` 在基线和实验中都先失败于过时的 `launcher: true` 源码断言，实际入口早已使用 `launcher: { surfaces: ['global-launcher'] }`。不将此失败标为本实验新回归，也不声称完整历史聚合套件通过。

### 真实 UI：首轮 c47658c 已完成

2026-10-09 16:49–17:11 UTC，官方 debug AppImage / 正常 Xfce 桌面流程；全新隔离 profile，纯合成夹具，未读取或复制用户真实历史。实际释放目录确认 clipboard-history 1.4.3。此轮测试只覆盖该代码版本，不替代末版定向验证。

- 真实复制不存在的 `.json` 路径和 `/notes` 开头正文，均归入 Text，没有 Files 筛选。
- 两条旧格式合成 files 记录在 All/Text 都可发现，标 File paths；完整含空格路径准确粘入新 Mousepad 文档，未变 URI、未截断。
- 主历史开关仍开启时关闭 Record text，复制新的唯一路径，约 15 秒后 All 仍原 5 条，未录入该路径。之后恢复 Record text。
- 复制绝对文本文件路径后，当前材料仍是完整路径文字；只有点击明确的读取动作后才出现合成中文正文。
- 原生 picker 取消保留原材料；重开选择 data.json 后显示正确 JSON 正文。
- Linux Thunar 对合成文件执行一次真实 Ctrl+C，Launcher 无材料块、History 无新记录/更新时间；旧同路径文本项的时间仍属于此前 Mousepad 路径复制。因此该环境的原生文件对象复制没有被捕获，不能声称已支持，更不外推 macOS/Windows。
- 初次设置页的两次 AX 点击只聚焦；关闭重开并按新截图真实坐标点击后设置正常出现。无法区分重开与 AX/坐标差异，未据此认定产品缺陷。
- 首轮 QA 进程已正常停止；profile/合成文档保留，无后台继续采集。

代表证据：
- `04-new-paths-as-text.jpg`：新路径 Text 与旧 File paths 同页
- `05-legacy-complete-path.jpg`：完整含空格路径交付
- `06-record-text-off.jpg` / `07-off-sentinel-absent.jpg`：关闭状态与检查后的列表，时序结论另有实际操作记录支持
- `08-path-read-action.jpg` / `09-path-before-read-body.jpg` / `10-explicit-file-body.jpg`：路径 → 明确读取 → 正文
- `11-picker-json-body.jpg`：picker 读取实际正文
- `13-thunar-no-new-capture.jpg`：Linux 原生复制未产生新捕获

### 最后窄批

首轮设计复核只留下路径呈现和读取文案问题；另确认基线也存在路径形状抢先于敏感/命令内容检测的问题。仅合批以下修正，不扩充平台实现：

1. 移除文件名扩展对内容分类的抢判；现有 sensitive-content 信号优先于路径拼写和更高置信度 URL/JSON。添加 4 组纯合成敏感形状测试，核对遮罩、无预览、不提供猜测路径读取；另保留 command 识别。
2. 旧路径预览完整换行，可滚动/选择；仅旧 files 的列表和详情不再显示 Size。旧值只是历史路径字符计数，不是文件大小。详情仅类型/路径条数，text/image 的统计与来源保持原样，存储字段不迁删。
3. 读取动作明确命名为 `Read file contents` / `读取此路径的文件内容`，不增加面板。

末版代码 `0045742` 已完成上述 3 点定向 UI 复核（2026-10-09 17:21–17:26 UTC），没有重跑首轮已过流程。官方 debug AppImage 编译/打包成功，实际释放目录确认插件 1.4.4 与新样式/精简元数据代码。

- 900×640 实际界面中，旧路径完整换成两行；旧路径记录的列表及详情均无 Size，详情仅类型/路径条数。
- `Read file contents` 文案可见，点击后仍正确读取合成中文正文。
- 清除旧材料后复制固定的合成敏感形状，Launcher 显示 `Content hidden`，未露该假值，没有把它当 JSON 自动推荐或提供路径读取入口。这是 Launcher 分类/遮罩的验证，不是“历史自动不存敏感内容”的保证。
- 定向生产模块测试、TypeScript、architecture、前端 build、官方 native AppImage、diff whitespace 检查通过。没有新增 macOS/Windows 或原生多文件复制实现。
- 末轮 QA 进程已正常停止；云桌面剪贴板换回普通合成哨兵，测试历史不会继续采集。合成 profile 和工程验收截图保留在测试环境中，不进入 Git 提交。

末版代表证据：`f01-0045742-legacy-wrap.jpg`、`f02-0045742-read-label.jpg`、`f02b-0045742-read-body.jpg`、`f03-0045742-synthetic-mask.jpg`。

## 建议

保留去掉独立文件分类的方案：历史中的路径按文字处理，旧记录可见且明确是路径，文件内容通过明确操作读取。当前 Linux 原生文件对象复制仍未捕获；明确的文本文件 picker 和读取路径继续可用。实验独立于主开发分支，不合并或发布应用。
