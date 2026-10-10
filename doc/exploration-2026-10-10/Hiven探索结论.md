# Hiven 探索结论报告

> 基准：wmgx/hiven 默认分支 **main** @ `c69ed99`（2026-10-07）。注：仓库默认分支为 main，不存在 master，本次以 main 为基准。
> 方法：5 个视角（产品 / 技术 / 设计交互 / 运行体验 / 竞品）独立并行探索后交叉审查、合并。
> 证据等级：亲手运行验证；读代码/文档得出，未真机验证；需真机或真实用户验证。
> 本次未修改仓库任何文件，未推送；未调用付费 API，未采集真实隐私数据。

---

## 0. 一句话结论

Hiven 的定位（launcher-only 精确文本工作台）成立，**不应推翻**；最值得投入的是：**内容感知覆盖率做到极致**（direct answer + accepts 补齐，零 AI、零隐私风险）、**新增"选中即行动"的就地动作面板**（与现有唤起互补的新入口）、**剪贴板为中心的任务闭环**（结果即对象、链式、重放）；**AI 只值得做正则生成一个点**；三种"质疑定位式"重构经评估收益均覆盖不了成本，**全部不做**。

---

## 1. 项目速览

- **形态**：系统托盘唯一常驻入口 → 全局热键唤起 Global Launcher → 搜索/参数/结果在同一会话完成 → 文本变换插件执行。无持久主工作台（2026-08-09 B3/B4 已硬切退役）。
- **能力**：18 个 first-party 插件（encode-decode 9 工具、line-tools 27、formatter 6、json-tools 9、csv 9、crypto 3、random 8+、date-time-assistant、calculator、regex-tester、qr-code、translate、text-explode、textDiff、clipboard-history、web-open、feishu、user-commands）。
- **差异化机制**：Object Block（剪贴板/选区作为对象）+ accepts/textMatch 内容感知推荐 + directAnswer 输入即直答 + intent ranking。排序已把内容感知做成一等公民（强 Intent 2000–2800 分 > dynamic 800–900）。
- **技术**：Tauri v2 + React 19 + TypeScript（非 strict）+ Tailwind v4 + Zustand；插件 SDK 切分是真隔离（`check-architecture.mjs` 全绿），但权限模型是君子协定（见 §5）。
- **明确不做**（README + 冻结文档）：全能 OS launcher、文件全局搜索主路径、截图标注、必选 LLM/Agent 主路径、Raycast 扩展商店兼容、云同步账号。

---

## 2. 现实校准：先看清基本盘，再谈方向

- Stars / Forks / Watchers / Subscribers **全部为 0**；唯一贡献者是作者本人（818 commits）；Issues/Discussions 零用户内容。
- Releases：51 个版本在 41 天内日更（2026-05-14→06-24），之后 **3.5 个月零发布**，但约 82% 的 commits 发生在停发之后——开发没停，面向外部的交付停了。
- **License 未声明**：未来想吸引外部用户/贡献者，这是产品卫生问题。
- **结论**：所有"用户为什么每天打开它"的排序目前都是，验证对象只有作者本人的 dogfooding。**任何大投入之前，都需要第一个外部真实用户**；否则只是在为作者一人优化。

---

## 3. 核心判断

### 3.1 定位：launcher-only 成立，但要在"文本 vs 桌面控制"上二选一

- launcher-only **不应质疑**：退役主工作台是三个月前深思熟虑的转向（有完整设计文档与清理分支），逆转等于自我否定；技术评估证实回摆约 2–4 人周而收益未经证实。
- 真正的裂缝是 2026-07-19 路线埋下的**双维度定位**：A 文本智能工作台 vs B 桌面启动与控制（App/窗口/进程/飞书）。B 是 Raycast/Alfred 的主场，Hiven 在此无差异化；README 一边说"不做全能 OS launcher"，一边把"App/窗口/进程"列为主要能力——**文档自己在打架**。
- **建议**：A 为主、B 为二等公民。保留 App/URL 快打开（这是 launcher 的入场券）；窗口管理/进程管理/飞书深度集成**停止投入**，feishu 默认关闭。这个转向**零迁移成本**（只做"停止加法"），收益是产品叙事重新聚焦。

### 3.2 最值得发展的方向（按优先级）

**方向 1：内容感知覆盖率做到极致**
- 现状：排序模型已把内容感知做成一等公民；directAnswer 机制已落地（输入 `1700000000`/`now`/`2+3*4` 首条即答案，Enter 拿走）。
- 缺口：line-tools（27 个工具）、crypto、csv、random **没有声明 accepts**——复制内容唤起时，推荐动作是哑巴。这是投入产出比最高的一块短板。
- 为什么最值得：零 AI、零隐私风险、完全符合"精确可预测"定位；这是相对 Boop（永远要搜命令名）的**最大结构性优势**；成功标准就是作者自己定的"少搜命令名"。
- 动作：给所有纯变换工具补 `accepts` kinds + `textMatch`；`⌘2/3` 多答案交互落地打磨。

**方向 2："选中即行动"的就地动作面板**
- 竞品共识（uTools 超级面板 / Alfred Universal Actions / Raycast no-view 热键）：文本任务的体验上限取决于三件事——**文本所在之处离动作越近、输入越自动出现、结果越回到原上下文**。步数差异来自这三处，而非功能多寡。
- Hiven 现状只有"唤起→搜索"一条主路径，缺"选中内容为入口"这一侧。两者是互补，不是替代。
- 动作：新增全局热键，抓取前台选中文本，直接弹出"这段文本能干什么"（复用现有 intent ranking），跳过搜索框。选中→复制→唤起→粘贴→找动作的 5 步可压到 3 步。

**方向 3：剪贴板为中心的任务闭环**
- "结果即对象"：变换结果自动成为新的 Object Block，可继续变换/粘贴，链条不断（DevToys 的灯泡转交、CyberChef 的 recipe、Alfred 的动作串联是同一思想）。
- 每个结果旁给显式"送往下一步"入口（按内容类型过滤的下一步动作）——Hiven 有"结果继续处理回到 launcher"，缺的是一眼可懂的 affordance。
- 一键重放最近变换链（轻 workflow，**不做画布**）；frequent（阈值 3 次）/favorite 让常用项零搜索直达。
- 这是"每天打开"的理由：目标用户每天几十次在复制—粘贴之间"洗文本"，链条不断才留得住。

**方向 4：AI 只做正则生成**
- regex-tester 内"中文描述→生成正则→本地验证"：规则绝对做不到、开发者真痛点、生成+本地验证闭环天然可控、失败回退手动输入。
- 约束：用现有云端 provider infra（已建成），**只在用户显式触发时**发送当前文本；observation 数据绝不进 AI；每个 AI 动作保留确定性替代路径。**不建议本地模型**（Tauri sidecar 体积/内存 vs 确定性任务为主，不划算）。
- 设计视角补充的顺位第二、三 AI 位：自然语言→命令+参数预填（仍是规则执行）、结果后处理渲染进现有 preview well——都不开新 surface，都有规则回退的静默降级。

**方向 5：单文件脚本层（Boop 式）**
- 一个 `.js` + 头部 JSON（name/desc/tags/bias），`main(state)` 沙箱运行。把"加个小变换"的成本从"写一个插件"降到"丢一个文件"，接住长尾需求——这是 Boop 靠社区脚本活下来的原因。

### 3.3 删减 / 合并 / 降级清单

| # | 对象 | 处置 | 理由 |
|---|---|---|---|
| 1 | feishu | 降级为默认关闭的可选插件 | 与"精确文本工作台"定位最远；依赖本机 lark-cli；08-09 冻结本就要求先收敛 |
| 2 | qr-code | 降级并入 direct answer（`qr xxx`） | 极低频玩具功能 |
| 3 | random | 拆解为 direct answers | uuid/密码的价值是"输入即得"，独立 surface 杀鸡用牛刀 |
| 4 | date-time-assistant | surface 降级，保留 direct answers | 价值在"输入 `now` 即答案" |
| 5 | formatter + json-tools | 按"产品内聚"口径合并 | 用户心智里"美化"是一个动作（等 B5 广度解冻后，迁移成本中） |
| 6 | text-explode | 保留但降级入口 | 字符级炸开与行工具不重叠，但低频 |
| 7 | apple-passwords | 标实验/隐藏 | 真实接入被系统 SIGKILL 阻塞，当前是死功能；打通后是 Raycast 级杀手功能 |
| 8 | behavior observation（桌面截图+键盘记录） | **冻结，不再投入** | 信任成本极高（5 秒截屏/500MB/键盘观察）；自学习现有产出（URL 模板、transform 配对）完全不依赖它 |
| 9 | future/shell-effect-runtime | 不做 | 偏离最远；user-commands（自定义 shell 命令+执行前确认）已是更克制的现实形态 |
| 10 | crypto | 补 accepts 或降级 | 3 个 hash 工具无内容感知，在推荐流里是哑巴 |
| 11 | 设置页"行为观察"+"学习规则" | 合并为一个"学习与记录" | 对普通用户是同一心智（"它在学我"） |
| 12 | Quick Editor 多 pane 分屏 | 二选一：承认并补文档/发现入口，或按 DESIGN.md 砍掉 | 文档称 single editor，实现却有完整分屏——方向级信号混乱 |

**不删的**：clipboard-history（高频刚需）、textDiff（差异化，语义 diff质量高）、translate（AI infra 唯一消费方）、Quick Editor（链条的"重型结果"承接面）、user-commands。

### 3.4 交互：收益最大的 3 处修复

1. **P0 · Overlay 失焦丢数据**：`QuickEditorCommandOverlay` 失焦即整体关闭，多步参数输入全部丢失——**唯一的数据丢失类问题**，直接伤害"精确/可靠"品牌。改动小（去掉 blur-close 或失焦保持状态），收益是信任。
2. **P1 · 中文 IME 下 Esc 关闭 launcher**：候选词中按 Esc 是输入法肌肉记忆，当前行为直接关闭 launcher，每天高频打断心流。方案：`isComposing`/keyCode 229 时 IME 优先 + compositionend 丢失的超时熔断（保住防卡死的原设计意图）。
3. **P1 · 排序零解释**：frecency/固定/learned-rule boost 在 UI 上零可见，用户学不会"怎么让它更懂我"，自学习也就永远没有心智模型。行内给 subtle 来源标记（"常用/已固定"），成本远低于调 ranking 算法。
- 次级问题：编辑器 overlay 内缺"粘贴到前台应用"目的地（与 Global 不一致）；无结果时 action slot 空置（应给"作为内容处理"一键转 Object Block，把死路变通路）；`SOURCE_LABELS` 硬编码中文（英文 locale 下仍显示中文，违反仓库 i18n 规则）；Sparkles 图标一义两用；分屏快捷键无处可发现；search/collect 错误条 `role` 不统一。

### 3.5 技术：骨架健康，纪律在滑坡；杠杆在便宜处

**健康的**：分层边界是真约束（`check-architecture.mjs` 全绿，CI 硬看门）；窗口级 code-splitting 有心（Monaco 不进 plugin-surface 窗口）；pane 数据模型为未来留了后路；telemetry 埋点覆盖 launcher 核心漏斗。

**滑坡的（按影响×成本排序）**：
1. **质量门禁在 main 上是红的**——`test:quality-gate` 3/23 失败：20 个 tsc 错误/12 文件、孤儿文件 `web-open/learnedRules.ts`（115 行）、`test:self-learning-pr2` 脚手架 bug。CI 注释还写着"tsc debt cleared 2026-08-09"，债务已复发。影响最高、修复最便宜，**最痛**。
2. **权限模型是君子协定**：Rust 侧 `plugin_shell_run`（完整任意命令执行）/`plugin_http_request` **零调用方鉴权**；第三方插件与 host 同 renderer，可直调 invoke 绕过授权、可读别家插件 localStorage 私有数据。彻底修=真沙箱（6–12 人周，不值）；折中 0.5–1 人周：Rust 命令加 pluginId + 授权查询，堵住最大口子。
3. tsconfig 非 strict（`any` 36 处的"干净"是虚的）；154/180 个测试游离于门禁之外，且多为"正则断言源码文本"的脆弱测试（抽样即抓到 1 个误报）；`src-tauri/lib.rs` 8345 行单文件。
4. **新用户第一步即失败**：`package-lock.json` 硬编码字节内网镜像 `bnpm.byted.org`（39 个包），干净环境 `npm install` 必挂。README 的上手第一步就是 broken 的，修复成本极低。另外仓库声明 `pnpm@10.33.2` 但 CI 用 `npm ci`，Node 24 + npm 10.9.4 有收尾崩溃——三者不统一。

**三种"质疑定位式"重构全部被证伪**（收益 < 迁移成本）：常驻工作台回摆（2–4 人周，自我否定）、插件真沙箱（6–12 人周，为假想敌付税）、换渲染方案（Tauri 已是最轻，纯 Web 则丢掉热键/托盘立身之本）。真正的技术杠杆：修红的门禁、Rust 命令加鉴权、开 strict。

### 3.6 明确不做清单

AI 聊天框 / 必选 LLM 主路径 / 通用 workflow 画布 / 桌面截图+键盘观察的继续投入 / shell-effect-runtime / 全能 launcher 方向（文件搜索主路径、窗口管理深度、飞书深度集成）/ CyberChef 式四区重型工作台 / 以插件数量为目标 / Raycast 扩展商店兼容 / 云同步账号体系。

### 3.7 workflow 与自学习的最终判断

- **workflow**：真实场景存在（复制 JSON→美化→转 YAML→复制的 2–3 步链），但形态是"结果即对象"的链式 + 一键重放最近链，**不做 Alfred 式画布**。这是把已有的"结果继续处理"做完整，不是新 surface。
- **自学习**：做 clipboard 配对 + URL 模板（已实现，shape-only + salted hash，零隐私风险；08-20"提议卡 216 次展示 0 接受→静默学习+首次发火可见可撤销"是健康的自我纠正）；**冻结桌面监控**。且不默认它是核心方向：它解决"2 步变 1 步"，direct answer 解决"5 步变 2 步"，后者优先。注意文档矛盾：授权强度三轨并存（静默建规则/只提候选/URL 确认后生效），落地需按风险分级统一口径。

---

## 4. 交叉审查：五个视角的一致与分歧

- **一致（高置信）**：不做 AI 聊天框（产品/设计/竞品三方）；launcher-only 不动（产品/技术）；feishu 降级 + behavior observation 冻结（产品/技术）；门禁红了是最痛的技术债（技术/运行体验）；lockfile 内网镜像是上手第一坑（技术/运行体验）。
- **互补（拼出完整图）**：产品视角提出"补 accepts"是最高 ROI；竞品视角补上产品视角没看到的"选中即行动"新入口；设计视角补上"排序可解释性"这一信任问题；运行体验视角用证实了语义 diff 与意图引擎的逻辑层质量，也诚实划定了 UI 零验证的边界。
- **分歧（已裁决）**：无实质分歧。仅一处口径差异——产品视角曾建议 text-explode 与行工具合并，自查后收回（字符级炸开不重叠），改为降级入口。

---

## 5. 风险与待验证假设

1. **UI 层零真实验证**：本机 Linux 无头 + 受管 Chromium（Local Network Access 检查无法关闭）导致桌面端与浏览器验证全部不可行；所有交互结论是推断。需要 macOS/Windows 真机验证：launcher 真实视觉与完整键盘流、Object Block 推荐实际命中率、first-paint 是否稳定 <120ms。
2. **用户侧全是假设**：0 stars、单作者、零外部反馈。"每天打开"的排序、删减清单的取舍，都应在第一个外部真实用户出现后再大投入验证。
3. uTools 超级面板细节、Flow Launcher `pm install` 机制为二手转述（已在分报告标注），引用时注意。
4. 自学习三轨授权口径、DESIGN.md 与分屏实现的脱节，是文档级矛盾，修文档比修代码优先。

---

## 6. 分报告索引

- `notes/01-product.md` —— 产品分析：定位、功能盘点（18 插件）、删减清单、AI/workflow/自学习判断、GitHub 基本盘调研
- `notes/02-tech.md` —— 技术架构：分层边界、插件系统与权限模型、测试/类型现状、构建验证、技术债 Top 5、三种重构的迁移成本评估
- `notes/03-design.md` —— 设计交互：分链路审视、12 个问题清单（P0–P3）、i18n 抽查、收益最大的 3 处改动
- `notes/04-usage.md` —— 运行体验：事实基线（安装/构建/逻辑层 16 个测试抽样 15 通过、亲手跑通的 diff/编解码/推荐逻辑）、未能验证的诚实清单
- `notes/05-competitors.md` —— 竞品研究：Boop / DevToys / CyberChef / Raycast / Alfred / uTools / Flow Launcher 的官方资料、流程对比、8 条可借鉴思路与 5 条不建议照搬

---

*探索完成于 2026-10-10。仓库未被改动、未推送。如需原型，在独立实验分支进行并说明验证范围。*
