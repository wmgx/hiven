# 控制中枢：Intent 路由与桌面入口设计

**日期:** 2026-07-19  
**状态:** 已被吸收（Superseded）——本文内容已合并进 `doc/2026-07-19-launcher-intelligence-roadmap-design.md`（合并版），请以该文档为唯一实施依据。主要差异：§3 的纯命令式 `intentMatchers` 协议被「两级混合」（声明式 accepts 粗筛 + 可选 match() 精筛）取代；里程碑 M0–M5 重排进合并版 §8 的包①–⑧。本文其余内容（排序模型、桌面控制、安全分级、测试策略）被整体采纳。  
**产品:** hiven（原 FluxText）

---

## 1. 背景与目标

### 1.1 现状

hiven 已具备可用的插件 host 与 Global Launcher：

- 命令搜索、usage 排序、`textMatch` 内容加分
- `launcher.dynamicItems`（计算器、时间戳、web-open 等）
- Context Broker（前台 App、剪贴板、编辑器快照）
- WorkObject / WorkAction / Workflow 骨架
- App launcher、剪贴板历史、各类文本插件

缺口：**意图层不完整**——用户仍大量依赖「搜命令名」；桌面控制（窗口/进程等）未与文本智能同框；上下文未充分驱动推荐。

### 1.2 产品目标

把 Global Launcher 做成个人工作的 **统一智能入口（控制中枢）**：

| 维度 | 内容 |
|------|------|
| **A 文本智能工作台** | 更懂剪贴板/选区/输入，一步出结果 |
| **B 桌面启动与控制** | 开 App、管窗口/进程、浏览器/网页 |

### 1.3 约束（已确认）

| 决策 | 选择 |
|------|------|
| 入口形态 | **统一智能入口**（同一搜索框，不切 Text/System 模式） |
| 智能程度 | **规则 + 上下文优先**；一期不做 LLM；以后可挂可选 LLM |
| B 一期范围 | **本机 App、进程/窗口、浏览器/网页** |
| 成功标准 | **少搜命令名**（内容识别 + 短输入/别名命中） |
| 架构路线 | **方案 2：薄 Intent 路由层**；Object-first（方案 3）作为二期 |

### 1.4 非目标（一期）

- 云端 / 必选 LLM 意图理解
- 通用 RPA / 跨应用宏录制
- 完整 Shell 市场与任意命令默认入口
- Object-first 交互大重构
- 跨插件 runtime 依赖
- Windows/Linux 与 macOS 同周完整对等（优先 macOS 完整体验）

---

## 2. 架构总览

### 2.1 主路径

```text
唤起 Launcher
  → WorkContextSnapshot（前台 App / 剪贴板 / 编辑器…）
  → IntentEngine.match(query, context)
       ├─ host matchers（App、窗口/进程骨架）
       └─ plugin matchers（文本识别、别名、web-open…）
  → IntentHit[] 归一 / 抬分到 LauncherItem
  → ranking 扩展（intent + context + 现有项）
  → 单一列表展示 / 执行（L2 危险动作先确认）
```

- **空 query：** 靠 context + content 推荐（「打开就猜」）。
- **有 query：** 别名 Intent + 传统搜索 + dynamicItems 合并排序（「少搜全名」）。

### 2.2 与现有能力的关系

| 已有 | 角色 |
|------|------|
| `textMatch` | 保留；「内容能处理」→ ranking boost |
| `launcher.dynamicItems` | 保留；计算器、时间戳、web 动态项；Intent 可包装/加权，去重不双份 |
| `contextBroker` / `WorkContextSnapshot` | Intent 标准输入 |
| `ranking.ts` | 扩展槽位，不推倒重写 |
| `WorkObject` / `WorkAction` | 二期 Object-first 底座；一期 Intent 主要产出/抬高 LauncherItem |
| App launcher | 并入统一列表与排序 |

### 2.3 边界

| 层 | 负责 | 不负责 |
|----|------|--------|
| **Framework / host** | 快照、聚合 matcher、条数/超时、ranking 槽位、执行壳、确认 UI、权限检查、App/窗口/进程等 **受控 API 骨架** | JWT/JSON/Chrome 等产品语义、插件展示文案策略 |
| **Plugins** | content 规则、别名、web 语义、命令执行、i18n 文案 | 直接改 host 私有 ranking 常量、跨插件 import |
| **Kits** | 纯函数识别（可选，多插件共享且无 framework 对象时） | 运行时状态、host API |

依赖方向保持：

```text
plugins → workspace public API / kits
workspace → 不依赖 plugins
kits → 不依赖 workspace / plugins
```

---

## 3. Intent 协议

### 3.1 Contribution

插件可贡献 `intentMatchers`（实现时字段名可微调，语义不变）：

```ts
type IntentMatchContext = {
  query: string
  locale: Locale
  context: WorkContextSnapshot
  /** Object Block > 选区 > 剪贴板 */
  contentText?: string
}

type IntentHit = {
  id: string
  /** 0–1，host 映射到 ranking 量级 */
  confidence: number
  /** 指向已有 LauncherItem / command，或 host 生成项的稳定 key */
  target: { kind: 'systemKey' | 'command'; id: string } | { kind: 'inline'; item: LauncherItemDraft }
  reason?: 'content' | 'alias' | 'context' | 'query'
}

type IntentMatcher = {
  id: string
  priority?: number
  /** 同步、本地、可预期；抛错/超时则忽略 */
  match(ctx: IntentMatchContext): IntentHit[] | null
}
```

### 3.2 Host 规则

1. 只做快照、调用、聚合、裁剪、排序映射、执行与权限。
2. 不理解具体产品语义（不在 host 写 JWT/JSON 解析业务）。
3. Matcher **默认同步**；单个失败不影响其它。
4. 每插件 / 全局 **限命中条数**，防止刷屏。
5. 单 matcher **软超时**（实现时定预算，如数毫秒级；超时丢弃该 matcher 结果）。
6. Intent 指向已有 command 时：**抬分不复制** 第二条列表项。
7. 危险动作（结束进程等）**不得**因高 confidence 跳过确认。

### 3.3 contentText 决议

```text
Object Block 文本
  > 编辑器选区 / external selection（若恢复）
  > 剪贴板文本
  > （可选）query 本身像纯内容时参与 content 识别
```

- Global Launcher：默认对 contentText 跑 content Intent。
- App 内命令条：优先编辑器选区 / 当前 pane。
- 外部选区 capture 当前为禁用；**不阻塞一期**；恢复可作为独立任务。

---

## 4. 统一排序与列表融合

### 4.1 原则

| 原则 | 含义 |
|------|------|
| 单一列表 | 不切模式；用 type 标签区分命令/应用/窗口/进程/网页 |
| 匹配优先 | 强 query 名命中压过弱推荐 |
| Intent 是加分 | 与搜索、usage、dynamicItems 同一 pipeline |
| 情景分流 | 有 query 偏搜；空 query 偏猜 |
| 可解释 | hit 带 `reason`；调试可看 score 分解 |

### 4.2 分数模型

在现有 ranking 上扩展：

```text
score =
  matchScore
  + intentScore
  + contextBoost
  + usageScore
  + textMatchBoost
  + dynamicBoost
  + hostStatic / installFreshness
```

**量级意图（实现用常量表校准）：**

```text
精确/前缀命令名匹配     ≈ 3000–5000+
强 Intent（confidence≥0.85）≈ 2000–2800
dynamic / 强 textMatch       ≈ 800–900
contextBoost                 ≤ 400
usage                        ≤ ~100
```

保证：明确输入 App/命令名时名称匹配赢；仅贴 JWT/JSON 时 content Intent 顶上；常用 App 不在强文本意图场景永久压过 Format。

### 4.3 空 query vs 有 query

**空 query（打开即猜）**

1. content Intent（最多约 3 条）
2. 情景动作（前台 App → web 等 contextBoost）
3. 高频 usage
4. 少量最近 App（不刷满顶部）

**有 query**

- 传统搜索 + Intent 别名 + dynamicItems 合并去重后统一 rank
- 短 query 继续收紧误匹配；别名须 **显式注册**

### 4.4 类别共存

| 场景 | 行为 |
|------|------|
| 强结构化文本 | 文本 Intent 优先 |
| query 像 App 名 | App/窗口 boost |
| 动作词（解、格式化、翻译、打开） | 文本/工作流动作优先 |
| URL/域名 | web 优先 |
| 杀/结束/kill | 进程类优先，执行必确认 |
| 多类中等命中 | score 混排 + type 标签 |

### 4.5 去重

- 同一 `systemKey` / command id 保留最高分一条。
- Intent 只抬已有项分数，不复制。
- 与 dynamicItems 撞车：保留信息更完整者，分数取 max。

### 4.6 上下文加权示例

| 前台 | boost 方向 |
|------|------------|
| 浏览器 | web-open、URL、（有选区时）翻译 |
| 终端 / IDE | 格式化、编解码、JSON/YAML、行工具 |
| 聊天 / 飞书 | 翻译、剪贴板历史 |
| 任意 | 剪贴板强形态识别全局有效 |

前台缺失时降级为 content + usage，不阻塞。

### 4.7 性能与可观测

- 进程/窗口列表：**缓存 + 短 TTL**，避免每键全量扫描。
- ranking 常量集中配置；开发模式可输出 score 分解。
- 一期不做用户可配置权重 UI。

---

## 5. A：文本智能

### 5.1 三条命中路径

| 路径 | 触发 | 归属 |
|------|------|------|
| **Content** | 可识别 contentText | 插件 Intent matcher + `textMatch` |
| **Alias** | 短 query / 中英别名 | 插件 Intent matcher |
| **Direct search** | 命令名搜索 | 现有 searchable fields（兜底） |

目标：Content + Alias 覆盖日常高频；Direct search 保留。

### 5.2 Content 形态表（高置信、低误报）

| 形态 | 默认推荐（示意） |
|------|------------------|
| JWT | JWT 解码 |
| Base64 | Base64 解码 |
| URL 编码 | URL 解码 |
| JSON | 格式化（已 pretty 可推压缩） |
| YAML | YAML→JSON 等 |
| CSV/TSV | CSV 工具 / 转 JSON |
| URL | 打开网页 |
| 时间戳 | date-time-assistant |
| 表达式 | calculator（dynamicItems） |

宁缺毋滥：拿不准不推。普通中文句子空 query 不应乱推编解码。

### 5.3 Alias

- 规范化：小写、空白/标点变体、中英并列。
- 支持简单「动作词 + 对象」：`解` + content 像 JWT → 抬 JWT。
- 未注册别名不靠开放域猜测。
- 用户可见标题走 i18n；别名表可中英。

示例（非穷尽）：

```text
jwt / 解jwt / decode jwt  → JWT 解码
b64 / base64 解           → Base64 解码
fmt / 格式化 / pretty     → JSON 格式化（content 为 JSON 时 confidence↑）
转yaml / to yaml          → JSON→YAML
翻译 / translate          → 翻译
```

### 5.4 与 textMatch / dynamicItems 分工

| 机制 | 职责 |
|------|------|
| textMatch | 「能处理」→ boost |
| dynamicItems | 输入即结果（算式、时间戳、web 补全） |
| Intent matcher | 「现在最该做的动作」+ 别名 |

### 5.5 输入输出闭环

| 入口 | 默认输入 | 默认输出 |
|------|----------|----------|
| Global Launcher | contentText | 写剪贴板（延续现设计） |
| 编辑器命令条 | 选区 / pane | 原地替换 |
| Cmd+Enter | 同上 | 打开插件 surface 并带入（已有方向） |

一步到位：回车直接执行；能无参则无参；需参走现有 collect-input。

### 5.6 插件接入优先级

1. encode-decode（JWT/Base64/URL…）
2. json-tools / yaml / formatter
3. date-time-assistant / calculator（接别名）
4. translate
5. csv / line-tools（次优先）

协议先落地，高频包先接，不要求全插件一期写满。

### 5.7 A 质量门槛

- 标准 JWT / pretty JSON → top1 或 top3 内有正确动作。
- 核心别名有单测。
- 单次 content+alias 在预算内完成，不卡输入。

---

## 6. B：桌面控制

### 6.1 总原则

- Host 提供受控能力；列表语义与确认文案不污染 framework 产品语言。
- 与 A 同框、同 ranking。
- 读多写少；**结束进程 / 关窗口** 必须确认。
- 一期优先 **专用可审计 API**，不把任意 shell 当默认入口。

### 6.2 本机 App（B1）

- 搜索/打开已安装应用（加强现有 app-launcher）。
- 纳入统一 ranking：名称匹配 + usage + 轻 contextBoost。
- 空 query：仅少量最近 App，不刷顶。
- 强文本 content 意图时 App 让位。
- 一期不做卸载管理、不做应用内深链自动化。

### 6.3 浏览器 / 网页（B2）

- URL/域名 content 与 query → 打开。
- web-open 模板、参数历史、dynamicItems 保持；Intent 抬分不双份。
- 前台浏览器 → web 类 contextBoost。
- 当前页 URL：仅当低成本可得；否则不做，不阻塞。
- 一期不做完整书签管理器、不强依赖浏览器扩展。

### 6.4 窗口（B3）

- 列出可见窗口（应用名 + 标题）；主动作：**聚焦**。
- 可选：关闭窗口（需确认，API 允许时）。
- 别名：`切到` / `窗口` / `focus` + 关键词。
- 缓存 TTL 约 1–3s。
- 一期不做分屏/摆放布局引擎。

### 6.5 进程（B4）

- 按名搜索进程；动作：**结束进程**（优先温和终止；强杀非默认）。
- 空 query **不**默认列进程。
- 别名：`杀` / `结束` / `kill` + 名。
- **硬安全：** 回车 → 确认框（名 + pid）→ 才执行；失败可读。
- 关键系统进程 deny/warn 表（宁严勿松）。
- capability 未授权则不出现动作。
- 一期不做完整活动监视器 UI。

### 6.6 列表展示形态

```text
[图标] JSON 格式化          命令    来自剪贴板
[图标] Google Chrome        应用
[图标] Chrome · 设计文档    窗口    切到
[图标] node (pid 1234)      进程    结束…（需确认）
[图标] 打开 https://…       网页
```

### 6.7 与 Shell Runtime

| 本期 | 以后 |
|------|------|
| 开 App / focus 窗口 / 开 URL / 受控结束进程 | 通用 `shell.run` 与脚本生态 |
| 不把自由 shell 输入作为默认 Intent 入口 | 授权页 + 审计增强 |

### 6.8 交付顺序

```text
B1 App → B2 网页 → B3 窗口 → B4 进程
```

平台：一期 **macOS** 完整体验；其它平台允许能力降级。

---

## 7. 安全与权限

### 7.1 分级

| 级别 | 例 | 策略 |
|------|-----|------|
| L0 | 搜索、推荐、预览 | 默认可跑 |
| L1 | 写剪贴板、开 App/URL、聚焦窗口 | 直接执行 |
| L2 | 结束进程、关闭窗口 | **必须确认** |
| L3 | 任意 shell、强杀系统关键进程 | 一期不做默认入口 |

### 7.2 硬规则

- 高 confidence 不跳过 L2。
- L2 最小审计：时间、动作类型、目标摘要（pid/名）；不记剪贴板全文。
- 默认不上传 context；无云端意图。
- 生产日志默认不打 content 正文。

---

## 8. 里程碑

| 里程碑 | 目标 | 关键交付 | 完成定义 |
|--------|------|----------|----------|
| **M0 协议** | Intent 可插拔 | 协议、聚合、ranking 槽位、失败隔离 | 假 matcher 抬分；坏 matcher 不影响列表 |
| **M1 文本 A** | 内容 + 别名 | contentText、encode-decode/json 等 matcher、别名表、去重 | JWT/JSON 样例 top3 命中；别名单测绿 |
| **M2 App+网页** | 桌面同框 | App 统一排序；URL/web-open Intent；contextBoost | 搜 Chrome 能开；贴 URL 能开；与 JSON 推荐可共存 |
| **M3 窗口** | 切窗口 | provider + focus + 缓存 | 按标题/应用名 focus |
| **M4 进程** | 可控结束 | 搜索 + 确认 + 权限 | 无确认不能杀；关键进程拒绝/警告 |
| **M5 打磨** | 体感中枢 | 调参、空 query、可选 reason 副标题 | 自用高频少搜全名 |

**二期（本 spec 不展开）：** Object-first 深化、Shell Runtime 产品化、可选 LLM、跨命令 pipeline、外部选区恢复。

---

## 9. 测试策略

| 层 | 覆盖 |
|----|------|
| 单测 | ranking 量级顺序；content 样例；别名规范化；去重；L2 确认状态机 |
| 契约 | matcher 超时/抛错隔离；未授权无杀进程项 |
| 故事/集成 | 贴 JWT 解码；`fmt` 格式化；开 Chrome；kill+确认 |
| 架构 | `check:architecture` 边界 |
| 手工 | macOS 真机：前台切换、focus、权限、IME 下别名 |

沿用仓库 `scripts/test-*.mjs` 风格新增用例。

---

## 10. 成功度量

### 10.1 定性（主）

- 解 JWT/Base64、格式化 JSON、开常用 App、打开链接、切窗口——多数不必输入完整命令名。
- 推荐可预期：空 query + 普通中文不乱推编解码。
- 危险动作零误执行（必经确认）。

### 10.2 定量（可选自用观测）

| 指标 | 意向 |
|------|------|
| 零 query 直接回车比例 | 打开即用 |
| 短 query 成功率 | ≤4 字符或短中文即执行 |
| L2 确认覆盖 | 100%（测试保证） |
| 打开到可交互延迟 | 无感知卡顿阈值 |

一期不做复杂分析后台。

---

## 11. 风险

| 风险 | 缓解 |
|------|------|
| 排序打架 | 常量表 + score 日志；M5 调参 |
| 窗口/进程 API 权限与稳定性 | M3/M4 可延后；探测失败隐藏入口 |
| Matcher 拖慢输入 | 预算、缓存、限条数 |
| 范围膨胀 | 严格 M0→M5；Shell/LLM/Object-first 不进一期 |

---

## 12. 决策记录（brainstorm）

| # | 决策 |
|---|------|
| 1 | 目标 = A 文本智能 + B 桌面控制 |
| 2 | 统一智能入口，不切双模式 |
| 3 | 规则 + 上下文，一期无 LLM |
| 4 | B 一期：App、进程/窗口、浏览器/网页 |
| 5 | 成功标准：少搜命令名 |
| 6 | 架构：Intent 路由（方案 2）；Object-first 二期 |
| 7 | B 落地顺序：App → 网页 → 窗口 → 进程 |
| 8 | 平台一期主攻 macOS |

---

## 13. 下一步

1. 用户审阅本 spec，必要时修订。
2. 通过后用 **writing-plans** 产出实施计划（按 M0–M5 拆 task，含测试 agent / 实现 agent 边界）。
3. 在独立分支 / worktree 执行，避免直接在 main 大改。

---

## 14. 相关文档

- `docs/superpowers/specs/2026-07-01-launcher-interaction-optimization-design.md` — L0 剪贴板智能与一步到位
- `doc/instant-suggestion-plugin-design.md` — 输入即识别（与 dynamicItems 演进相关）
- `doc/future/shell-effect-runtime-design.md` — 二期 Shell
- `AGENTS.md` / `Agents.md` — plugin host 边界
- `PRODUCT.md` / `DESIGN.md` — 品牌与入口形态
