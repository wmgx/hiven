# hiven 产品分析（产品视角）

> 基准：master（`c69ed99`），浅克隆只读。未运行桌面端；结论按三类标注：
> = 亲眼读到源码/文档原文并验证；= 从代码结构推断、未跑真机；
> = 需要真实用户/真机验证。
> 两路并行调研（设计文档研读、GitHub 公开信息）的结论在文末整合。

---

## 1. 定位一句话

hiven 是 **launcher-only 的精确文本工作台**：系统托盘是唯一常驻入口 → 全局热键唤起 Global Launcher → 同一会话内完成"搜索 / 参数 / 结果" → 文本变换插件执行（编解码、格式化、JSON/CSV/YAML、行工具、Hash 等）。灵感来自 Boop，交互参考 Raycast/Alfred，但 README 明确"**不做全能 OS launcher**"。

目标用户（PRODUCT.md 原文）：*Developers and technical users who need a focused desktop text-processing tool…without leaving their workflow.* 中文 i18n 与中文别名（含拼音别名如 `hangpaixu`/`quchong`）说明中文开发者是同等一等用户。

---

## 2. 架构与产品决策脉络（精读结论）

### 2.1 形态：launcher-only 是成立的，且迁移成本已经付出

`doc/2026-07-07-workbench-retirement-cleanup-design.md` + DESIGN.md（2026-08-09 B3/B4 launcher-only hard cut）表明：主工作台窗口、多 pane IDE 工作区、icon sidebar rail 都已**退休**。当前 surfaces 只有：托盘、Global Launcher（含原地展开的 Quick Editor/设置/插件管理）、可 detach 的 Quick Editor（单编辑器）、插件独立 surface 窗口。

这个转向是对的：文本变换是高频短任务（秒级），常驻主窗口只会增加"打开应用"的心理成本。launcher-only 把启动成本压到一次热键。

### 2.2 边界哲学：Framework 不知道产品语义

repo AGENTS.md 的插件系统边界是全文最硬的规则："如果一个概念带有 diff、compare、JSON、Markdown、AST、code semantic 等产品语义，默认不属于 framework。"Diff 是插件产品（`text-diff` 一个插件内部按内容自动切 text/json-semantic 模式，不设独立 json-diff 插件）；kit 只收纯算法（三问准入）。

这是 hiven 相对 Raycast 最大的架构差异化：Raycast 的扩展 API 偏"命令+视图"，hiven 的 host 偏"文本 I/O + launcher item 协议"。代价是插件开发心智负担更高（要理解 accepts/textMatch/dynamicItems/launcher 协议）。

### 2.3 明确不做清单（README + 2026-08-09 冻结文档）

硬约束"明确永不做"：全能 OS launcher / 文件全局搜索主路径；截图标注、窗管 Widgets、听写主路径；**必选 LLM / Agent 主路径**；Raycast 扩展商店兼容；云同步账号体系；路线 A 下宣传"安全沙箱"。

但有一个**定位裂缝**：07-19 智能路线把"桌面启动与控制"（开 App、开网页、切窗口、结束进程）定为维度 B，且已实现 App/窗口/进程（macOS）+ 飞书（文档/会话/联系人搜索）。这与"不做全能 OS launcher"存在张力——飞书深度集成尤其偏离"精确文本工作台"。

### 2.4 意图演变（时间线，细化版见文末整合）

- FluxText 期：单文件脚本体系 → 退役，改为目录插件。
- 2026-07-19：智能路线评审通过，两级混合匹配协议（`accepts` 声明粗筛 + `match()` 精筛），推进顺序"文本智能 → 桌面控制 → 工作流/脚本 → 飞书"。
- 2026-08-09：**架构冻结**（B1 门禁安全 → B2 Launcher 单轨 → B3 插件边界 → B4 文档 → B5 再谈广度），README launcher-only 硬切。
- 2026-08-12/08-20：直接回答工作台（输入即直答）+ 自学习；提议卡 P2c 上线后因 0/216 接受率被移除，改为静默学习+首次发火可见可撤销。
- 2026-08-25：自学习架构评审（Experience Kernel），但 Agent/LLM 明确最后且可选。
- 2026-09-20：Apple Passwords 插件验证记录——机制测试全过，真实接入被系统 SIGKILL 阻塞。

---

## 3. 功能完整盘点

### 3.1 插件（18 个 first-party，`src/plugins/`）

各插件暴露的工具数（从各 `index.*` 的 id 统计，近似）：

| 插件 | 工具 | 说明 |
|---|---|---|
| encode-decode | 9 | base64/url/html/slashes 编解码 + JWT 解码；**有 accepts/textMatch 内容感知** |
| line-tools | 27 | 行排序/去重/反转/空行/trim/合并/前后缀/包裹/SQL-IN + 14 种大小写转换 + 文本统计 |
| formatter | 6 | CSS/SQL/XML 美化/压缩 |
| json-tools | 9 | JSON 美化/压缩/转义/排序 + JSON↔YAML/QueryString 互转 |
| csv | 9 | CSV↔JSON/Markdown/SQL/TSV/NDJSON/keyed/columns/array |
| crypto | 3 | SHA-256/1/512（无 accepts 声明） |
| random | 8+ | uuid/密码/整数/浮点/hex/颜色/布尔/字符串（无 accepts） |
| date-time-assistant | 7 routes + direct answers | now/时间戳解析直答；有 dynamicItems |
| calculator | 5 + direct answers | 算式直答；有 dynamicItems |
| regex-tester | 2 | 正则测试 surface |
| qr-code | 1 | 二维码生成 |
| translate | 4 providers | 百度/DeepL/腾讯 + **AI（系统服务商）**；唯一消费 `ctx.ai` 的插件 |
| text-explode | — | 文本拆分（与 line-tools 有重叠嫌疑） |
| textDiff | — | 双栏文本/JSON semantic 对比，独立 surface |
| clipboard-history | 7 | 历史/收藏/常用（frequentPasteThreshold=3 次）surface；历史项可回 launcher |
| web-open | 10 | URL 快捷打开（pattern 模板）+ 直接 URL 打开；URL 学习规则的权威存储 |
| feishu | 1 | 飞书文档/会话/联系人搜索（需本机 lark-cli，可选） |
| user-commands | 6 | 用户自定义命令 |
| (+ apple-passwords) | 2 | 查询苹果密码/验证码；**真实接入被阻塞**（见 §2.4） |

### 3.2 Launcher 内建能力

calculator / date-time-assistant 的 `dynamicItems` + `directAnswer: true` 实现"输入即直答"（算式、now、时间戳→日期）；web-open 的 pattern 模板（如 `gh xxx` 开 GitHub 搜索）+ 直接 URL 打开；App/窗口/进程 providers（macOS）；Object Block 三段式（Object → 推荐动作 → 输出目标），剪贴板新鲜内容自动挂载、Backspace 二段删除。

排序模型（`src/workspace/launcher/ranking.ts`）：命令名匹配 3000-5000+ > 强 Intent 2000-2800（内容置信度≥0.85）> dynamic 800-900 > textMatch 800 > usage frecency。**内容感知已经是一等公民**，不是摆设。

### 3.3 设置面

系统设置 5 个 tab：基础设置、AI（订阅制 provider 登录：Codex / xAI Grok device-flow OAuth）、插件管理、学习到的规则（LearnedRulesContent）、行为观察（桌面截图+键盘观察，opt-in）。插件各自有 settings schema（i18n 双语）。

### 3.4 自学习现状（`src/workspace/learning/`，16 个文件）

已实现：剪贴板时间线被动观察（shape-only 事件 + salted hash，不存原文）→ 变换对验证（T(A)≈B）→ 规则聚类 → LearnedRules 管理页（删除/恢复屏蔽）。URL 模板学习由 navigationSensor（剪贴板 token × 访问 URL 配对）产出候选，权威存储归 `web-open`。

桌面截图观察（5 秒 cadence、500MB 上限、排除 1Password 等）与键盘观察是**独立 opt-in**，`startBehaviorObservation` 有 settings 守卫，默认不启用。

---

## 4. 核心问题回答

### 4.1 用户为什么会每天打开它？最强的啊哈时刻

目标用户（开发者/重度文本工作者）每天几十次在"复制—粘贴"之间需要**洗一下文本**：JSON 美化、base64 解码、时间戳换算、URL 解码、行去重排序、两段文本 diff、生成 UUID/密码、翻译一段报错。hiven 把"洗文本"的 friction 从"找网站 / 打开编辑器 / 搜索命令名"压缩到"**热键 + Enter**"。

> **重要校准**（GitHub 公开信息）：仓库 Stars/Forks/Watchers/Subscribers 全 0，Issues/Discussions 无任何用户内容，唯一贡献者是作者本人。**"每天打开"的用户目前只存在一个——作者自己的 dogfooding**（其 PR #5 做冷启动基准、#6–#8 做自学习，均面向自己设想的日常场景）。以下啊哈时刻排序是基于产品机制的推理，尚未被任何外部用户验证。

最强的啊哈时刻（按强度排序）：

1. **复制 → 热键 → 它已经知道你想干什么**（Object Block + 内容感知推荐）。复制一段 base64，唤起 launcher，`accepts: {kinds:['base64']}` + `textMatch: isBase64` 让"Base64 解码"排到首位，Enter 即得。这是 Boop（选中→唤起→搜命令）少掉"搜命令"一步的关键差异，也是"少搜命令全名"这个成功标准的直接体现。
2. **输入即直答**：输入 `1700000000` / `now` / `2+3*4` / `uuid`，首条即答案，Enter 复制走。directAnswer 机制已落地（calculator/date-time-assistant）。
3. **剪贴板历史回到 launcher 继续处理**：粘贴错了/想再洗一次，不用重新复制。`doc/2026-07-19` 回到 launcher 设计 + clipboard-history surface。
4. **text-diff 双栏对比**：两段日志/JSON 贴进去即出 semantic diff。

第 1 个啊哈时刻的强度取决于内容检测的覆盖率——目前只有 encode-decode/formatter/json-tools/date-time/web-open/feishu 声明了 accepts，**line-tools（27 个工具）、crypto、csv、random 都没有**，意味着"复制 20 行文本唤起"时推荐动作可能不够聪明。这是投入产出比最高的一块短板。

### 4.2 哪些完整任务能明显少几步、少切几次应用？

（未真机运行，步数按代码路径推断）：

| 任务 | 之前（典型） | 用 hiven 之后 | 省 |
|---|---|---|---|
| 美化一段 JSON | 复制→打开在线 JSON 工具/编辑器→粘贴→点 format→复制（5 步，切换应用 2 次） | 复制→热键→推荐"JSON 格式化"→Enter（结果已进剪贴板）（3 步，0 切换） | 省 2 步、少切 2 次应用 |
| 时间戳→日期 | 复制→搜"时间戳转换"网站→粘贴→复制（4 步） | 唤起→输入 `1700000000`→Enter（2 步） | 省 2 步 |
| base64 解码 | 同上类网站流程（4-5 步） | 复制→热键→首条即解码→Enter（3 步） | 省 1-2 步 |
| 开 GitHub 搜仓库 | 切浏览器→地址栏→输 github.com→搜（3-4 步） | 唤起→`gh hiven`→Enter（2 步） | 省 1-2 步 |
| 两段文本 diff | 打开 diff 工具/VSCode→各粘贴一边→对比（5 步） | 唤起→text-diff→粘贴两边（3 步） | 省 2 步 |
| 生成 UUID 填表单 | 搜 uuid 生成网站→复制（3 步） | 唤起→`uuid`→Enter（2 步） | 省 1 步 |
| 翻译报错信息 | 复制→开翻译网站/应用→粘贴→复制（4 步） | 复制→热键→推荐翻译→Enter（3 步） | 省 1 步 |

省步数的上限取决于两件事：① 热键唤起速度（first-paint 预算 120ms，埋点体系已建）；② 内容感知覆盖率（见 §4.1 末尾）。两者都是工程可解的。

### 4.3 删减/合并/降级清单

逐条给理由（为主，标注迁移成本）：

1. **feishu 插件 → 降级为"默认关闭的可选插件"**。理由：它是"桌面启动与控制"维度 B 的产物，与"精确文本工作台"定位最远；依赖用户本机 lark-cli，配置门槛高；08-09 冻结明确"先收敛不扩广度"。迁移成本低（已有 enable/disable 机制）。
2. **qr-code 插件 → 降级/合并**。理由：二维码生成是极低频玩具功能，独立插件占用列表与心智；可并入 random 或 direct answer（输入 `qr xxx` 直答）。迁移成本低。
3. **random 插件 → 拆解为 direct answers，取消独立 surface**。理由：uuid/密码生成的核心价值是"输入即得"，打开一个 860×640 的 surface 是杀鸡用牛刀。迁移成本中（surface 已有用户可能在用→保留但降级入口）。
4. **date-time-assistant 的 surface → 保留 direct answers，工作台表面降级**。理由：同上，价值在"输入 `now` 即答案"，7 个 routes 的表面是冗余。
5. **formatter + json-tools → 按"产品内聚"合并为一个"格式化"插件**（AGENTS.md 自己的口径：text-diff 合并 json-diff 就是先例）。理由：用户心智里"美化"是一个动作，不分 JSON/CSS/SQL。迁移成本中（i18n key、surface id、用户设置迁移），建议等 B5 广度解冻后再做。
6. **text-explode → 保留但降级入口**。【实际观察】它是字符级"炸开"（大爆炸）可视化，与 line-tools 的行操作不重叠，收回"合并"建议；但属于低频趣味功能，不应与高频工具同权展示。
7. **apple-passwords → 标记为实验/隐藏，直到真实接入打通**。理由：09-20 验证记录明确"真实接入被阻塞"，现在是不可用的死功能放在明面上。价值本身很高（Raycast 级杀手功能），打通后再转正。
8. **behavior observation（桌面截图+键盘记录）→ 冻结，不再投入**。理由：① 隐私/信任成本极高（每 5 秒截屏、500MB 存储、键盘观察），与"精确文本工具"的用户信任模型冲突；② 自学习当前唯一可验证的产出（URL 模板、transform 配对）**完全不依赖它**（clipboard 时间线已够用）；③ 08-25 评审稿自己都说 Level 3 捕获在闭环稳定前不做。保留 opt-in 开关但停止开发。
9. **future/shell-effect-runtime → 不做**。理由：与定位偏离最远（shell 执行是全能 launcher/Raycast 的领地），安全模型（allowlist/secret store 全都不进 V1）说明作者自己也知道这是个坑。
10. **crypto → 补 accepts（如 base64/hex 检测）或降级**。理由：3 个 hash 工具无内容感知，在推荐流里是哑巴；要么补 kinds 声明（低成本），要么承认低频。

**不删的**：clipboard-history（高频刚需，且 frequent/favorite 机制已建）、textDiff（差异化）、translate（AI provider 唯一消费方，见 §4.4）、Quick Editor（launcher 链条的"重型结果"承接面）、user-commands（【实际观察】用户自定义 shell 命令+执行前确认，已是轻量 shell 能力的现实形态，future/shell-effect-runtime 的存在理由更弱了）。

### 4.4 AI / workflow / 自学习：真实价值是否成立？

**AI 聊天框：明确不做。** 理由：① 与"精确、可预测"定位直接冲突；② 08-09 冻结"明确永不做：必选 LLM / Agent 主路径"；③ 现有 AI infra（Codex/xAI 订阅 OAuth）已建成但**唯一消费方是 translate**，说明连作者都没找到第二个刚需 AI 位。聊天框是"为了 AI 而 AI"的典型。

**AI 值得接的环节（规则/传统工具难以提供价值的）**：

1. **正则生成**（regex-tester 内"用中文描述生成正则"）：规则绝对做不到；开发者真实痛点；**生成→本地测试验证**闭环天然可控，失败回退手动输入。唯一推荐的 AI 功能位。
2. **自然语言路由到工具链**（"把这段 JSON 转 CSV 并去重"）：长尾意图解析。但边际收益存疑——accepts/别名/textMatch 已覆盖 80% 高频；且失败时用户预期管理难。**可做，但优先级低于 direct answer 覆盖率**。
3. **学到的规则的命名/解释**（08-25 评审稿 LLM Distiller 定位）：低频，可选。

**约束**：本地模型不建议（Tauri sidecar 体积/内存成本 vs 确定性任务为主，不划算）；用现有云端 provider infra（已建成），**只在用户显式触发时**发送当前文本；observation 数据绝不进 AI；每次调用必须有纯规则 fallback。

**workflow（线性动作链）：轻量做、画布不做。** 理由：① 真实场景存在（复制 JSON→美化→转 YAML→复制，2-3 步链开发者高频）；② 07-19 路线包⑥规划了线性工作流但被冻结推迟；③ Alfred Workflows 画布对文本工作台是重炮打蚊子。建议形态：**"结果即对象"的链式**（当前输出自动成为下一个 Object，不用重新复制）+ **一键重放最近链**。这不是新 surface，而是把已有的"结果继续处理"做完整。

**自学习：做 clipboard 配对 + URL 模板，冻结桌面监控。** 理由：① 已实现且零隐私风险（shape-only + salted hash，不存原文）；② 08-20 的复盘（提议卡 P2c 上线后 proposal_ready 216 次、接受 0 次→改为静默学习+首次发火可见可撤销）是健康的自我纠正——"忽略不是终态"这个根因判断很准；③ URL 模板学习（复制单号→打开查询页）是真实"少几步"场景。但**不要默认自学习=核心方向**：它的价值天花板是"把高频 2 步变 1 步"，而 direct answer 覆盖率解决的是"从 5 步到 2 步"，后者优先。另注意文档矛盾：自学习授权强度三轨并存（静默建规则 vs 只提候选 vs URL 确认后生效），落地时需统一口径，建议按对象风险分级（URL/外部跳转最严）。

### 4.5 质疑定位：launcher-only 成立，但"文本 vs 桌面控制"需要二选一

launcher-only 本身**成立**，不应质疑（迁移成本已付，且符合任务特性）。真正该质疑的是 07-19 路线埋下的**双维度定位**：A 文本智能工作台 vs B 桌面启动与控制。

- B 维度（App/窗口/进程/飞书）是 Raycast/Alfred 的主场，hiven 在这里没有差异化，只有"不让人失望"的防御价值。
- 证据：飞书插件需要 lark-cli 且是可选的；窗口/进程能力 macOS-only；README 同时说"不做全能 OS launcher"又列出"App/窗口/进程"为主要能力——**文档自己在打架**。

建议：**A 为主、B 为二等公民**。保留 App/URL 快速打开（唤起搜 app 名必须有结果，这是 launcher 的入场券），但窗口管理/进程管理/飞书深度集成停止投入，飞书默认关闭。省下的精力全部投入 direct answer 覆盖率和剪贴板闭环——那才是 Boop 没做、Raycast 不屑做、hiven 能赢的窄门。

收益 vs 迁移成本：这个转向几乎零迁移成本（不做减法，只做"停止加法"+ feishu 默认关闭），收益是产品叙事重新聚焦。

---

## 5. 最值得发展的 3 个方向

1. **Direct Answer 覆盖率与质量做到极致**（零 AI、零隐私风险、完全符合定位）。
- 给所有纯变换工具补 `accepts` kinds + `textMatch`（line-tools 27 个、crypto、csv、random 是重灾区）；
- `directAnswer` 首条 Enter 即拿走、`⌘2/3` 拿其他答案的交互已在设计稿里，落地并打磨；
- 成功标准就是 07-19 路线定的："少搜命令名"。这是 hiven 相对 Boop 的最大结构性优势（Boop 永远要搜命令名）。
2. **剪贴板为中心的任务闭环**（开发者每天打开的理由）。
- "结果即对象"：变换结果自动成为新的 Object Block，可继续变换/粘贴，链条不断；
- 一键重放最近变换链（轻 workflow，不做画布）；
- frequent（已建，阈值 3 次）/favorite 排序让常用项零搜索直达。
3. **AI 正则生成**（唯一值得的 AI 切入点）。
- regex-tester 内"中文描述→生成正则→本地验证"，用现有 provider infra，可选云端，失败回退手动；
- 这是规则做不到、用户愿意为 AI 容忍延迟/成本的极少数环节之一。

**明确不做的**：AI 聊天框、通用 workflow 画布、桌面截图/键盘观察的继续投入、shell-effect-runtime、全能 launcher 方向（文件搜索/窗口管理深度/飞书深度集成）。

---

## 6. 待验证假设清单（需真机/真实用户）

1. Object Block 内容推荐的实际命中率（特别是无 accepts 声明的插件场景）。
2. 热键唤起 first-paint 是否稳定 <120ms（埋点已建，看 `~/.local/hiven/logs/launcher-perf.ndjson`，本次未读用户数据）。
3. 自学习规则的真实产出率（proposal_ready→fire 的转化）。
4. feishu/lark-cli 的真实用户有几个。
5. text-explode 与 line-tools 的功能重叠度（未细读）。
6. 中文 IME 在 launcher 各帧的实际体验（设计要求"IME 组合中 Enter 不确认"，有专门处理）。

---

## 附：并行调研整合

### A. 设计文档研读（子 agent 全量阅读，只读）

**核心决策摘录：**

1. **URL 学习**（2026-08-30，产品方案未实现）："后台形成候选，Launcher 中确认后生效"；候选不是规则、不能自动执行；建议区与正常结果隔离（不占快捷序号、Tab 进入）；唯一权威存储归 `web-open`。明确不做：可见置信度分数、自动转正、通知中心、localhost/IP/敏感路径学习。有一项未确认决策：建议区默认"试一次"而非"添加规则"。
2. **自学习架构评审**（2026-08-25 v0.9，提案）："先建 Experience Kernel 再谈自学习"——Capability Provider 声明、统一 Action Runtime、Experience Journal（只记 shape 和 HMAC 指纹，禁正文）；产物是用户确认的 Saved Action / 线性 Routine；**无模型学习优先（统计+序列挖掘），LLM 只做无执行权的 Distiller（命名/解释），Agent 最后且作为受限 Consumer**。在闭环稳定前明确不做：全天屏幕/键盘/录音捕获、自动外部写入、通用 Agent Loop。
3. **AI provider runtime**（技术方案）：host 向插件提供统一 `ctx.ai`，当前两个 provider 均为**订阅制 OAuth**（openai-chatgpt 经 Codex App Server；xai-grok 经 device-code OAuth）；**不接 API Key**；xAI 只开文本/图片理解/服务端 Web Search；Codex 桥固定 read-only 沙箱。插件获得的是生成能力，不是供应商的编码环境。
4. **直接回答工作台**（2026-08-12，08-20 三处修订）："输入即直答"——工具退为后台 resolver，高置信度答案首条 Enter 拿走；三处撤销：① `DirectAnswerResolver` 类型不落地（改以 `directAnswer` 字段一等化）；② **提议卡 P2c 实现后移除（proposal_ready 216 次、接受 0 次）**→改为静默学习+首次发火可见可撤销；③ 学到的 url-template 由插件 sink 认领，host 不留副本。
5. **instant-suggestion 已废弃**：`instantSuggestions` contribution 已删除（commit `73b97bb`），现行机制是 `dynamicItems` + `directAnswer` 字段。
6. **07-19 智能路线**（已评审，包①–⑧当日收官）：两级混合匹配（`accepts` 声明粗筛 + `match()` 精筛带超时）；排序 `matchScore+intentScore+contextBoost+usageScore+textMatchBoost+dynamicBoost`；安全分级 L0-L3（L2 结束进程/关闭窗口必须确认）；推进顺序"文本智能→桌面控制→工作流/脚本→飞书"；一期明确不做：云端/必选 LLM、通用 RPA、自由 shell 默认入口、Object-first 大重构。
7. **08-09 架构冻结**（active 裁决）：B1 门禁安全→B2 Launcher 单轨→B3 插件边界→B4 文档→B5 再谈广度；冻结期禁新 first-party 插件、禁飞书/窗管/进程扩张、禁新 matcher 类型。定位："精确文本工作台级内容理解与变换 + 边界清楚的插件 host，不是另一个全能 Raycast"。
8. **future/** 仅一份：shell-effect-runtime 设计（V1 明确一大串不做：allowlist、spawn、secret store 等）。
9. **apple-passwords**（2026-09-20）：机制测试全过，真实接入被 `applepw` Helper 系统 SIGKILL 阻塞，未验证成功。
10. **文档权威**：doc/ 根目录是当前权威；wiki/ 写的是已退役的 FluxText 旧脚本体系（未打过时标记）；docs/superpowers/ 的关键 spec 已被 07-19 路线吸收替代。

**作者意图演变时间线：**

| 日期 | 关键转向/撤销 |
|---|---|
| FluxText 期 | instantSuggestions 设计→后被删除；单文件脚本体系→退役改目录插件；"Framework does not know diff"裁决→后被 AGENTS.md 收紧为按产品内聚打包 |
| 2026-07-19 | 两级混合匹配协议裁决；推进顺序文本智能→桌面控制→工作流/脚本→飞书；包①–⑧收官 |
| 2026-08-09 | **架构冻结**：先收敛协议/权限/门禁（B1–B4），B5 再谈广度；README launcher-only 硬切；"明确永不做"清单 |
| 2026-08-12/08-20 | 直接回答工作台；提议卡 0/216 接受率被移除→静默学习+首次发火可见可撤销 |
| 2026-08-25 | Experience Kernel 评审稿：Agent/LLM 明确最后且可选，列出停止条件 |
| 2026-08-30 | URL 学习回调收紧：确认后才生效，试用≠接受 |
| 2026-09-20 | apple-passwords 真实接入被阻塞，声明未验证范围 |

**主要矛盾**（供交叉审查）：① 自学习授权强度三轨并存（静默建规则 vs 只提候选 vs URL 确认后生效）；② 冻结文档"永不做必选 LLM/Agent 主路径" vs 自学习评审稿的 Agent 规划（已用"可选/白名单/预算"对冲）；③ wiki/ 旧脚本体系文档未打过时标记。

### B. GitHub 公开信息调研（子 agent，只读公开信息，未登录）

**仓库基本盘（2026-10-10）：** Stars / Watchers / Forks / Subscribers **全部为 0**；Contributors 仅 wmgx 1 人（818 commits）；Discussions 未启用；License 未声明；Issues 页面 0 open（API 显示 4 条历史，全部是作者自己的 PR #5–#8，0 评论）。

**Releases：** 51 个版本（2026-05-14→06-24，41 天，平均每天 1.2 个，CI 自动发布）；50 个 notes 只有模板句 `See the assets for download links.`；唯一手写 notes 是 v0.2.14（暗色模式 box-shadow 修复）。**2026-06-24 后发布完全停止**（3.5 个月），但开发未停——全仓 818 commits 中约 82% 发生在停发之后。产物矩阵：06-21 起 Linux 移出流水线，仅 macOS arm64/x64 + Windows x64；各版本下载量多为 0。

**作者的 4 个 PR（即全部"issues"）：** #5 冷启动性能攻坚（FCP p50 312ms→198ms，初始传输 -49.2%，生产预览 8 次基准）；#6–#8 自学习架构 PR0–PR1（Experience Journal、Saved Action 保存/重放、Learning Inbox），约束是本地优先与隐私（无正文内容边界、HMAC-SHA256 输入指纹、敏感输入跳过）。

**真实用户反馈：总量为零。** 无 issue、无功能请求、无 Discussions、无 star/download 外部信号。唯一的"需求方"是作者本人的 dogfooding：launcher 唤起要快、重复性文本动作可被记住重放、学习必须本地隐私安全。

**作者意图轨迹（一句话）：** Boop 式文本工具箱（FluxText，日更发布）→ 更名 hiven 并收敛平台 → 停止发布、冻结架构 → 转向"launcher + 本地自学习"的个人效率工具，且明确拒绝"必选 LLM"和云同步。

**对本分析的校准意义：**
- §4.1–4.2 所有"用户为什么会每天打开"均为【待验证假设】，且**验证对象目前只存在一个（作者本人）**。任何"最值得发展"的方向在投入前都需要第一个外部真实用户，否则是在为作者一人优化。
- PR #5 证明作者本人在意唤起速度——direct answer/首帧性能方向与作者直觉一致。
- License 未声明：若未来要吸引外部用户/贡献者，这是产品卫生问题（待办）。
