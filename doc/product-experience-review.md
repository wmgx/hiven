# 产品体验审查覆盖记录

更新：2026-10-12。目标是检查真实任务能否清楚、安全地完成，并减少与当前任务无关的常驻说明。本轮不是所有平台、所有操作的全面验收。

## 证据与边界

使用隔离 Linux 原生测试 profile、合成文本和图片。没有调用真实 AI、翻译或账户 API，没有使用用户材料或配置凭据，没有真实 macOS / Windows 验证。

覆盖标记：**任务**表示实际执行指定流程；**画面**表示截图或界面文本观察，不能证明完整交互；**静态**表示源码检查；**未覆盖**表示本轮没有足够证据。不同入口的覆盖不可相互替代。此前专项验证仅作背景，不计作本轮重测。

源码目录核对为 **23 个顶层插件**；`src/builtin-plugins/index.json` 当前列出 21 个包，另有 `curl-inspector`、`unix-permissions` 源码入口。`web-open/extension/manifest.json` 属于浏览器扩展，不是第 24 个工具。下列清单按产品入口分六组，不以 manifest 数量冒充功能覆盖。

截图保存在本次环境 `/workspace/hiven-native/`。这些本地截图不是仓库永久附件；环境失效后不能仅凭文件名声称可重新检视。`audit-color.png`、`audit-crypto.png` 是搜索未命中画面，不能当作工具页面证据。颜色使用 `audit-color-answer.png`；哈希使用 `audit-hash.png` / `.txt`。

## 六组入口清单

### 1. 搜索、导航与系统页面

入口：Launcher 搜索与内容对象、动作浏览、Settings、AI services、Plugins、插件设置、QuickEditor、独立工具窗口。

- **画面**：Launcher 搜索、颜色与 Unix 权限答案、Settings 初屏；对应 `audit-launcher*.png`、`audit-settings.png`、`audit-color-answer.png`、`audit-unix-answer.png`。Settings 图仅显示当前可见区域，不算所有标签和设置项验收。
- **任务**：本轮编辑草稿后离开/返回的复现，见第 2、5 组。此前独立工具窗口接收、取消与替换已专项实测，本轮不重复计入。
- **静态**：系统路由与入口清单；macOS 焦点相关 native 路径由主审查跟进。
- **未覆盖**：本轮完整插件安装/更新、全部设置项、所有快捷键、QuickEditor 全流程、真实 macOS 焦点修复结果。Linux 截图不能证明 macOS 行为。

响应式导航问题已修复并实际验收：561–720px 横排标签继承 `width: 100%`，导致其它导航项隐藏；现在该断点使用 `width: auto`。在 660px 宽的真实窗口内，三个标签都完整可见，逐一点击 Settings / AI services / Plugins 并确认对应内容。最终证据为 `review-final-settings-narrow.png`、`review-final-settings-ai.png`、`review-final-settings-plugins.png`；前期两张错位命名截图不作最终证据。

### 2. 文本、结构化数据与对比

插件：`encode-decode`、`formatter`、`json-tools`、`line-tools`、`csv`、`regex-tester`、`text-diff`、`text-explode`。

- **画面**：文本、JSON、CSV、正则入口，Text Diff 与 Text Explode 空态，以及 Encode / Decode 的 Image ⇄ Base64 标签；对应 `audit-text`、`audit-json`、`audit-csv`、`audit-regex` 和 `audit-image-*`。
- **任务**：Image ⇄ Base64 输入合成稿后换标签再返回，已复现稿件消失；修复后用合成 PNG 的完整 data URI 恢复图片，切到 URL 再切回，输入、预览和复制全文一致；Escape 选择 Keep editing 仍保留。Regex 的两个默认合成匹配已实际提取并带回搜索，未用模型。
- **静态**：插件与标签状态所有权；本轮不重跑已验证的 CSV 全量算法、完整导出或正则超时。
- **未覆盖**：本轮 Formatter、Text Explode 的完整任务；全部 JSON/文本/编码操作；Diff 全部模式。先前 Diff 跨窗口专项验证不代表本组全量通过。

### 3. 剪贴板与历史

插件：`clipboard-history`。相关宿主入口：Launcher 剪贴板推荐、附加内容对象、返回搜索。

- **画面**：改前 `history-density-before.png`，改后 `history-density-after-browse.png`、`history-density-after-single.png`、`history-density-after-multi.png`，以及设置说明图。改后普通浏览不再被保留规则与平台不可用横幅上下夹住；一条选择与两条选择状态清楚区分，顺序和组合全文预览可见。
- **任务**：主验收执行跨搜索选择合成文本、检查单选/双选操作状态；截图本身不证明剪贴板交付全文，具体交付以主验收记录为准。
- **静态与最终画面**：保留规则留在 Settings；不可用的顺序粘贴入口隐藏；实际执行中的取消、返回外部及失败反馈保留。`review-final-history-browse.png`、`review-final-history-2.png` 已独立复核：多选说明整行已消失，顺序、181 字符全文预览与对比/复制/继续处理操作完整可见，无视觉阻断。
- **未覆盖**：本轮所有图片/文件粘贴目标、其他平台队列能力、所有历史恢复及永久删除分支。旧终态状态只读返回不再自动展示；本次执行的终态及真实失败仍保留。

### 4. 本地计算、生成与格式答案

插件：`calculator`、`date-time-assistant`、`random`、`color-tools`、`crypto`、`unix-permissions`。

- **画面/界面文本**：计算器、日期转换、cron 预览、随机数、颜色答案、SHA-256 参数入口、Unix 权限答案；对应 `audit-calculator`、`audit-date`、`audit-cron`、`audit-random`、`audit-color-answer`、`audit-hash`、`audit-unix-answer`。颜色实际答案已独立看图，原始未命中搜索图已排除。
- **静态**：入口目录核对。
- **未覆盖**：全部算法结果、错误边界、复制全文、参数往返和随机生成所有类别。看到结果卡不等于验证计算正确。

### 5. AI、翻译与账户连接

插件：`ai-writing`、`translate`、`feishu`、`web-open`。

- **任务**：AI Summary 输入合成稿后离开再返回，改前已真实复现正文丢失。修复后主验收实际使用 Escape / Back 触发弃稿确认，选择 Keep editing 保留全文；`review-final-ai-draft.png`、`review-final-ai-confirm.png` 已独立看图，保留按钮有可见焦点，正文与任务操作未被布局遮挡。此结论只覆盖本地草稿保护，不覆盖真实生成。
- **画面/界面文本**：AI Summary 无 provider/model 状态、Translate 空闲页面；仅观察配置入口及输入区，不读取或配置凭据。
- **画面**：AI services 无可用 provider 的配置页（当前文件名为 `audit-settings-plugins.png`），没有点击连接、刷新或生成。Ollama 长说明可后续收至 details，属于密度候选，不扩大本轮关键修复。
- **静态**：入口及草稿保护边界。
- **未覆盖**：真实生成/翻译、远端失败与计费、飞书登录和资料操作、浏览器扩展连接、活动标签和浏览器权限。不得把无凭据的空态检查描述为连接能力通过。

### 6. 文件路径、图像与开发者工具

插件：`file-paths`、`qr-code`、`curl-inspector`、`user-commands`。图像编码在第 2 组，避免重复计数。

- **画面/界面文本**：路径转换空态、二维码生成入口、cURL Inspector 空态；对应 `audit-paths`、`audit-qr`、`audit-curl`。路径和 cURL 页的说明占据上下两处位置，但尚无证据表明阻断任务。
- **任务**：主验收确认 cURL Inspector 可用 Escape 返回；鼠标返回入口缺失已补 SDK 返回/关闭；输入合成 example.invalid 命令后分别点击返回/关闭，Keep editing 均保留全文，明确弃稿后离开，没有发送请求。
- **静态**：入口清单核对。
- **未覆盖**：二维码扫描/相机、完整图片导出链路、全部路径语法、cURL 解析边界、自定义命令执行/编辑。未发网络请求、执行用户脚本或操作用户文件。

## 最高价值的三个共性结论

1. **工作中的材料应归明确的页面或任务所有，切标签/离开不能静默丢弃。** AI Summary 和图像编码已有真实复现，应先修数据保护，再谈排版。离开确认、标签保留及取消重试必须分别验收，不能只增加一条提示。
2. **主要界面优先显示材料与下一步动作。** History 删除常驻规则/平台横幅已有清楚的前后画面对照；实际失败和执行中的取消仍应显示。AI、路径、图像、cURL 的常驻说明密度可作为后续有证据的精简候选，不能以统一删文案替代任务判断。
3. **导航与焦点需要平台和动作证据。** 搜索未命中不等于工具已审查；能 Escape 返回不等于鼠标导航完备；Linux 成功不等于 macOS 焦点问题已解决。记录实际触发、焦点位置和返回后的材料，避免把静态推测写成验收通过。

## 修复后验收与剩余边界

本组完成 History、AI Summary/Translate、图片编解码、Cron 答案、cURL 导航和 Settings 窄屏导航的修复。独立代码审查、改后截图审查、TypeScript、架构检查、前端与 Linux 原生构建通过。关键逻辑使用合成宿主验证，无真实 API；既有综合文本测试另有 `escapeRegexPattern` 缺失测试桩的历史阻塞，不为使它通过改产品逻辑。

真实 Linux UI 补验：

1. History 浏览和零/一/两条选择：无保留期/平台横幅，不可用队列按钮隐藏，合并复制可用；Escape 退回浏览且输入焦点保留。保留规则在原设置仍可查，保留/删除算法未改。不可用条件是 Linux 进程会话标记模拟，不是 macOS 实测。
2. AI Summary：编辑合成原文，Escape/Back 弃稿确认，Keep editing 保全文，明确 Discard 后离开。没有生成、翻译、配置凭据。AI/Translate 交付拒绝后的保留与重试及权限代际由无网络逻辑验证，不宣称真实模型交付验收。
3. 图片：完整 PNG data URI 的输入、预览、复制跨标签一致；离开取消保稿。聚焦的图片保存入口打开真实 Save File 对话框，取消后完整合成 PNG 剪贴板不变。完整保存成功链路复用此前专项记录，本轮不虚称重跑。
4. cURL：鼠标返回/关闭可达，取消离开保留源命令；所有解析本地执行。
5. Cron：下次执行的完整日期、偏移和时区成为主行，规则按需可查；原复制数据契约由逻辑回归验证。
6. Settings：660px 窄窗口三个标签直接可见并逐一进入，最终画面已检查。没有新增外部连接。

光标优先修复另见 `launcher-caret-stability.md`，已独立提交 `4e7d9f9`：结果高度更新重复调用 Tao resizable setter，引发 macOS 原生 firstResponder 重设。修复前 Linux 未复现；修复后 Linux 连续输入、中间插删、选区替换、清空重输通过。macOS 因果来自锁定依赖源码，不能把修后 Linux 通过称为命中用户 Mac 的实测证明；物理中文 IME 未验。

全入口静态清单与已见页面不等于所有流程全量通过。仍未覆盖：真实 AI/翻译与账户、浏览器扩展/标签权限、二维码相机、全部格式/文件边界、所有插件安装更新/设置项、QuickEditor/独立窗口本轮完整往返，以及 macOS/Windows 实机。不得调用真实 API 来填满覆盖率。

第二组继续处理上述候选与独立窗口生命周期，具体结果见下。


## 第二组：独立窗口材料、路径转换与本地连接说明

真实旧版复现：Diff 两侧合成稿通过“Open in window”接收后，Escape 隐藏，120202ms 后原 WebDriver 窗口消失；无新材料重新显示时双侧为空。重新显示使用原生 show 命令辅助，未注入文本或状态。截图 `review2-detached-before-hide.png` 与 `review2-detached-lost-after-idle.png` 已检视。QuickEditor 同样分离、隐藏、从搜索重开，物理全选复制的完整合成稿一致，因此没有修改其存储行为。

修复将成功接收的非空材料与当前 renderer 的修改状态纳入原有延迟销毁守卫。系统关闭也走隐藏与延迟回收；token、原生窗口实例、接收代际及报告序号共同隔离旧回执。隐藏或失败替换不解除旧稿保护。宿主只保存布尔状态与标识，不解析插件正文、不新增正文持久化，不承诺退出应用后的恢复。携带空内容包装的非空 payload 保守保留；没有 payload 且没有修改的窗口仍可回收。

File Paths 将上下两处说明收进一个默认折叠的帮助区，增加可见的输出格式标签和逐行输入提示。原路径规则完整保留，缺少基目录等错误与复制反馈仍直接显示。插件版本为 1.0.1，发行索引版本为 128。Ollama 信任说明改为“关于本地连接”按需展开，连接状态、错误与 Refresh 按钮保留。


第二组已执行的真实任务：路径四种输出均与预期完整字符串一致，并逐一点击复制核对全文；相对路径缺少 base 时显示原错误，输入 `/tmp` 后恢复；帮助默认折叠、可展开全部规则，返回取消后源稿一致。Ollama 页面默认收起信任说明，实际展开检查完整文字；不可达状态及 Refresh 保持可见，没有点击连接、刷新、测试或生成。对应 `review2-paths-after.png`、`review2-paths-help.png`、`review2-ollama-after.png`、`review2-ollama-help.png`。


窗口修复后：带双侧材料的 Diff 隐藏 126471ms 后原窗口仍存在；无新 payload 显示原窗口，再逐侧点击复制，完整合成文本一致。右侧进一步粘贴到外部 Mousepad 并全选复制核对全文。`review2-window-retained-after-idle.png` 已看图。File Paths / Ollama 四张改后图也经独立复核，没有发现布局阻断。


最后补验：无 payload、未编辑的 File Paths 隐藏 150105ms 后窗口确实销毁；无 payload 打开的 cURL 窗口输入合成命令后用系统 Alt+F4 关闭，134363ms 后原窗口仍在，重开读取与点击复制的全文均一致，没有发送网络请求。对应 `review2-dirty-system-close-restored.png`。这些新窗口与无 payload 重开使用宿主 show 命令辅助；编辑、Escape、系统关闭及复制均为真实 UI 输入。

第二组独立代码与画面审查通过；关键原生草稿/代际逻辑、路径语义、类型、架构、前端及 Linux 原生构建通过，原生仍有 33 项历史警告。测试中窗口管理器退出造成输入落到外部合成编辑器，恢复隔离桌面管理器后才继续采纳交互结果。全程仅隔离 profile 和合成内容，没有启用真实用户历史、配置密钥、调用真实 API 或改变用户环境。尚未覆盖的账户、相机、浏览器扩展、macOS/Windows 实机及其余格式边界仍保留为未覆盖，不宣称完整产品全量通过。


## 第三组：本地普通任务收尾

开工时尚缺任务证据的常用路径是 Formatter、JSON/YAML 与文本整理的完整输入输出、Text Explode 选择交付，以及计算器/颜色/权限/哈希/随机/QR 的复制或保存。未重复 History、日期时间、窗口保稿和 File Paths 专项。该组以真实操作结果决定修复，没有仅凭界面说明长短新增改版。

发现并处理的实际问题：

- SQL Compact 输入 `SELECT 'a--b' AS value;`，旧版复制出 `SELECT 'a`。修复保护字符串、标识符和注释，只压缩保护片段之外的横向空白并保留换行；CSS 同类全局正则也改为保护词法正文，自定义属性、转义或不完整语法保守原样。入口说明同步改为真实能力，不再承诺去除注释并强制单行。Formatter 2.1.9。
- Text Explode 输入后 Escape 返回、再次进入为空，旧版没有离开保护。现在原文和选择接入确认；继续处理只在真实成功回执后消耗选择，失败可重试。独立审查进一步发现全局 capture Escape 早于插件处理，因此在宿主显示离开确认前同步撤销旧交付，并让旧 complete 校验原 owner；Keep editing 后新操作可以继续。Text Explode 1.0.9。
- Random 能生成却 Copy all 实际报 Copy failed：缺少 clipboard.write 声明。仅补该权限，版本 1.2.3。按同一调用链核对发现 CSV 也未声明，但以 navigator.clipboard 兜底绕过宿主；补明确权限并移除绕行，仍保留失败反馈与重试，版本 1.11.3。没有扩大 read/paste/shell 权限或重做 CSV 转换。发行索引 129。

已完成的补充真实任务（隔离合成数据）：

- JSON 无效输入显示原错误，修正后可继续；取消返回保稿，Compact 完整复制含中文 JSON。YAML→JSON 后使用 To input 自动切反向转换，输出 YAML 字段与列表完整。
- 文本整理处理多行，Use result 后 Undo 恢复完整原文；Back to search 带回结果，再明确复制附加材料，换行全文一致。
- `0.1+0.2` 明确执行得到剪贴板 `0.3`；红色答案复制 `rgb(255 0 0)`；chmod 755 复制完整权限说明，888 显示范围错误且没有执行 chmod；SHA-256 在参数框显式输入 abc，复制完整已知 64 位摘要。
- QR 输入合成中文与 URL，生成 PNG data URI；选择该图片识别，复制全文一致。真实 Save File 先取消，源文保留；随后另存 PNG，再选择保存的图片识别并复制全文一致。没有调用相机。文件选择使用 WebDriver 标准 file input 上传，保存使用真实原生对话框键鼠输入。

本组未使用真实 API、账户、用户历史或凭据。完整账户/模型、浏览器扩展权限、相机，以及 macOS/Windows 原生差异仍需相应环境；自定义 shell 命令与第三方插件安装更新需要独立配置和权限验收，本轮没有为覆盖数字去授权或执行。高级表达式、全部格式/随机模式与极限输入不是本次全局体验审查的穷举测试。


第三组修复后真实验收通过：

- SQL 字符串内双横线与双空格、行注释和下一条语句完整复制；CSS 引号中的标点/空格及 data URL 完整保留。XML 无效输入原地报错，修正后取消返回仍可复制含空格正文。
- Text Explode 实际选 alpha、gamma 两片段；Escape 和 Close 分别选择 Keep editing，原文 alpha beta gamma 与两项选择均保留；Continue processing 返回附加材料，再复制得到准确的 alpha gamma。真实操作没有模拟失败回执；false/reject、owner 变化及晚回执另由合成宿主逻辑测试验证。
- Random min>max 显示范围错误，旧批次明确标记 previous results / not regenerated；修正为 7..7、数量3后 Copy all 完整得到三行7。CSV 修后宿主复制原始合成两行文本成功，没有浏览器兜底。
- 截图 `review3-explode-kept.png`、`review3-formatter-css.png` 已检视；独立代码复核无剩余阻塞。类型、架构、前端与 Linux 原生构建及相应关键逻辑检查通过。原生仅保留历史警告。

本次全局体验审查到此收尾：常用本地任务已按以上记录完成代表性端到端验收，发现的功能错误已修复，不继续无依据的微小样式改动。该结论不等于所有插件、所有参数和边界穷举通过；仍需特定环境的项目及本轮未执行的高权限/高级流程已在上文逐项说明。

## 浏览器标签长地址摘要

浏览器插件 1.12.11（发行索引 130）将 HTTP(S) 标签副文案显示为域名与路径，过长路径保留尾部，查询与 fragment 仅显示存在标记。完整原地址通过行和副文案的原生 title、行的无障碍名称按需提供；非 HTTP(S)、无效或含控制字符地址维持原展示。摘要不解码路径、不记录或上传地址。原 subtitle、keywords、meta.url、排名与激活参数保持原值；宿主仅传递通用展示字段，不解析浏览器地址。

同标题、同路径而仅查询不同的标签仍有相同摘要，需要提示详情区分，不宣称摘要能识别所有页面状态。窄窗口仍可能省略域名尾部；没有增加行高、选择器或面板，也没有继续降低来源文字对比度。

在隔离 HOME/XDG 与 Xvfb 的 Linux 原生 WebKit 窗口中，通过现有扩展 loopback 入口注入两条合成标签（无真实历史、无 favicon 请求），在刷新原生页面后完成验收：660/504 宽度布局与原行高；完整 title/aria 地址逐字一致；方向键选择后输入框保留焦点；隐藏查询参数搜索命中第二条；完整 URL 搜索优先命中第一条；Enter 分别向扩展命令队列发出原 id/windowId 的 focus 请求。截图 url-native-660.png、url-native-504.png 已检视。这是原生 UI 与合成扩展协议验收，未覆盖真实浏览器扩展执行聚焦，也未实际验证系统读屏朗读。结束清空合成 snapshot。

启动时桥接状态曾报告 running 但端口不可达，使用带日志的隔离启动包装器重启后恢复；注入后刷新页面才读到标签。这两项不作为本次修改已解决的问题。独立审查与关键 URL/排名逻辑检查通过；类型、架构、前端及 Linux 原生构建通过，原生保留历史警告。没有调用真实 API、配置密钥或访问用户标签历史。

## 浏览器 snapshot 增删与重连刷新

进一步诊断澄清了上一节的 activated 现象：原生事件经 SDK 正常送达，后台缓存也确实更新；固定查询的列表没有重收集，改一个查询即可看到新缓存。不是后台权限缺失。另一个独立缺口是 snapshot 写入只改变 native 内存，没有发更新通知，扩展重连与删除标签并不保证伴随 opened/activated。

浏览器插件 1.12.12（发行索引 131）补齐这两段连接：native 仅在标签快照变化或 freshness 恢复时发送只含 sourceId 的失效通知；插件后台合并通知、串行读取，随后以通用 provider 变更订阅通知当前 Launcher 重收集。相同心跳不重复重收集；查询仍只读缓存，没有按键触发的原生读取。排名、原地址和聚焦参数没有改动，未新增权限。provider 注册随后台生命周期持有，启停与替换会同步撤销；读取过程中有新通知时拒绝旧回执并补读，宿主 TTL 缓存也拒绝被旧回执重新填充。后台 context 增加停止信号，以覆盖订阅安装仍在 await 时的禁用；已排队的 host 列表帧在提交前再验证请求是否有效。

独立生命周期审查和真实模块合成检查覆盖了通知合并、尾部补读、空快照、owner 替换、后台启动中停止、迟到订阅清理、native cache 旧回执及旧 RAF 提交。类型、架构、前端及 Linux 原生构建通过。设置同步旧测试夹具补齐 AbortController、合成定时器与无外部副作用的消息接收端后通过；测试未调用真实 API。

真实验收使用原隔离 HOME/XDG、Xvfb 和 Linux 原生 WebKit，在一次应用启动后的同一页面完成，performance.timeOrigin 不变，查询始终为合成的 bridge sentinel：空列表→两个 snapshot 标签出现→选中第二条→同 id 改标题与完整 URL→空 snapshot 两条消失→等待来源过期后新 snapshot 重连出现→Enter 的扩展队列请求仍为原 id/windowId。所有更新无需刷新页面或重新输入查询，输入焦点和仍存在的选中目标保持。bridge-native-updated.png、bridge-native-reconnected.png 已看图；结束清空合成 snapshot。验收覆盖原生 UI 与扩展协议，未声称真实浏览器扩展已执行标签切换。

running 状态在 bind 前置真的独立缺陷未改；此前失败实例的直接启动原因仍缺日志，未将它归为本次刷新问题，也未扩展自动重连工程。

## 桥接监听状态准确性

修复独立的 started-before-bind 缺陷：线程创建前仅占用启动状态，实际 bind 和 listener 设置成功后才对外报告 running。唯一生命周期 lease 防止并发重复启动；未启动的线程闭包被释放、绑定/设置失败、服务退出或线程展开时均复位，不会由旧 owner 清除新 owner。accept 被中断时继续，其余错误退出并清理状态，未增加自动重连或新操作入口。

现有浏览器连接页同时要求 running 与 fresh 才显示已连接；未运行时用原状态位置简短提示重启 Hiven，保留 Refresh status 仅查询状态的含义。中英文同步，浏览器插件 1.12.13、发行索引 132。

在隔离 Linux 原生环境先结束自己的 Hiven 进程，再由自己的合成 TCP listener 占用 127.0.0.1:19246；新 Hiven 日志明确 Address already in use，原生状态返回 running=false，连接页显示 Bridge not running. Restart Hiven.，端口响应仍属于测试 listener。释放自己的 listener 后点击 Refresh status 仍正确报告未运行；通过既有重启方式恢复 Hiven，日志确认监听成功且 running=true。随后正常 snapshot 入口送入一条合成标签，真实连接页显示 Connected、1 tabs、0 history、port 19246。失败与恢复截图 bridge-status-failed.png、bridge-status-recovered.png 已检视。结束清空合成 snapshot，测试 listener 已退出，没有抢占其他服务、修改网络权限或调用外网/真实 API，也未重复标签整套验收。

独立审查通过；实际生产生命周期模块的 Rust 检查覆盖真实临时端口绑定失败与释放重试、未启动闭包释放、展开退出，以及并发唯一持有。类型、架构、前端和 Linux 原生构建通过，原生仍有既有警告。线程创建资源耗尽没有在真实桌面上人为制造，由闭包释放检查覆盖其清理路径；真实浏览器扩展最终切换仍未验。


## 工具打开后的初始输入焦点

中文任务入口验收发现，去重页与 JSON 对比页打开后停在 surface 外壳，真实键盘输入没有进入编辑器。宿主原先只在下一帧查找目标，错过了异步工具/Monaco 的就绪时间。

现在每次页面打开仅持有一次有界焦点交接：只等待插件明确标记的 data-plugin-surface-autofocus 控件，最多十秒；初始外壳只聚焦一次。控件就绪后交接并释放所有监听，不选中内容、不设光标位置。用户指针、键盘（包括 Tab）、滚动、触摸、其他焦点或窗口失焦立即撤销；页面替换、离开与销毁释放旧 owner。已有子控件的 autoFocus 和设置字段导航继续拥有焦点。Diff 通过编辑器 ready 回调将左侧真实文本输入标记为初始目标；kit 仅透传通用 ready 回调。text-diff 3.4.2、发行索引 133。未修改 macOS native resize/responder 保护，也未加入“时间转换”别名。

独立生命周期审查及 test:surface-initial-focus 通过，覆盖延迟就绪、已有焦点、交互撤销、旧 owner、销毁、超时与重新打开。类型、架构、前端与 Linux 原生构建通过。真实验收仅用原隔离 HOME/XDG 和合成文本，通过原生 WebKit + 物理键盘完成：去重打开即输入三行、去重输出正确、移动光标后保持位置、确认丢弃后回到“去重”查询；JSON 对比冷加载时显式目标尚未出现，真实 Tab 将焦点移到返回按钮，Monaco 就绪后仍保留该焦点；随后连续两次进入均直接在左侧输入合成 JSON，返回保留“JSON对比”查询。没有 dispatch 模拟键盘，也没有调用真实 API。focus-dedup-ready.png、focus-diff-user-tab.png、focus-diff-ready-1.png 均已看图。macOS 本机未在此 Linux 环境重验。

## IME 确认 Enter 的局部契约修复

只读复核发现 Launcher、参数步骤、历史搜索已共享 IME guard；旧 test:ime-enter-confirmation 的历史正则误抓多选 Enter 分支，不能视为粘贴漏防护。真实风险位于设置 string-list 别名输入、CSV SQL 建议输入，以及 Quick Editor 结果页捕获监听的事件包装：前两者未先检查 IME，后者丢失原生 isComposing/keyCode 回退。

别名与 SQL 输入复用已有 useImeKeyboard，组合中与上屏后既有 120ms 保护窗口内不提交/补全，正常后续 Enter 保持原动作；没有新增窗口时长或全局禁止 Enter。输入失焦清除跟踪状态，generation 隔离迟到的旧清理与新一轮 composition。Quick Editor 包装保留 isComposing、keyCode 与 nativeEvent。CSV 1.11.4，发行索引 134。

独立审查通过。旧历史正则段替换为当前生产 handler 的行为检查；新增测试直接提取生产别名、SQL、历史、包装与 hook，覆盖 native/React composing、229、tracked 状态、上屏窗口、121ms 后明确第二次 Enter、普通 Tab/箭头/Backspace、取消/blur 与旧清理隔离。所有这些 IME 证据都是合成事件与合成时钟，不是物理输入法验收。类型、架构、前端和 Linux 原生构建通过，未调用真实 API。

真实普通交互只使用隔离 HOME/XDG 和合成数据：浏览器规则输入普通 Enter 添加合成别名，删除恢复默认，再输入未提交草稿、Escape 取消、重开确认未保存；CSV 输入两行合成表，SQL 的 SEL + Enter 补全为 SELECT，离开再进入后同样可补全，完整 SELECT * FROM data 正常显示两行；Quick Editor Ctrl+K 打开命令入口，Enter 执行 Split Pane Right，Ctrl+W 关闭空分栏，再打开并 Escape 取消，既有 43 字符合成草稿保留。ime-alias-enter.png、ime-sql-query.png、ime-quickeditor-restored.png 已检视。临时别名已移除，未安装扩展/输入法或改系统设置。

环境没有可用中文 IME，真实候选确认、macOS/Windows 输入法端到端仍未验证，不能据此宣称跨平台彻底闭环。另观察到 CSV 建议打开时 Escape 由现有宿主优先处理并返回搜索，本次仅验离开/重进状态，不改建议菜单的 Escape 优先级。

## CSV SQL 建议的 Escape 层级与草稿保护

在 34479dc 上真实复现：SQL 建议可见时一次 Escape 由 window 捕获阶段直接返回搜索，输入框自己的冒泡处理没有机会执行；CSV 未上报 dirty，重新进入后源表与 SQL 已清空。这违背已有“局部浮层先关闭，再退出页面”的交互约定。

新增最窄的 plugin-ui 局部 Escape 声明：仅当前宿主范围内、当前 owner 有效、触发控件/建议层确实可见且拥有真实焦点时可关闭 inline popup；无全局键盘订阅，不允许插件控制别的页面。失效/卸载撤销，旧清理不覆盖新声明。Launcher 插件页与独立插件窗口共用该判定，原 IME、对话框、Select、Monaco 查找等优先级保留，不批量重写其它工具。CSV 首次 Escape 只关闭建议，保留表、SQL、列选择与文本选区；再次 Escape 进入现有未保存确认。

CSV 对源文本、结果参数与文件来源上报未保存状态，空白未修改页直接返回。返回/关闭按钮调用同一宿主确认；继续编辑保留完整结果与选择，明确放弃才退出。宿主新增当前 surface owner 的 subscribeLeaveIntent 通知，只用于确认前撤销 pending 工作、无导航否决能力，旧 owner 和卸载自动清理。CSV 撤销晚文件读取、全量处理、保存、返回及复制完成回执，但保留已完成缓存。通知与成功交付的 owner 更新分离；CSV 使用稳定的草稿订阅身份，不再因 saveText 输出权限续期而清空完整结果或自取消正常带回搜索。CSV 1.11.5，发行索引 135。

独立审查、局部 Escape 生命周期检查、CSV 生产 callback 回归、IME 合成事件检查、类型、架构、前端及 Linux 原生构建通过。测试覆盖 scope/focus/visibility/owner、卸载与替换、组合输入、空稿与取消、完整结果保留、正常 handoff、迟到回执及交付权限续期。IME 与迟到回执证据为合成事件/受控异步，不代表真实中文输入法验收。

最终 Linux 原生 UI 用隔离 HOME/XDG、物理键盘与合成表完成：空页 Escape 无确认；SQL 建议打开并选中 age 列与 SQL 文本，首 Esc 仅关建议，第二 Esc 提示；Keep editing 后逐字核对源 CSV、SQL 和列选择；Back 按钮取消/明确放弃；再次进入空白；改源后 Esc 明确放弃；另一合成稿取消退出后成功 Return to Search，材料进入既有动作列表。csv-escape-fix-before.png、csv-escape-fix-first.png、csv-escape-fix-confirm.png、csv-escape-fix-handoff.png 已检视。结束移除合成 Object Block。独立插件窗口的共享判定通过逻辑检查，本次真实流程在 Launcher 宿主验收；未安装输入法/扩展、改系统权限、调用真实 API或使用真实历史。

## 图片 Base64 新载入失败后的旧结果保护

真实复现：先载入有效合成 PNG，再选择损坏 PNG，旧预览和完整 URI 仍保留，但复制/保存按钮继续可用；点击复制会交付旧图片并覆盖失败提示。现在只在新载入实际开始时撤销旧结果的交付资格，失败仍保留预览，在原状态区短提示“旧预览未更新，暂不可复制或保存”，三个交付按钮禁用。新成功恢复；文件选择取消不算载入，不废掉有效结果。结果引用同时拦截旧按钮回调，沿用既有 revision、abort 与 owner 隔离迟到异步。独立“保存剪贴板图片并复制路径”不依赖预览资格，保持原行为。中英文同步，encode-decode 2.7.3、发行索引 136。

独立审查、生产组件 callback 逻辑检查、类型、架构、前端与 Linux 原生构建通过。逻辑检查覆盖空文件取消、损坏/超限、成功纠正、旧交付回调、晚回执、tab/owner 撤销以及独立截图保存；这些受控异步证据不冒充真实桌面乱序复现。

真实 Linux 验收仅用原隔离 HOME/XDG、暂停的历史和合成图片：64×32 成功载入 → 损坏文件失败 → 旧预览/URI 完整保留且三按钮禁用 → 切换 URL 再回来仍禁用 → 换成不同的 37×19 图片成功 → 显式复制完整 data URI，与源文件全部字节一致 → 原生 Save File 保存 PNG，尺寸和全部像素一致。返回搜索再进入时无旧结果恢复。WebDriver 会抑制 HTML 文件选择器，因此另用同一隔离 profile 直接启动应用，以物理鼠标打开真实 Select File、Escape 取消；用哨兵替换外部剪贴板后点击 Copy data URI，确认仍复制取消前的完整结果，解码后全部像素一致。image-stale-fixed-failure.png、image-stale-fixed-corrected.png、image-stale-native-picker.png、image-stale-native-cancel-valid.png 已检视。未改历史设置、安装依赖或使用真实 API/密钥；macOS/Windows 未重验。

## 主 Launcher 异步刷新保持键盘选中

受控延迟本地时间即时答案，在真实原生 Launcher 输入 `timestamp`，先将鼠标移到第一行，再按两次下键选中“日期时间转时间戳”。答案插入时原项仍存在，但刷新后的鼠标位置对齐 effect 未检查键盘导航状态，会将选择改为静止鼠标下第一行。修复仅给该 effect 添加已有 `isKeyboardNavRef` 检查；不新增导航模式、不改 systemKey 身份保持或原项消失后的既有回退。

独立审查、原选择保持逻辑检查、类型、架构及前端/原生构建通过。验收使用隔离 Linux 原生界面与真实鼠标/按键；只有 provider 的 60ms 调度被受控延迟，不访问外网/API、不执行列表中的应用或命令。未重跑 History hover 或其它全套验收。

修复后同路径实际通过：原目标在插入后移到第 4 行，仍保持选中，行范围 y=184–228 完整位于列表视口 y=64–234.25 内；真实鼠标移动可重新接管，下一次方向键可接管，清空及新查询恢复默认选择。临时延迟钩子已撤销、查询已清空。macOS/Windows 未实测。
