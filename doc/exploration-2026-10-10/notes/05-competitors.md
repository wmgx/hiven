# 竞品研究报告：同类前沿产品的解法提炼（05-competitors）

> 面向 Hiven（launcher-only 精确文本工作台：全局唤起 → 文本变换/处理 → 结果交付）的竞品研究。
> 研究方法：只用官方一手资料（官网、官方文档、官方手册、官方 GitHub 仓库/文档库）；凡引用二手转述处已明确标注；未实际运行任何竞品（多数为 macOS/Windows 专属，本机为 Linux 且无 live browser），所有"完整流程"均来自官方文档描述，归为"文档推断"，非真实体验。

## 验证状态总览

| 产品 | 一手资料来源（已打开） | 流程验证状态 |
|---|---|---|
| Boop | 官网 https://boop.okat.best/；官方脚本开发文档（IvanMathy/Boop 仓库） | 文档推断，未运行 |
| DevToys | 官方 README（DevToys-app/DevToys）；官方扩展文档库（Smart Detection、CLI） | 文档推断，未运行 |
| CyberChef | 官方 README（GCHQ 仓库内容）、live demo 页（JS 未渲染，仅读到设置项） | 文档推断，未实际操作页面 |
| Raycast | 官方手册 manual.raycast.com（search-bar、settings、ai-chat） | 文档推断，未运行（macOS/Windows 专属） |
| Alfred | 官网 universal-actions 页；官方 gallery 仓库 workflow 说明 | 文档推断，未运行（macOS 专属） |
| uTools | 官网 https://www.u.tools/、官方文档站（SPA 未渲染出正文）；插件作者文档转述其官方插件匹配机制 | 机制描述为二手转述，待验证 |
| Flow Launcher | 官方文档站（SPA 未渲染出正文）；其 GitHub README（经 fork 镜像转述） | 机制描述为二手转述，待验证 |

---

## 一、Boop（okat.best）—— Hiven 的直接灵感来源

**一句话定位**：本地优先的"文本暂存处 + 一键变换"：粘贴文本 → 选一个 JS 脚本 → 文本原地被替换，主打"别再把公司机密粘进随机网站"。

**解决的核心问题**：开发者每天都有"把一段文本变个形"的需求（JSON 格式化、URL 解码、算 MD5、转大小写……），替代方案是：搜"json formatter online"把数据贴进陌生网站（泄密风险），或为这点小事打开编辑器/写一次性脚本（启动成本高）。Boop 给的是一个常开的便签式窗口，一切在本地完成。

**完整任务流程（文档推断）**：
1. 把文本粘进 Boop 编辑器（或选中已有文本）；
2. 调出脚本列表（第三方克隆 Boop-GTK 称是 Ctrl+Shift+P——官方已读文档未写明默认热键，待验证）；
3. 模糊输入脚本名（脚本元信息里的 `tags` 参与排序，`bias` 可调权重）；
4. 回车执行 → 文本原地替换；脚本可通过 `postInfo()`/`postError()` 在工具栏给出一行反馈（如"移除了 N 行"、"XML 非法"）；
5. 复制结果出去（或继续用下一个脚本）。

**脚本模型（官方 CustomScripts.md，IvanMathy/Boop 仓库）**：
- 单个自包含 `.js` 文件，头部 `/** {...} **/` 注释里放声明式 JSON：`api`、`name`、`description`、`author`、`icon`、`tags`，可选 `bias`；
- 必须声明顶层 `main(state)`；`state` 是对编辑器的代理对象：`fullText` / `selection` / `text`（无选区时退化为全文）三个属性，`insert()` 在光标处插入/替换选区；
- 沙箱：唯一的数据出入口就是 `state` 对象，不能弹 UI、不能改 Boop 行为；运行环境是 JavascriptCore 子集（无 window/process/Crypto）；
- 性能设计：脚本常驻自己的 VM 保活，属性是动态 getter（大文本不传不需要的部分）；多选区时 `main` 会被多次调用。

**比 Hiven 好的环节、为什么**：
- **扩展成本极低**：加一个个人变换 = 丢一个 `.js` 文件进目录。Hiven 的插件是完整 framework 插件（React/TS），个人"就差一个小变换"的长尾需求会被挡在门外。Boop 证明了"单文件脚本层"可以和"完整插件层"共存。
- **元信息即发现机制**：`tags` + `bias` 让脚本在模糊搜索里可被找到、可被排序，不需要单独的插件管理 UI。Hiven 的 Object Block + intent ranking 是同一问题的更重的解法，值得对照。
- **行内反馈而非弹窗**：`postInfo/postError` 在工具栏给一行字，变换类任务的错误（"XML 非法"）用这种轻量通道最合适，不打断流程。

官方出处：
- https://boop.okat.best/（定位与隐私主张）
- https://github.com/IvanMathy/Boop/blob/main/Boop/Documentation/CustomScripts.md（脚本模型）

---

## 二、DevToys（Microsoft 生态，DevToys-app）—— 开发者瑞士军刀

**一句话定位**：30 个开箱即用的微型工具合集（转换/编解码/格式化/生成/测试/文本），核心卖点是剪贴板感知（Smart Detection）：复制一段 JSON，打开它，JSON 格式化工具已经被高亮且输入自动填好。

**解决的核心问题**：和 Boop 同一问题，但解法是"工具箱"而非"脚本"：把开发者每天要用的几十个小工具做成统一设计语言的常驻应用，替代散落在各处的网站和命令行记忆。

**完整任务流程（文档推断）**：
1. 复制待处理文本（Smart Detection 在后台用轻量 detector 解析剪贴板：JSON/XML/图片/文件……2 秒预算，可在设置关闭）；
2. 打开 DevToys，导航栏里适配的工具被"灯泡"图标高亮；
3. 点进工具 → 剪贴板内容已自动填入输入框；
4. 输出实时生成；部分工具的只读输出框旁也有灯泡 → 一键把输出"送给"下一个工具（如 JSON 格式化 → 转 Base64 → 生成二维码），形成链；
5. 复制结果。

**组织与扩展机制（官方资料）**：
- 工具按组陈列：Converters / Encoders-Decoders / Formatters / Generators / Graphics / Testers / Text Utilities；官方 README 明确 "DevToys 2.0 comes with 30 default tools"，更多经扩展获得，可自己开发（http://devtoys.app/doc）。
- Smart Detection 的实现（官方扩展文档）：工具实现 `IGuiTool` 并声明接受的数据类型（`AcceptedDataTypeName`）；平台用 `IDataTypeDetector` 做类型检测，支持类型继承层级（Text → JSON…），检测器必须轻量、2 秒内取消、尊重用户关闭开关。
- **CLI 对等**：DevToys.CLI 把每个工具暴露为命令（`devtoys.cli jsonf`、`b64`、`hash`……带别名），用于无 GUI 的服务器/CI；扩展也可实现 `ICommandLineTool`。
- （二手转述）官方商店描述经媒体引用：Compact overlay 可让窗口保持小巧置顶——"随手"形态的官方背书。

**比 Hiven 好的环节、为什么**：
- **内容感知是"推荐+填充"一体**：不只推荐动作，还把输入自动填好，省掉"复制→唤起→粘贴"三步中的粘贴。Hiven 有 Object Block + intent ranking，但若推荐后仍需用户手动粘贴文本，感知只做了一半。
- **工具间转交是显式 affordance**：输出框旁的灯泡 = "把这个结果送去下一个工具"，链式操作不需要用户复制粘贴。Hiven 的"结果继续处理"在同一 launcher 会话内是成立的，但缺少一个一眼可懂的"送往下一步"入口。
- **GUI 与 CLI 同源**：同一变换能力既在窗口里也在终端里，开发者可以在脚本/CI 里复用。Hiven 若只做 launcher 形态，会错过"把变换写进脚本"的开发者习惯。

官方出处：
- https://github.com/DevToys-app/DevToys（定位、30 工具、扩展）
- https://github.com/devtoys-app/documentation/blob/HEAD/articles/extension-development/guidelines/UX/support-smart-detection.md（Smart Detection 机制）
- https://devtoys.app/doc/articles/extension-development/guidelines/command-line-tool.html（CLI 扩展模型，经官方 issue 转述确认存在）

---

## 三、CyberChef（GCHQ）—— "配方"链式操作模型

**一句话定位**：浏览器里的文本/数据"配方"工作台：左列是数百个操作，中间把操作拖成一条链（recipe），右上贴输入、右下看输出，改任何一处输出即时重算。

**解决的核心问题**：安全分析师面对"套了好几层编码/加密/压缩的未知 blob"：传统做法是写一次性脚本层层剥，调试靠 print。CyberChef 把"多步变换"变成可视化的流水线，每一步的中间结果都可见、可断点、可单步。

**完整任务流程（文档推断）**：
1. 打开页面，输入框粘贴/拖入文本或文件（最大 ~2GB）；
2. 左侧搜索或浏览操作，拖进中间 recipe 区，填参数；
3. Auto Bake：输入或 recipe 任何改动 → 输出立即重算（大输入可关）；
4. 对未知编码点"Magic"图标 → 自动检测并解开多层嵌套编码；
5. 可在任意操作设断点、单步看每步的数据形态；高亮输入某段字节，输出对应位置联动高亮；
6. 复制输出 / 保存 recipe 到本地 / 复制 URL（recipe+输入都编码在 URL hash 里）分享给同事，对方打开即复现。

**关键机制（官方 README）**：
- 四区布局：input（右上）、output（右下）、operations（左，分类+搜索）、recipe（中，拖拽+参数）；
- Deep linking：`#recipe=Operation()&input=...`（input 为 Base64），配方可分享、可复现；
- 全客户端：数据不出浏览器，可下载离线单文件版、Docker 自托管；
- 贡献新操作"非常简单"：会写基础 JS 就能写一个操作（quickstart 脚本引导）。

**比 Hiven 好的环节、为什么**：
- **链式任务的"中间可见性"**：Hiven 的"结果继续处理"是线性单步的；CyberChef 让整条链同时可见、每步可调、错误定位到某一步。这对"先解码再格式化再提取字段"这类真实任务是质变，不是多几个功能。
- **Magic：一键处理"我不知道这是什么编码"**：规则写不全的场景，用启发式检测兜底。Hiven 的内容感知若只做确定性类型判断，会在这个长尾上失灵。
- **URL 即分享**：配方+输入编码进 URL，协作零成本。Hiven 若有"配方"概念，deeplink 分享是最便宜的传播方式。

官方出处：
- https://github.com/gchq/CyberChef（官方 README；本次经 fork 镜像读取，内容为官方 README 原文）
- https://gchq.github.io/CyberChef/（live demo；本次仅渲染出设置页文本，操作区为 JS 应用未能读取——流程描述以 README 为准）

---

## 四、Raycast —— 全局入口的交互细节（只取文本处理相关）

**一句话定位**：键盘优先的 macOS/Windows 全局入口；与文本处理相关的精华是：无匹配时的 Fallback 路由、Tab 即问的 Quick AI（回答可回车填回原应用）、no-view 热键命令抓取前台选中文本、AI 模型来源可替换（本地模型/订阅透传/自带 key/自建端点）。

**解决的核心问题（文本相关子集）**：用户在任何应用里遇到一段文本想处理（翻译、总结、改写、查词），不想"复制→切应用→粘贴→处理→复制→切回→粘贴"。Raycast 让动作发生在一次热键里，结果直接回到原上下文。

**完整任务流程（文档推断，以"翻译选中文本"为例）**：
1. 在任意应用选中文本；
2. 按全局热键（如社区 Easydict 扩展的 `⌥A` 触发其 `Translate Selection`——一个 no-view 命令，每次热键都重新执行并抓取前台选中文本；官方手册的对应原生能力是 Screen Awareness 的 `Send Selected Text to AI`）；
3. 翻译视图直接打开、选中文本已填入；
4. 回车 → 结果按配置复制或粘回原应用。
   - 另一条路径：在 Root Search 里打字无匹配 → Fallback Commands 出现在结果底部 → 回车把整段输入送给 Quick AI/Easydict；或打字后按 `Tab` 直接进 Quick AI，回答在同一窗口流式出现，回车粘贴到之前聚焦的应用，`⌘J` 可转入完整 AI Chat 续聊。

**官方手册确认的关键细节**（manual.raycast.com）：
- **Fallback Commands**（Settings → Launcher）：查询无匹配时，结果底部出现的可配置命令，可拖拽排序、可删减——"无结果"不是死胡同，而是一次路由。
- **Root Search 排序**：frecency（频率×新鲜度）+ 别名精确匹配优先；`Esc` 清空/关闭行为可配置；Action Panel（`⌘K`）可给任意命令配热键/别名/复制 deeplink。
- **AI 接入分层**：AI Chat（完整工作区）/ Quick AI（一问一答）/ AI Commands（可随处触发的可复用 prompt：翻译、总结、改语法）/ AI Extensions（AI 可调用扩展作为工具，默认需审批）；**Models & Providers**：Local Models（本机跑开源模型）、Local AI Subscriptions（接已购的 Claude/ChatGPT 订阅）、API Keys（自带 key 自付费）、Custom Providers（OpenAI 兼容端点）。
- **Deeplink**：每个命令可复制 `raycast://` 链接，用于分享与自动化。
- （二手引述官方手册，经第三方镜像）Quick AI：Root Search 里打字按 `Tab` 即问；回答中回车默认粘贴到之前聚焦的应用（可在设置改为复制）。

**比 Hiven 好的环节、为什么**：
- **无匹配 Fallback**：Hiven 的 Global Launcher 搜不到时是什么？Raycast 把"搜不到"变成"送去下一个最可能的地方"，这是 launcher 类产品减少死胡同的标准答案。
- **结果回填原应用**：Quick AI 的"回车粘贴到之前聚焦的应用"是文本工作流的最后一公里；Hiven 的"结果交付"若止于复制，就多了一次切回+粘贴。
- **no-view 热键命令模式**：热键触发的命令不打开视图、每次重新执行、直接读前台选中文本——这是"选中即处理"最干净的实现（view 命令热键复用会只把旧窗口带到前台，社区扩展文档明确记录了这个坑）。
- **AI 的"来源可替换"而非"模型写死"**：本地模型/订阅透传/自带 key/自定义端点四档，给了隐私敏感用户（本地）和成本敏感用户（自带 key）各一条路，且每个 AI 能力都有非 AI 的确定性替代路径。

官方出处：
- https://manual.raycast.com/search-bar（Root Search、排序、Action Panel）
- https://manual.raycast.com/settings（Fallback Commands；Models & Providers：Local Models / Local AI Subscriptions / API Keys / Custom Providers）
- https://manual.raycast.com/ai/ai-chat（Quick AI / AI Commands / AI Extensions / Send Selected Text to AI）

---

## 五、Alfred —— Universal Actions：选中即行动

**一句话定位**：macOS 老牌效率入口；Universal Actions 是"选中任意文本/URL/文件 → 一个热键 → 弹出只显示相关动作的面板"，工作流内可多动作串联不离场。

**解决的核心问题**：和 Raycast 同一"选中文本就地处理"问题，Alfred 的答案更彻底：不经过搜索框，直接以选中内容为输入弹出动作面板；且 60+ 内置动作 + 用户工作流都挂在同一面板下。

**完整任务流程（文档推断）**：
1. 在浏览器/邮件/桌面选中一段文本（或 URL、文件）；
2. 按 Universal Actions 热键（可在偏好设置改；与旧版 File Actions 可共用）→ Actions 面板弹出，只列出与该内容类型相关的动作；
3. 输入过滤动作名 → 回车执行；
4. 结果按动作定义处理：复制到剪贴板、存为 Snippet、提取文本中的 URL、经工作流粘回前台应用……工作流里可把多个动作串起来"不离开 Alfred 一次做完"。
   - 同一面板也可从 Alfred 搜索结果、文件导航、剪贴板历史里调出；还支持"直接热键直达常用动作"（如 Open with / Copy / Move / Email）。

**官方资料确认的点**（alfredapp.com）：
- 面板只显示与选中项类型相关的动作；可输入过滤。
- 深度工作流集成：多个动作可串联、无需离开；工作流的 Keyword / Script Filter 对象会自动成为内置动作；也可在工作流里放专用的 Universal Action 触发器。
- 官方 gallery 工作流示例：`chatgpt` 关键词 / Universal Action / Fallback Search 三种触发；拼写检查工作流对选中文本提供"交互式逐词纠正→复制并粘贴回前台"的完整闭环。

**比 Hiven 好的环节、为什么**：
- **以内容为入口，而非以搜索框为入口**：Hiven 的主路径是"唤起 launcher → 输入/搜索 → 推荐动作"，Alfred 证明了反向路径（先有内容，再选动作）在文本任务上步数更少、心智负担更低。两者不是替代是互补：Hiven 缺的是这一侧。
- **动作面板按内容类型过滤**：不是把全部插件列出来让用户挑，而是"这段文本能干什么"——这正是 Hiven Object Block + intent ranking 想做的，Alfred 用最简单的类型过滤先做到了 80 分。
- **动作可串联不离场**：和 CyberChef 的 recipe 是同一思想在 launcher 语境下的实现。

官方出处：
- https://www.alfredapp.com/universal-actions/
- https://github.com/alfredapp/gallery-edits/blob/HEAD/workflows/alfredapp/openai/readme.md（官方 gallery：keyword / Universal Action / Fallback Search）
- https://github.com/alfredapp/gallery-edits/blob/HEAD/workflows/floatingpoint/spel/readme.md（官方 gallery：选中文本拼写检查闭环）

---

## 六、uTools —— 中文用户习惯与"超级面板"

**一句话定位**：极简插件化桌面底座，"呼之即来、即用即走"；杀手级交互是**超级面板**：选中文本/文件/截图后，按鼠标中键（或自定义热键），就地弹出与选中内容匹配的功能面板，点一下即执行，结果可直接送回活动窗口。

**解决的核心问题**：中文用户的典型文本任务（划词翻译、OCR、JSON 处理、取色……）散落在几十个小工具里；uTools 用"选中→中键→点功能"把"找工具"这一步压缩到零——用户不需要记得工具有名字，只需要记得"我选中了东西"。

**完整任务流程（文档+转述综合，待验证）**：
1. 在任何应用选中一段英文；
2. 按下鼠标中键（超级面板默认唤起方式，可改热键）→ 面板就地弹出，列出与"选中文本"匹配的插件功能（如聚合翻译直接出结果）；
3. 点功能 → 结果展示；输出可复制到剪贴板，或**直接发送到活动窗口**（回填原文位置）。

**平台机制（经插件作者文档转述官方 API，非一手，待验证）**：
- 插件"匹配"模式：关键字（主输入框）/ **正则·划词**（匹配主输入框文本或超级面板选中文本，捕获为变量）/ 窗口·进程 / 复制·选中文件 / 剪贴板图片——即平台层面把"选中内容"作为一等输入源。
- "输出"模式：隐藏 / 纯文本 / HTML / 复制到剪贴板 / **发送到活动窗口** / 系统通知 / 终端显示——"发送到活动窗口"是回填最后一公里的官方机制。
- 中文搜索优化：拼音、拼音首字母可搜应用与插件。

**比 Hiven 好的环节、为什么**：
- **超级面板是"选中即行动"的最激进形态**：连 launcher 搜索框都不经过。Hiven 若只做"唤起→搜索"，在中文用户的高频场景（划词翻译/查词）上会比 uTools 多两步。
- **"发送到活动窗口"的输出模式**：把"结果交付"产品化为可选项，而非每个插件自己实现粘贴逻辑。Hiven 的结果交付若只有"复制"，建议把回填做成平台级能力。
- **正则匹配选中文本**：插件用一条正则声明"我能处理什么样的选中内容"，平台负责匹配与变量注入——这是 Hiven intent ranking 的轻量替代方案（规则先行，学习在后）。

官方出处：
- https://www.u.tools/（定位："呼之即来，即用即走"；插件化）
- https://u.tools/docs/（官方文档中心；本次 SPA 未渲染出正文——旧版文档 URL 已 404，文档已迁移）
- https://github.com/fofolee/uTools-quickcommand（第三方插件文档，转述官方"匹配/环境/输出"机制——非一手，机制待验证）

---

## 七、Flow Launcher —— 插件生态与"在搜索框里装插件"

**一句话定位**：Windows 开源的快速启动器，"Quick file search & app launcher for Windows with community-made plugins"；插件商店直接做在设置里，搜索框输入 `pm install <插件名>` 即可安装。

**解决的核心问题**：Windows 上 Alfred/Raycast 体验的开源替代；插件生态是核心——用多语言 SDK（C#/F#/Python/Node.js）降低插件作者门槛，用"在 launcher 里装插件"降低用户安装门槛。

**完整任务流程（文档+转述综合，待验证）**：
1. 热键唤起搜索框；
2. 输入插件关键词 + 参数（如颜色插件、剪贴板历史插件 Clipboard+）→ 结果实时出现；
3. 回车执行动作（复制/打开/跳转）。
   - 装新插件：设置里进 Plugin Store，或直接在搜索框打 `pm install 名字`。

**机制（经 fork 镜像转述官方 README，非一手，待验证）**：
- 插件用关键词限定查询（plugin keyword + args），避免全局搜索被插件结果淹没；
- Plugin Store 内置：浏览、安装、卸载、更新都在应用内完成；
- 插件示例覆盖文本相关：Clipboard+（剪贴板历史）、Colors（颜色转换）等。

**比 Hiven 好的环节、为什么**：
- **获取插件的摩擦为零**：Hiven 有"插件目录扩展"，但若装插件需要离开 launcher 去找目录/手动放文件，生态转不起来。Flow Launcher 证明"在搜索框里 `pm install`"是 launcher 产品的标准动作。
- **关键词作用域**：插件查询限定在自己的关键词下，全局搜索保持干净。Hiven 的 intent ranking 若把所有插件结果混排，需要类似的"作用域"设计来防噪音。

官方出处：
- https://flowlauncher.com/docs/（官方文档站；本次 SPA 未渲染出正文）
- https://github.com/n00mkrad/flow.launcher（fork 镜像，转述官方 README 的插件商店/`pm install`/多语言 SDK 内容——非一手，待验证）

---

## 八、一次文本任务的流程对比（步数越少、离场越少越好）

| 产品 | 典型任务 | 步骤 | 关键省步设计 |
|---|---|---|---|
| uTools | 划词翻译 | 选中→中键面板→点翻译（3 步） | 不经过搜索框；结果可送回活动窗口 |
| Alfred | 处理选中文本 | 选中→热键→过滤动作→执行（4 步） | 动作面板按内容类型预过滤 |
| Raycast | 翻译/问 AI 选中文本 | 选中→热键(no-view)→执行→回填（4 步） | no-view 热键直达；Enter 粘回原应用 |
| Boop | JSON 格式化 | 粘贴→调脚本列表→模糊搜→执行原地替换（4~5 步） | 文本即工作区；单文件脚本 |
| DevToys | 格式化剪贴板 JSON | 复制→打开（工具已高亮）→输入已填→复制（4 步） | Smart Detection 省掉"找工具+粘贴" |
| CyberChef | 多层解码+提取 | 粘贴→拖操作链→看自动烘焙→调参→复制/分享 URL（5~6 步，多步单屏完成） | 链式+中间可见+Magic 兜底 |
| Hiven（现状） | 文本变换 | 唤起→（粘贴）→搜索/推荐动作→执行→继续处理/交付 | 推荐已做；缺就地入口、自动填充、回填 |

**共同模式**：做得好的产品都在做同一件事——**让"文本所在之处"离"动作"更近**（选中即面板/热键直达），**让输入自动出现**（剪贴板感知/选中抓取），**让结果回到原上下文**（回填/原地替换/发送到活动窗口）。步数差异主要来自这三处，而不是功能多寡。

---

## 九、可借鉴的思路（8 条：是解法/范式，不是功能清单）

**思路 1：以"选中内容"为入口的就地动作面板（来源：uTools 超级面板 / Alfred Universal Actions / Raycast no-view 热键）**
- 官方出处：https://www.u.tools/；https://www.alfredapp.com/universal-actions/；https://manual.raycast.com/ai/ai-chat（Send Selected Text to AI）
- 对 Hiven 的启示：接在"全局唤起"之前——新增一个全局热键，抓取前台应用选中文本，直接弹出"这段文本能干什么"的动作面板（复用现有 intent ranking），跳过搜索框。预期解决的摩擦：选中→复制→唤起→粘贴→找动作的 5 步压缩到 3 步；且用户不需要先想好"我要干什么"。
- 标注：uTools 超级面板细节为二手转述，待验证；Alfred/Raycast 为一手。

**思路 2：内容感知 = 推荐 + 输入自动填充（来源：DevToys Smart Detection）**
- 官方出处：https://github.com/devtoys-app/documentation/blob/HEAD/articles/extension-development/guidelines/UX/support-smart-detection.md
- 对 Hiven 的启示：接在"识别当前文本→推荐动作"环节——推荐动作被选中时，自动把剪贴板/选中文本填入输入（现在若还需手动粘贴，感知只做了一半）。检测器保持轻量（部分解析、超时取消、用户可关），这是官方文档反复强调的工程约束。
- 预期解决的摩擦：省掉每次的粘贴一步；"复制完打开 Hiven 就已经就绪"的爽感是 DevToys 口碑的核心。

**思路 3：输出框上的"送往下一步"（来源：DevToys 灯泡转交 / CyberChef recipe / Alfred 动作串联）**
- 官方出处：同上 Smart Detection 文档（"transfer the output of one tool to another"）；https://github.com/gchq/CyberChef（recipe 区）；https://www.alfredapp.com/universal-actions/（"string multiple actions one after the other without leaving Alfred"）
- 对 Hiven 的启示：接在"结果交付"环节——每个动作的结果旁给一个显式入口"用这个结果继续…"，点开即是按内容类型过滤的下一步动作（Hiven 已有"结果继续处理回到 launcher"，缺的是这个一眼可懂的 affordance）。多步任务再往前可做"配方"（见思路 5）。
- 预期解决的摩擦：链式任务（解码→格式化→提取）不再依赖用户手动复制粘贴接力。

**思路 4：无匹配时的 Fallback 路由（来源：Raycast Fallback Commands / Alfred Fallback Search）**
- 官方出处：https://manual.raycast.com/settings（"Configure which commands appear at the bottom of Root Search results when your query has no matches"）；https://github.com/alfredapp/gallery-edits/blob/HEAD/workflows/alfredapp/openai/readme.md
- 对 Hiven 的启示：接在 Global Launcher 的"无结果"状态——不要显示空列表，而是按配置把输入送往 fallback 链（如：算式→ Webster 搜索→一次性 AI 问答）。可拖拽排序、可关闭。
- 预期解决的摩擦：消除死胡同；每一次唤起都有出口，用户才敢把 Hiven 当默认入口。

**思路 5：单文件脚本层（来源：Boop）**
- 官方出处：https://boop.okat.best/；https://github.com/IvanMathy/Boop/blob/main/Boop/Documentation/CustomScripts.md
- 对 Hiven 的启示：接在插件体系之下——在现有插件目录旁支持"单文件脚本"：一个 `.js` + 头部 JSON（name/desc/tags/bias），`main(state)` 读写文本，沙箱运行。发现机制复用 tags/bias 排序。
- 预期解决的摩擦：把"加一个个人小变换"的成本从"写一个插件"降到"丢一个文件"，接住长尾需求；这也是 Boop 能靠社区脚本活下来的原因。注意官方文档的约束：沙箱、性能（常驻 VM、按需取值）要先设计好。

**思路 6：AI 的克制接入：同窗一问 + 可复用 prompt 命令 + 来源可替换（来源：Raycast）**
- 官方出处：https://manual.raycast.com/ai/ai-chat；https://manual.raycast.com/settings（Models & Providers）
- 对 Hiven 的启示：AI 只接在规则做不好的环节，且形态克制——(a) 同窗一问：launcher 里直接问、回答回车即回填原应用（Quick AI 模式），不做常驻聊天框；(b) 可复用的 prompt 动作（翻译/润色/总结）当作普通动作参与 intent ranking；(c) 模型来源可替换：本地模型优先，其次用户自带 key/订阅透传/自建端点；每个 AI 动作保留确定性替代路径。
- 预期解决的摩擦：在"意图模糊"（不知道这段文本是什么编码/该用什么动作）时给一个兜底，而不是把 AI 铺满全产品。Raycast 的分层证明 AI 可以是"可选项"而非"新界面"。

**思路 7：配方可分享（来源：CyberChef Deep Linking）**
- 官方出处：https://github.com/gchq/CyberChef（"copy the URL, which includes your recipe and input, to easily share it"）
- 对 Hiven 的启示：若做"动作链/配方"，把"动作序列+输入"编码进可分享的链接/deeplink（Raycast 的 `raycast://` 命令 deeplink 是同一思想：https://manual.raycast.com/search-bar）。接在结果交付之后。
- 预期解决的摩擦：协作场景（"你帮我看看这段日志"）零成本复现；也是产品自然传播的载体。

**思路 8：在搜索框里完成插件的获取（来源：Flow Launcher Plugin Store / `pm install`）**
- 官方出处：https://flowlauncher.com/docs/（二手转述：Plugin Store 内置、搜索框 `pm install` 安装）
- 对 Hiven 的启示：接在插件管理环节——插件目录的浏览/安装/更新直接在 launcher 里完成（搜插件名即装），不要让用户离开去找文件夹。另借一条：插件查询用关键词作用域，避免全局搜索被插件结果淹没。
- 预期解决的摩擦：生态的"最后一公里"；装插件的 friction 决定了插件目录是死是活。
- 标注：Flow Launcher 机制为二手转述，待验证。

---

## 十、明确不建议照搬的东西

1. **CyberChef 的四区重型工作台**：它的配方+断点+单步是为"未知 blob 取证"设计的，Hiven 的"精确文本工作台"若照搬会变成小 IDE，违背 launcher-only 定位。只取"链式+中间可见"的思想，不取布局。
2. **DevToys 的 30 工具全家桶**：工具数量不是壁垒，Smart Detection 才是。Hiven 不应以"插件数量"为目标。
3. **Raycast/Alfred 的全能 OS launcher 部分**（应用/文件/窗口管理）：Hiven README 已明确不做，竞品研究支持这个决定——它们的文本处理精华（fallback、no-view、Universal Actions）都可以剥离出来用。
4. **为 AI 加聊天框**：Raycast 把 AI 拆成 Quick AI（一问一答）/ AI Commands（prompt 动作）/ AI Chat（完整工作区）三层，且前两层才是高频。Hiven 若要接 AI，应从"同窗一问"和"prompt 动作"开始，不要从聊天框开始。
5. **uTools 的"一切皆插件"无边界扩张**：它的插件市场什么都有，这是它的选择；Hiven 的"精确文本工作台"定位要求对插件做策展（文本处理优先），否则 intent ranking 会被噪音淹没。

---

## 附：引用 URL 清单（全部为本次实际打开或搜索返回的 verbatim URL）

- https://boop.okat.best/
- https://github.com/IvanMathy/Boop/blob/main/Boop/Documentation/CustomScripts.md
- https://github.com/DevToys-app/DevToys
- https://github.com/devtoys-app/documentation/blob/HEAD/articles/extension-development/guidelines/UX/support-smart-detection.md
- https://devtoys.app/doc/articles/extension-development/guidelines/command-line-tool.html
- https://github.com/gchq/CyberChef（本次经 fork 镜像读取官方 README 原文：https://github.com/teerawad020841/cyberchef）
- https://gchq.github.io/CyberChef/
- https://manual.raycast.com/search-bar
- https://manual.raycast.com/settings
- https://manual.raycast.com/ai/ai-chat
- https://www.alfredapp.com/universal-actions/
- https://github.com/alfredapp/gallery-edits/blob/HEAD/workflows/alfredapp/openai/readme.md
- https://github.com/alfredapp/gallery-edits/blob/HEAD/workflows/floatingpoint/spel/readme.md
- https://www.u.tools/
- https://u.tools/docs/
- https://github.com/fofolee/uTools-quickcommand（第三方转述 uTools 官方机制）
- https://flowlauncher.com/docs/
- https://github.com/n00mkrad/flow.launcher（fork 镜像转述官方 README）
