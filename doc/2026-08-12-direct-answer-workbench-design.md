# hiven 直答工作台 · 落地设计文档

**用途：** 把「输入即直答 + 后台被动自学习 + 信息流转路由（含浏览器）」这套方向固化成施工蓝图，供后续分阶段实现。
**状态：** 方向已与用户对齐（2026-08-12 多轮收敛后）。数据结构/接口为设计基线，实现时可细调。
**仓库：** `/Users/bytedance/flux_text`（分支 `main`）
**前置阅读：** `CLAUDE.md`（framework/plugin 边界）、`PRODUCT.md`（审美红线）、`doc/2026-08-12-interaction-ui-refactor-brief.md`（单栏结构现状）。

---

## 0. 一句话

> 让 hiven 从「**我搜 → 我选命令 → 我确认 → 执行**」变成「**输入即答案已在，拿走即可**」：把 calculator / 时间戳 / web-open 正则那种"直接出结果"的秒懂扩展到一切内容；靠**后台被动观察**（剪贴板时间线 + 浏览器流 + 前台 App）自学习，而不是"用它才学"；hiven 成为信息在各软件间流转的路由入口。

---

## 1. 为什么（连续否稿沉淀的教训）

- **视觉不是问题**（用户："UI 很好"）。问题是交互范式停在 **command-selection**。
- "更聪明的预判/排序列表"仍被否——用户原话："你是帮我做了一个选命令的事情，我感觉可以更进一步"。**再准的预判列表也还是"挑一个命令 + 二次确认"**，没跨过要跨的那步。
- 用户已手搓的 calculator、时间戳、web-open 正则，共同点：**输入 = 直接出结果，无命令步、无确认**。这就是要推广的范式。
- 三条硬否决：① 命令列表 / 置信度排序 UI；② 界面元素多（百分比、信号标签、路径链）；③ 需要用户二次确认。

---

## 2. 核心范式：输入即直答

```
一条输入线（打字 / 粘贴 / 读剪贴板）
        │
        ▼   内容被 resolver 识别
直答区：答案本身直接列在下面（不是"要跑的命令"）
        │
        ▼
去向：复制 / 粘回原 App / 写入编辑器 / 开成浏览器标签 / 丢给下一个工具
```

- **命令消解**：工具退到后台成为"直答 resolver"，输入被识别就直接算出结果。用户看到的是**结果**，不是"要运行的命令"。
- **高置信度 = 无确认**：答案已就绪，`↵` 拿走首条，`⌘2/⌘3` 拿其它，`⇥` 换去向。
- **搜索退居 fallback**：没有任何直答命中时，才落回现有搜索列表。搜索不再是主路径。
- **零查询也有答案**：开窗未打字时，直接把**剪贴板内容**算好摆出（复用现有 clipboard object block 的读取时机）。

> 与现状的关系：calculator / date-time / web-open 现在是 launcher 的 dynamic items（"直接出结果"），本设计把这种个案统一成**一等的直答 resolver 协议**，并大幅扩面。

---

## 3. 直答 Resolver 架构

### 3.1 接口（generic，不含具体产品语义）

> **⚠️ 实现决策修订（2026-08-20）：本节的 `DirectAnswerResolver` 类型没有落地，且不打算落地。**
>
> 原因：现有的 plugin `dynamicItems` provider **已经**是「输入 → 直接出结果」的注册机制（calculator / date-time / web-open 都在用）。再建一套平行的 resolver 类型 + 适配层转回 `LauncherItem`，是在已有能力上套第二层壳。
>
> 真正缺失的不是「另一套协议」，而是**答案语义无法被声明**——直答项的标题是「结果」而不是「命令名」，因此会被 ranking 的 query-present 文本过滤器丢掉。历史上是靠 `kind:'dynamic'` + `aliases:[query]` 自我匹配绕过去的，代价是 `staticPriority` 静默失效（详见下方「已知陷阱」）。
>
> **实际落地形态**：
> - `LauncherItem.directAnswer?: { priority?, origin? }` —— host 侧一等字段（`launcher/types.ts`）
> - `LauncherItemContribution.directAnswer?: boolean` —— 插件只声明「我是答案」，**priority 由 host 分配**（`PLUGIN_DIRECT_ANSWER_PRIORITY = 30`，低于 learned 基线 45），与 `staticPriority` 的 host-only 约束同源
> - ranking 三处一等支持：免 query-present 过滤、priority 不受 `kind` 限制、空查询保留
> - 契约：`npm run test:launcher-direct-answer`
>
> 若后续仍要引入 resolver 注册表，请先说明它相对 `dynamicItems` 的增量价值，不要仅因本节写过就重建。

```
DirectAnswerResolver = {
  id: string
  // 便宜的预判：这段输入我大概能处理吗（用于是否调用 resolve）
  claims(input: ResolvedInput): boolean
  // 产出直答（可 async，如网络类）
  resolve(input: ResolvedInput): DirectAnswer[] | Promise<DirectAnswer[]>
}

ResolvedInput = {
  text: string
  features: InputFeatures        // 见 §5.2，供 claims 快速判定
  detectedType?: ClipboardDetectedType  // 复用 detectClipboardType（17 类）
  source: 'typed' | 'clipboard' | 'editor-selection' | 'browser-selection'
}

DirectAnswer = {
  resolverId: string
  icon: IconRef
  value: string                 // 结果本身（直接展示）
  label: string                 // 一句话说明（i18n）
  destinations: OutputDestinationId[]  // 复用 output.ts 的去向系统
  run(dest): Promise<OutputResult>
  origin: 'builtin' | 'learned'
  learnedRuleId?: string
}
```

### 3.2 内置 resolver（冷启动兜底 · Day-one 覆盖）

出厂即好用、零学习。首批从现有能力平移 + 扩充：

| resolver | 输入 | 直答 |
|---|---|---|
| calc | 数学表达式 | 结果 |
| timestamp | 10/13 位数字 | 本地时间 / ISO / 相对 |
| jwt | JWT | 解码 payload / 校验过期 |
| json | JSON | 格式化 / 转 YAML / minify |
| color | `#rrggbb` | 色块 + rgb/hsl |
| base64 | base64 串 | 解码（可打印才出） |
| url | http(s) | 打开 / 拆 query |
| case/text | 文本 | 大小写 / 字数 |
| hash/uuid… | 视需要 | 后续补 |

- **内容识别复用** `src/launcher/clipboard/clipboardSnapshot.ts` 的 `detectClipboardType`。
- **具体产品逻辑（JWT 解码、JSON 语义等）留在 plugins / kits**，resolver 只做"识别→调用→包装成 DirectAnswer"。见 §8 边界。

### 3.3 排序与共存（决策：学习规则优先 + 不压制）

- **学习规则优先**：learned rule 命中时占首条 `↵` 位（personalized intent > generic default）。
- **但不压制内置**：learned 与 builtin **共存**于直答区，learned 只是排前，绝不隐藏内置答案 —— 避免一条过拟合/过时规则埋掉明确的内置答案（如纯算式的 calc）。
- **强度衰减兜底**：learned rule 的 `strength` 随不用而衰减、过期自动降权/遗忘（§4.4 回喂），让"优先"始终诚实。
- learned 答案标记 `origin:'learned'`（UI 上一枚"你教的"小标），便于识别与管理。
- 上限：直答区最多 3–4 条，其余折叠或落搜索。**不显示置信度数字 / 信号标签 / 路径链**（用户否决过的元素）。

### 3.4 去向（信息路由）

复用并扩展 `src/workspace/launcher/output.ts` 的去向系统：复制 / 粘回前台 App / 覆盖编辑器 pane / 新建 pane / **开成浏览器标签** / **作为新输入丢给下一个 resolver（链式）**。`⇥` 循环去向。

### 3.5 与剪贴板 Object Block 合并（决策：只保留直答区）

直答区**吸收**现有剪贴板推荐动作，不再并存两套机制：

- 开窗（零查询）时，剪贴板内容直接在直答区出答案（等价于旧"推荐动作"，但呈现为直答）。
- 现有 `useClipboardObjectBlock` / `actionRecommendation` 的"推荐动作"逻辑**收敛为直答 resolver 的一个输入源**（source=`clipboard`）。
- Object Block token 最多退化为一枚轻量**"来源指示"chip**（表明这批答案来自剪贴板某内容），不再承载独立的动作列表。
- 落地时清理/改写 `src/launcher/clipboard/*` 中与"推荐动作行"相关的分支，避免双轨。

---

### 3.6 已知陷阱 · 静默失效史（2026-08-20 复盘）

自学习这套东西的失败模式**不是崩溃，是「看起来学会了，其实永远不发火」**。规则落库、设置页显示「已学」、埋点也有记录——只有用户知道它没反应。已发现两例，根因相同：**同一个语义被两处独立实现，而没有测试锁住它们一致。**

**① learn / fire 分类不对称**（`urlTemplate.ts`）

```
learn 期: slotKindForToken(tok) = classifySegment(tok) ?? 'id'   // 兜底成 id
fire 期: queryMatchesSlot(q, k) = classifySegment(q) === k       // 没有对应兜底
```

`claude-code` / `PROJ-1234` / `my-doc-slug` 全部学成 `{id}`，但 fire 期 `classifySegment` 对它们返回 `null` ≠ `'id'` → 规则永不命中。

**修法（结构性，而非补丁）**：两侧共用 `classifyTokenSlot`，让对称性成为**函数同一性**而不是约定；宽分类是保守分类的严格超集（有测试锁）；分类不出来就**拒绝建规则**（宁可不学，也不学一条学不会发火的）。

**② 直答项 priority 被 kind 吞掉**（`ranking.ts`）

为绕过 query-present 过滤把 learned item 从 `kind:'host'` 改成 `kind:'dynamic'`，但 `staticPriority()` 当时只认 `kind==='host'` → **P3 的 frecency 排序、发火期 host 消歧两个功能全程无效**，从未有人察觉。

**修法**：`directAnswer` 一等语义（免过滤 + priority 不受 kind 限制），hack 撤除。

**给后续的判断口径**：

```
只要「产出侧」和「消费侧」对同一概念各写了一次判定，
就必须有一条不变量测试把它们钉在一起——
否则它不会报错，只会安静地不工作。
```

现有两条不变量测试：`test:learning-urltemplate`（能学的必须能发火 + 护栏探测 token 必须自洽）、`test:launcher-direct-answer`（答案免过滤 + priority 真实生效）。

---

### 3.7 提议卡下线 · 改为静默学习（2026-08-20 拍板）

**埋点证据**（`~/.local/hiven/logs/`，含轮转）：

```
proposal_ready   216 次   ← 只有 7 个唯一签名，最高一条被推了 64 遍
rule_accepted      0 次
rule_rejected      1 次
rule_fired         0 次
```

转化率 0/216。根因不是「问」这个设计，而是**「问了不记得问过」**：`filterProposableCandidates` 只认两种终态——`learned`（接受）、`suppressed`（拒绝）。**「忽略」不是终态**，所以关掉 launcher 后下次开窗原样再来。

**决策：去掉提议卡，改为静默学习 + 首次发火可见可逆。** 按「学错的代价」分层：

| 代价 | 处理 |
|---|---|
| 只是多一条候选、排序变化 | 完全静默，靠 frecency 半衰期自动遗忘 |
| 有副作用（url-template 会开浏览器） | 静默建规则，**首次发火时可见 + 可撤销**，不事前问 |

**核心替换：用行为当确认，而不是用卡片当确认。** 用户重复 3 次本身就是信号，再弹卡问一遍是冗余。真正的确认是「第一次用了这条规则」——用了就固化（`FIRE_STRENGTH_BONUS`），不用就衰减遗忘（`isForgettable` + `pruneForgottenRules`）。这套自净机制本就存在，只是过去被「必须先接受提议」挡住，从未运转过。

**安全属性**（`test:learning-autolearn` 锁定）：

- 静默规则初始 strength = 2（远低于确认规则的 `distinctInputs`），约 6 周不用自动遗忘
- 每轮最多学 3 条，不灌爆直答区
- 学过的 clusterKey 永久离池 → 216 次重复不可能重现
- 前 3 次发火带「新学的」标记 + 紧随一条「不要这条」项
- **撤销 = 删除 + 抑制**（缺一不可：只删的话下一轮 auto-learn 会把用户刚拒绝的规则原样学回来）

撤销做成普通 launcher item 而非 `⌘⌫` 快捷键：launcher 键盘模型是调过的（提议卡当初就刻意避开方向键模型），且快捷键不可发现。

**待观察**：`rule_auto_learned` vs `rule_fired` vs `rule_undone` 三者比例。**大量学到、极少发火 = 学习在猜**，那是下一个要解决的问题——静默不该掩盖质量差。

---

### 3.8 学习结果的归属 · 交给已拥有该概念的插件（2026-08-20）

学到的 url-template（「输入 MR 号 → 打开那个 MR」）和用户手写的网页快开规则，**是同一个东西的两个所有者**。各存一份的代价：两份列表做同一件事，而学到的那份**只能删、不能改**。

**机制：sink，`coverage` 的镜像**

```
coverage.register  → 插件说「这个我已经能处理，别学」
learning.registerSink → 插件说「你要真学到了这类，给我」
```

`autoLearnNow` 先把候选 offer 给 sinks；被认领则 host 不留副本，规则落在插件自己的列表里——**可见且可编辑**。

依赖方向不变（host 不依赖插件）：offer 是纯结构描述（`template` + `slotKind`），把它翻译成什么由认领方决定。`ruleSink.ts` 有契约测试 grep 插件词汇，防止产品语义回流到 host。

**顺带补齐的能力**：插件此前只能读 settings 不能写，认领的规则无处可存 → 新增 `settings.update`（走 settings UI 同一条 resolve→set→onChange 路径）。onChange 那一环是必须的：web-open 在那里重新注册 coverage，跳过就会导致刚交出去的规则被重新学一遍。

**又一处跨层不对称风险（已用测试锁住）**：host 用 `classifyTokenSlot` 判定 slot kind，插件用正则匹配 query。两者漂移 = 学到了永不发火（正是 §3.6 ①的模式）。`test:web-open-learned-rules` 把 host 的 `representativeTokens` 灌进插件生成的正则，强制两边一致。

### 3.9 访问频率信号 · 双尺度 frecency（2026-08-20）

首屏推荐要同时表达两类「值得回去」：

| 类型 | 例子 | 特征 |
|---|---|---|
| habit | 常用 AI 站 | 跨度长、持续 |
| burst | 本周需求的 PRD/MR/技术方案 | 短期密集，上线即冷 |

单一半衰期表达不了：慢衰减会让已上线的 PRD 挂榜数周（停 20 天在 45 天半衰期下仍剩 73%），快衰减会让长期习惯在安静期掉出去。

**解法**（`src/workspace/launcher/visitFrecency.ts`）：

1. 快尺度（2 天半衰期）抓「当下在搞」，慢尺度（45 天）抓「长期习惯」，取 max
2. **慢尺度用访问跨度门控**（`habitFactor = span / 30天`）——三天的猛点击不能冒充数月的习惯，这是把已上线 PRD 压下去的关键
3. **两个尺度必须归一化后再比**：原始衰减计数跨尺度不可比（慢尺度天然累加更多历史，`max()` 会永远偏向它）。除以各自半衰期得到「次/天」，才是同一量纲

数据源分两级：`chrome.history.getVisits` 给真实时间戳序列（扩展 0.3.0+，`visits` 字段一路 optional 保证旧扩展不炸）；旧扩展只有 `visitCount`+`lastVisitTime`，落 `visitFrecencyFromSummary` 近似（log 阻尼处理量，但**拿不到 span 信号**）。

**已知缺口**：`recordNavigation` 只记录能模板化的 URL，`claude.ai` 这类无 id 段的常用站首页一条不存——habit 这一类目前只能靠浏览器历史，hiven 自身没有观察底座。

---

### 3.10 位置方差归纳 · 自发现文本变量段（2026-08-20）

`classifyPathSegment` 保守是对的：单条 URL 分不清 `merge_requests`（常量）和 `claude-code`（变量），按形态猜会把常量段变成槽。代价是 `github.com/{owner}/{repo}` 这类**纯文本变量**永远发现不了。

**跨样本证据能解决单样本解决不了的事**：按 `host + 段数` 分组，逐位置统计 distinct 值。某位置取到很多不同值 = 变量（不管长什么样）；从不变化 = 路径常量。

**两个判断刻意分开**（`positionVariance.ts` + `learningController`）：

```
① 哪些位置在变     → 跨样本、只比 hash 相等性
② 变的位置能否发火 → 看该位置实际值的形态（classifyTokenSlot）
```

②是防止产生"万能规则"的关键：`react`、`core` 这种裸词位置**确实在变**，但用它做规则会让用户输入任何词都触发。所以变量位置的值分不出形态 → 不建规则。于是 `github.com/anthropics/{repo}`（你常去自己 org）能学，`github.com/{owner}/{repo}` 全裸词的不学。

护栏：变量位置 > 2 拒绝；全部位置都在变拒绝（`cdn.x.org/{a}/{b}/{c}` 匹配一切等于什么都没说）。

**隐私**：归纳只需相等性，故只存 per-segment salted hash（store v4 `paths`）。但拼模板需要常量段的**字面值**，所以 navigationSensor 在内存里保留每个形状最近一条具体路径（不落盘，重启丢失只延迟发现、不丢失发现）。

### 3.11 收藏推荐 · 只推 habit 不推 burst（2026-08-20）

「你常开这个，要不要留着？」只对**长期有用**的东西成立。本周猛刷的 PRD 周五上线后就是收藏夹里的垃圾；开了几个月的站才该留。

所以推荐**按访问模式而非访问频次**判定（`favoriteSuggestion.ts`）：

```
habit → 推荐          （长跨度 + 仍活跃）
burst → 永不推荐      （无论此刻多热）
stale → 永不推荐      （含"曾是习惯但已荒废"）
```

呈现遵守 §3.7 拍板的原则：**不弹窗问**。命中的项把 kind 标签换成「常去」，出现在 `⌘P`（收藏快捷键）本来就够得着的地方——推到眼前，不打断。

**信号/算法分工**（呼应 host-plugin 通用性原则）：`DesktopTarget.visits` 是一等的通用字段，**插件只报「什么时候访问过」，host 决定「据此得出什么结论」**（排序用双尺度 frecency，去留用 habit/burst 判定）。站点知识不进 host，排序策略不进插件。

---

## 4. 被动观察自学习层（核心）

### 4.1 为什么必须"被动"

用户的关键追问：**"功能不完善时我可能不会直接用这个软件，怎么后台学习？"**
→ 若自学习只靠"你在 hiven 里执行命令"喂数据，会陷入冷启动死循环。**所以主力信号必须来自后台被动观察你在别处正常干活**，"在 hiven 内执行"只是补充的一路。

### 4.2 三个被动传感器（都不需要主动用 hiven）

1. **剪贴板时间线（最强）** — hiven 本就盯剪贴板（`clipboardSnapshot` + age 追踪）。被动记录**内容前后配对**：`t0` 剪贴板=JWT，`t0+Δ` 剪贴板=解码后 JSON（你在别处解的）→ 推断"JWT → 想要解码结果"。**学的是输入→输出配对**，之后用内置 resolver 复现该变换。
2. **浏览器流** — 现有 `desktop_bridge`（Chromium 扩展推快照到 `127.0.0.1:19246`，见 `bridgeTargets.ts` 的 `DesktopBridgeTargetDto`：已含 `url/title/favicon/active/appName`）。被动统计反复出现的 URL 结构 → 预先播种规则（如 `code.byted.org/…/commit/<hex>` → "SHA→commit 页"）。**深化需给扩展加：页面选中文本 / 导航事件 / 历史。**
3. **前台 App × 剪贴板 × active 标签** — 后台把三者的时间线合成 episode（前台 App 用现有 `current_foreground_app_context()`）。

### 4.3 数据结构

```
Episode = {              // 被动观察到的一次"处境+行为"
  at: number
  input: { features: InputFeatures, detectedType?, saltedHash: string }  // 不存原文
  transform?: { toolId?: string, inferredFromClipboardPair?: boolean }
  destination?: OutputDestinationId | 'external'
  context: { foregroundApp?: string, browserUrlShape?: string, timeBucket: string }
}

ClipboardPair = {        // 剪贴板时间线推断出的输入→输出
  inFeatures: InputFeatures, inType?
  outFeatures: InputFeatures, outSample: saltedHash
  gapMs: number          // 配对时间窗（见 §4.6 待定）
}

InputFeatures = {        // §5.2
  len: number, charset: 'digits'|'hex'|'base64'|'alpha'|'mixed',
  hasSpace, hasNewline, lineCount, matchesUrl, matchesEmail, prefix?
}

LearnedRule = {
  id: string
  matcher: { kind: 'type', type } | { kind: 'regex', source: string, captures: string[] }
  humanLabel: string     // 人话（i18n），如"看起来像提交号：hex，7–40 位"
  transform:                                    // 三种形态（§11）
    | { kind:'tool', toolId: string }           // 单步纯变换（§4.6）
    | { kind:'chain', toolIds: string[] }        // 多步链式塌缩（场景 B）
    | { kind:'url-template', template: string }   // 内容→URL（场景 A/D，带 capture 占位）
  destination: OutputDestinationId
  strength: number       // frecency，回喂调整
  origin: 'learned'
  createdAt, lastUsedAt, sampleCount
}
```

### 4.4 机制流水线

```
① 观察   被动传感器 → Episode / ClipboardPair（运行时可读的本地存储）
② 聚类   按「输入特征签名 × 工具/变换 × 去向」归堆；≥阈值(默认3)且一致 → 候选
③ 归纳   从样本长出：不过宽的 matcher（字符集+长度区间）+ 抽 capture → 去向模板
④ 提议   唯一一次人确认：人话展示规则，可确认/微调/拒绝（永不 → 抑制该堆）
⑤ 命中   规则进 §3 直答 resolver，与内置一起排；标"你教的"
⑥ 回喂   用了 +strength、往前排；忽略/关闭 −strength；长期不用自动遗忘
```

### 4.5 两个真正的难点（不含糊）

1. **泛化**：从"这个 SHA"到"任何 SHA"。解法 = 特征签名聚类 + **保守**正则归纳（仅字符集/长度区间，不做语法归纳）+ **过宽否决**（若 matcher 会命中最近 M 条非本堆输入则拒绝）+ **提议时人确认/微调**。人把关这一步既安全又透明。
2. **去向模板**：结果要填进哪。解法 = 规则存**带 capture 的模板**（`…/commit/{hex}`）；拿不准的变量（如 repo）在提议时让用户钉一次。

### 4.6 剪贴板配对判定（决策：验证式配对）

不靠"猜时间窗"判定是否同一次操作，改用**验证式配对**——把"是不是同一次操作"从模糊计时变成"能否复现"的确定判定：

```
剪贴板 A → B 变化：
  ① 粗时间窗预筛（默认 ~2s–2min）：只用来限定候选，不做判定
  ② 验证：用 hiven 自己的内置变换集跑一遍 A，检测是否存在 T 使 T(A) ≈ B
       命中 → 确认对 (A, T, B)：高置信，且已知用哪个工具复现 → 直接可学
       未命中 → 弱"未知对"：低优先（反正复现不了），仅作弱信号留存
  ③ 加权：若 A/B 之间前台切到工具类 App，提升置信
```

优点：确定性判定 + 顺带确定了可复现的 `toolId`（省去"用户用了哪个工具"的猜测）。

**仍待实现时定：** 聚类阈值与 cooldown、同时最多提议数（默认 1）、特征签名维度取舍（§4.3 InputFeatures 为初版）、`T(A)≈B` 的近似判定容差。

---

## 5. 浏览器：信息路由的一等公民

- **来源**：当前 active 标签 URL/标题（已有）、页面选中文本（需扩展加）、剪贴板里的 URL。
- **上下文**：你此刻在哪个站 → 条件化直答（在 code review 页 vs 在翻译页，直答不同）与规则作用域。
- **目的地**：把结果开成新标签 / 打开推导出的 URL（复用 `urlSchemeRegistry.ts` 的 openUrl 路由）。
- **现有底座**：`desktop_bridge` + `browser-tabs` 插件（`DesktopBridgeTargetDto` 已有 url/active/favicon）。
- **已落地的浏览器信号**：扩展上报**浏览历史**（`POST /v1/sources/{id}/history`）以及 **`tab.opened` / `tab.activated` 事件**（`POST /v1/sources/{id}/events`）。学习层优先消费事件，并用历史做一次播种；active-tab 快照仍作兜底。原始 URL 只进内存桥，学习存储仍只写模板 + 盐哈希。
- **暂不做**：页面选中文本上报。

---

## 6. 护栏（隐私 / 不烦 / 可逆）

- **隐私**：不学 secret（复用现有 secret 检测）；episode/pair 只存**特征 + 盐哈希**，不存原文；**全本地**，不出网。
- **不烦**：阈值 + cooldown + 一次只提一个；**从不自动执行未确认规则**；被动观察可总开关。
- **可逆**："学到的规则"管理页可查看 / 停用 / 编辑 / 删除；遗忘机制兜底。

---

## 7. 落地位置 & 架构边界（遵守 CLAUDE.md 红线）

| 模块 | 位置 | 归属 |
|---|---|---|
| 直答 resolver 协议 + 排序 + 零查询 | `src/workspace/launcher/`（近 `intentEngine`/`ranking`） | framework/workspace（generic） |
| 具体内容逻辑（JWT/JSON/color…） | `src/plugins/*`、`src/kits/content` | plugin / kit |
| 内容类型识别 | `src/launcher/clipboard/clipboardSnapshot.ts` | 现有 |
| 被动观察层（episode / pair / 浏览器流采集） | `src/workspace/launcher/` 新增 + native/bridge | framework/workspace |
| 聚类 / 归纳 / 规则存储 | `src/workspace/launcher/` 新增模块 | framework/workspace |
| 提议卡 + "学到的规则"管理页 | launcher 呈现层 + settings surface | framework UI |
| 去向系统 | `src/workspace/launcher/output.ts`（扩展） | 现有 |

**红线**：
- 融合/学习引擎是 **generic**，不得内联具体产品语义（不写 JWT/JSON 的解析逻辑，只消费 detector/tool 的输出）。产品语义留 plugins/kits。
- **i18n**：直答 label、提议卡、规则人话、管理页、"你教的"标记等所有用户可见文案必须走 locale，禁 hardcode。
- **不动**：22 个插件能力、编辑器能力、桌面控制本身——只在其上加"直答 + 学习"这层。
- **依赖方向**：plugins → workspace API / kits；framework 不依赖 plugins；kits 不依赖两者。

---

## 8. 分阶段实现路线

| 阶段 | 目标 | 验证 |
|---|---|---|
| **P0 直答基座（无学习）** | 统一直答 resolver 协议；平移 calc/timestamp/jwt/json/color/base64/url；零查询直答剪贴板；去向系统接好 | 开窗即答；复制 JWT 开窗直接见解码，`↵` 复制、`⇥` 换去向；无命令步 |
| ↳ P0a 答案语义一等化（**已实现 2026-08-20**） | `LauncherItem.directAnswer` + 插件布尔声明 + ranking 三处支持（见 §3.1 修订）；fire.ts 去掉 alias/kind hack | `test:launcher-direct-answer` 全绿；learned 规则 priority 真正生效 |
| ↳ P0b 内置 resolver 平移（**未做**） | 给 calculator / jwt / json / color / base64 等声明 `directAnswer: true` | 会改变现有排序，建议先在真机验证观感再逐个开 |
| ↳ P0c Object Block 收敛（**未做**，§3.5） | 剪贴板推荐动作并入直答区，`src/launcher/clipboard/*` 双轨清理 | 风险最高，需先有 P0b 的实际观感 |
| **P1 被动观察层** | 运行时可读的 episode 存储；剪贴板时间线配对；前台 App + 浏览器流采集（先用现有 bridge 快照） | episode/pair store 有数据；能看到被动配对样本；secret 被跳过 |
| **P2 聚类 + 归纳 + 提议** | 特征签名聚类；保守归纳（+过宽否决）；提议卡（唯一确认）；LearnedRule 存储 + 管理页 | 重复 3 次触发提议；确认后规则落库；管理页可停/删 |
| ↳ P2a（已实现） | `cluster.ts` 纯核：聚类 + distinct 守卫 + 过宽否决；`test-learning-cluster` 契约 | 阈值/守卫/否决全测通 |
| ↳ P2b（已实现） | `proposals.ts` 纯核（描述子/铸规则/过滤）；store v2（rules/suppressions）；`learningController`；`window.__hivenLearning` 调试钩子；3 个提议埋点 | 攒够证据可提议；accept 落库、reject 抑制 |
| ↳ **P2c 提议卡（已实现后又被移除 2026-08-20，见 §3.7）** | launcher 提议卡（`LearningProposalCard`，全 i18n，鼠标驱动不入方向键模型）；工具名按 locale 从 registry 解析；设置页「已学」管理页（`LearnedRulesContent`，删规则/恢复忽略）；共享标签 `learningLabels` | 空查询开窗见提议卡；设为直答/不用；设置页可删规则、恢复被忽略的堆 |
| **P3 命中 + 回喂** | learned rule 进直答排序；frecency 回喂；遗忘 | 学到的规则命中出直答（标"你教的"）；用/不用调权生效 |
| **P4 浏览器深化（可并入）** | 扩展加：页面选中文本 / 导航事件 / 可选历史；站点作用域规则 | 在特定站点出条件化直答；选中文本作为输入源 |

每阶段独立可用、可验证；P0 已让产品"第一天就好用"，学习是增量叠加。

---

## 9. 验证要求（每阶段沿用）

```bash
npm run check:architecture     # 边界红线（引擎不得含产品语义）
npm run check:reachability
npm run test:quality-gate
npm run build
```

- 涉及 UI 的阶段补浏览器/真机验证，看真实画面（视觉守立体白红线，见 `PRODUCT.md`）。
- 被动观察 / 学习相关新增契约测试：配对时间窗、过宽 matcher 否决、secret 跳过、遗忘。

---

## 10. 已定决策（2026-08-12 拍板）

1. **剪贴板配对** → 验证式配对（§4.6）：粗时间窗预筛 + "能否用内置变换复现 B" 做确定判定，命中即得可复现 toolId。
2. **浏览器深化** → 只做**浏览历史**被动上报（§5）；暂不做选中文本 / 导航事件。
3. **与 Object Block 合并** → **只保留直答区**（§3.5）：直答区吸收剪贴板推荐动作，Object Block 退化为来源 chip，不并存两套。
4. **冲突优先级** → **学习规则优先但不压制内置**（§3.3）：learned 占 `↵` 首位，builtin 共存排后，强度衰减兜底。
5. **首批可学习场景** → **A / B / D（§11）**；暂缓从现有插件 retrofit（JSON/base64）入手——那增量小、易被评"没本质区别"，自学习主场是插件覆盖不到的长尾/字节特有路径。

**仍开放（实现时定，非阻塞）：** 聚类阈值 / cooldown / 提议节流；特征签名维度；`T(A)≈B` 容差。

---

## 11. 可学习场景目录（首批深化：A / B / D）

> 三者均复用 §4 机制。**唯一机制增量**：`LearnedRule.transform` 增加 **chain（有序多步）**（§4.3）；配对判定从"内容→内容"（§4.6）增加两路——**内容→导航**（复制的 token 出现在随后访问的 URL 里）与**历史 URL 模板归纳**。观察 / 聚类 / 提议 / 命中 / 回喂 / 护栏均不变。

### A. 输入→输出配对 · 内容 → 内部工具（个人 / 字节长尾）

- **传感器**：剪贴板时间线 + 浏览历史（§5）+ 前台 App。
- **配对判定（内容→导航）**：复制内容 C 后，短窗内你在浏览器访问了 URL U，且 **U 路径里包含 C（或其规范化形式）** → 确认配对 (C, U)。"包含"即此处的验证（类比 §4.6 的 `T(A)≈B`）。
- **聚类归纳**：按 C 特征签名聚类；取多次配对中 U 的**公共模板**、把 C 落点抽成 capture → `url-template`；变化槽（如 repo）提议时钉。
- **提议**："你最近 3 次复制这种 hex 串后都开了 code.byted.org 的 commit 页，设为直答？"
- **LearnedRule**：matcher `^[0-9a-f]{7,40}$` → transform `url-template: code.byted.org/{repo}/commit/{hex}` → destination 开浏览器标签。
- **字节例子**：SHA→commit ｜ PSM `x.y.z`→Argos/Grafana ｜ LogID / trace_id→日志平台 ｜ Meego 单号→需求页。（正是你现在得手搓 web-open entry 的活。）

### B. 链式塌缩 · 多步 → 一步（最强"缩短路径"）

- **传感器**：剪贴板时间线（纯内容链）。
- **配对判定（链）**：短窗内剪贴板出现 `C0 → C1 → C2`，且每一跳都被 §4.6 验证式配对确认（`C1=T1(C0)`、`C2=T2(C1)`）→ 记为链 `[T1, T2]`。
- **聚类归纳**：相同「输入特征签名 × 变换序列」重复到阈值 → 候选；matcher 落在 C0 特征。
- **提议**："你最近 3 次都把这种内容先 URL 解码、再 JSON 格式化，合并成一步直答？"
- **LearnedRule**：matcher C0 特征 → transform `chain: [url-decode, json-prettify]` → destination 末步落点。
- **命中**：一个回车顺序跑完链、直出最终结果。
- **字节例子**：抓包 `%7B%22..%22%7D`→解码+格式化 ｜ base64 blob→解码+美化 ｜ 转义串→去转义+格式化。

### D. 站点作用域 · 浏览历史模板归纳

- **传感器**：浏览历史（§5，已定只做历史）。
- **归纳**：高频访问 URL 按路径聚成模板、识别变化槽 → `code.byted.org/{repo}/merge_requests/{n}` 这类模板 + 变量。
- **两种产出**：
  1. **反向直答**：复制/输入吻合变量形态的 token（如 MR 号）时，提议开对应模板 URL（token 歧义时靠"最近所在站点 / 最近复制"消歧）。
  2. **站点作用域加权**：当前 active 标签属于某站点时，该作用域内的学习规则 / 直答排前。
- **与 A 的关系**：A 靠"复制→导航"配对确认 token→模板；D 靠历史直接发现你常去的模板；两者收敛到同一条 `url-template` LearnedRule，互相印证——合起来能自动学出你手搓的那些 web-open。
- **字节例子**：MR / PR 页、带 ID 的内部看板 / 监控、常去文档。

---

## 12. 实现规格 · 观察 + 配对层（P1，A/B/D 共同底座）

> 已在代码核实的三个前提：① **后台剪贴板观察已存在**（`clipboard-history` 的 `background/clipboardHistoryBackground.ts` 用 `clipboard.watch` + `pluginClipboard.ts` 轮询；`App.tsx` 常驻 `startClipboardAgeTracker`）→ 关窗也有剪贴板时间线，被动学习可行；② 纯变换散在各插件 `run(ctx)`，`kits/content` 只有 `detectClipboardType` → 验证器经 registry 通用 dry-run，不搬逻辑；③ 无 IndexedDB，telemetry NDJSON 只写不易查 → 学习库独立用 IndexedDB。

### 12.1 数据流

```
[后台传感器]
  剪贴板轮询（复用现有 clipboard-history background / age tracker，不新增轮询）
  浏览历史（§5，后加）
  前台 App（current_foreground_app_context）
      │ 内容变化 emit
      ▼
[Observer]  src/workspace/learning/observer.ts（新）
  归一化 → 抽 InputFeatures → secret 跳过 → 盐哈希 → 写 event → 触发配对
      ▼
[Store]  IndexedDB "hiven-learning"  src/workspace/learning/store.ts（新）
  events / pairs / rules
      ▼
(P2) cluster + induce + propose      (P3) fire + feedback
```

### 12.2 存储（决策：IndexedDB，独立于 telemetry）

- 不复用 telemetry NDJSON（native append、只写、难按签名查）；不用 localStorage（5MB 上限、无索引）。
- 新库 `hiven-learning`，object stores：`events`（index: featureSig, ts）｜`pairs`（index: inSig, kind）｜`rules`（index: matcher kind）。
- 隐私：event 只存 `{featureSig, detectedType, saltedHash, ts, context}`，**不存原文**；secret 跳过；盐每设备随机、仅本地。
- `store.ts` 薄封装：`open / put / queryBySig / prune`（容量上限 + 老化清理）。

### 12.3 配对判定（两路，均"可验证"）

**(a) 内容→内容 `T(A)≈B`（场景 B 每一跳）** — `src/workspace/learning/pairing.ts`

```ts
function verifyTransformPair(a: string, b: string): { toolId: string } | null {
  for (const tool of registry.candidatePureTools()) {   // 见下：纯工具判定
    if (tool.textMatch && !tool.textMatch(a)) continue    // 便宜预筛
    const out = runPure(tool, a)                          // 轻量 ctx，仅 input + capturing output
    if (out != null && normalizeEq(out, b)) return { toolId: tool.id }
  }
  return null
}
// normalizeEq：trim + 折叠空白；JSON 类先 canonical(parse→stringify) 再比，避免缩进差异误判
// runPure：造最小 ctx {input: manualText(a), params: defaults, output: capture, t, locale, settings,
//          api/storage/shell: noop}；纯工具不碰 api，安全
// candidatePureTools：**推断纯度，不改插件** —— 工具未声明 network.request / shell.run / clipboard.write
//          等副作用能力 → 视为纯变换候选（可选显式 directAnswer 标记覆盖）。honors "不动现有插件"
```
- **链（B）**：在剪贴板序列滑窗，连续两跳都命中 `verifyTransformPair` → 记 chain `[t1, t2]`。

**(b) 内容→导航 "URL 包含 token"（场景 A / D）**

```ts
function verifyContentUrlPair(copied: string, visitedUrl: string):
  { template: string; captureKind: string } | null {
  const norm = normalizeToken(copied)                 // trim；hex→lower；去引号
  if (!isPlausibleToken(norm)) return null            // 排除长文本 / 多行 / 空
  const { pathSegs, queryVals } = decomposeUrl(visitedUrl)
  const slot = [...pathSegs, ...queryVals].find(seg => segEq(seg, norm))
  if (!slot) return null
  return { template: replaceSlotWithCapture(visitedUrl, slot, '{tok}'),
           captureKind: classifyToken(norm) }          // hex / number / psm / …
}
```
- URL 来源：复制后短窗内的浏览器导航（bridge active 变化 / 历史新增）。
- **D 纯历史归纳**：对历史 URL 聚类成模板（数字/hex 段位当变量槽），无需"复制"事件也能发现常用模板；A 用"复制→导航"确认"哪种 token 对应哪个模板"。

### 12.4 Observer 生命周期 & 成本

- 订阅现有后台剪贴板变化流，**不新增轮询**。
- `verifyTransformPair` 只 dry-run 少量纯工具、带 `textMatch` 预筛，开销小；URL 配对仅在近期有复制 token 时跑。
- 全后台、本地、可总开关；secret / 长文本 / 空 跳过。

### 12.5 P1 交付与验证

- **交付**：observer + store + pairing(a/b)；**只观察落库，不提议**（提议是 P2）。
- **验证**：手动复制 A、在别处变换出 B 再复制 → store 出现 `pair(A_sig → toolId)`；复制 SHA 再开含该 SHA 的 URL → 出现 content-url pair；secret 不入库。跑 `npm run check:architecture`（learning 层在 workspace、不含产品语义——纯工具经 registry 通用调用）、`npm run build`。

### 12.6 落地边界（红线复核）

- `src/workspace/learning/*` 为 generic：不内联任何 JSON/base64/JWT 逻辑，只经 registry 通用 dry-run 工具、经 `detectClipboardType` 识别类型。
- 不改现有插件行为；"纯度"靠副作用能力推断，非 retrofit。
- i18n：P1 无用户可见文案（提议卡在 P2，届时全走 locale）。
