# Launcher 智能化增强路线设计（合并版）

日期：2026-07-19（v2，吸收 `docs/superpowers/specs/2026-07-19-control-hub-intent-design.md` 后的合并版）
状态：已评审（分段确认 + 两份设计对照裁决通过）
读者：执行 AI / 后续维护者。本文假定读者对代码库零了解，所有断言附文件路径证据。

## 0. 本版合并说明

本文合并了两份同日设计：

- 本文 v1（广度路线）：地基三件套 + 多包推进，覆盖工作流 / 脚本 / 飞书 / 隐式学习。
- Intent 设计（深度设计，另一位协作者产出）：Intent 协议、统一排序分数模型、别名系统、桌面控制（窗口/进程）、安全分级。

合并时的两个用户裁决：

1. **匹配协议 = 两级混合**：声明式 `accepts` 必填（host 零成本粗筛，不跑插件代码）+ 可选 `match()` 精筛函数（仅声明命中后执行，带超时预算）。取代 v1 纯声明式与 Intent 设计的纯命令式。
2. **推进顺序 = 文本智能 → 桌面控制 → 工作流/脚本 → 飞书**：桌面控制（窗口/进程）设计已完备、依赖少，提前；工作流是全新链式模型，等协议稳定后做。

Intent 设计原文的排序模型、安全分级、桌面控制、测试策略被整体吸收（下文注明出处节号）；其 `intentMatchers` 纯命令式协议被两级混合取代。

## 1. 背景与目标

hiven 已是可用的 launcher-only 控制中枢（托盘 + Global Launcher + host surfaces + Quick Editor，16 个 first-party 插件）。本设计回答「如何让它更智能、更懂用户要做什么」。

产品目标（两个维度，同一入口）：

| 维度 | 内容 |
|------|------|
| A 文本智能工作台 | 更懂剪贴板/选区/输入，一步出结果；短输入/别名命中，少搜命令名 |
| B 桌面启动与控制 | 开 App、开网页、切窗口、可控结束进程 |

已拍板约束：统一智能入口（同一搜索框不切模式）；规则 + 上下文优先，一期无 LLM；成功标准 =「少搜命令名」；平台一期主攻 macOS。

明确不做（一期）：云端/必选 LLM、通用 RPA/宏录制、自由 shell 默认入口、Object-first 大重构、跨插件 runtime 依赖。

## 2. 现状关键事实（设计依据，执行前请现场核对）

| # | 事实 | 证据 |
|---|------|------|
| 1 | Object Block 三段式模型（Object → Recommended Action → Output Target）已实现 | `src/launcher/clipboard/objectBlock.ts`（`LauncherObjectBlock`、`createClipboardObjectBlock`）；`src/launcher/clipboard/useClipboardObjectBlock.ts`（打开时读剪贴板、`mode: 'object-action' | 'search-only'`、Backspace 二段删除） |
| 2 | 剪贴板动作推荐已按 kind 分发并合并插件清单 | `src/launcher/clipboard/actionRecommendation.ts`（`CLIPBOARD_ACTIONS_BY_KIND`、`recommendActionsWithPlugins`）；`src/launcher/clipboard/pluginActionManifest.ts`（`discoverActionsForBlock`） |
| 3 | 剪贴板新鲜度规则已有（旧内容不自动挂） | `src/launcher/clipboard/clipboardSnapshot.ts`（`shouldAutoAttachClipboard`） |
| 4 | `instantSuggestions` contribution 已被删除，勿引用其设计文档接口 | commit `73b97bb`；现行机制是 `PluginDefinition.launcher.dynamicItems`（`src/workspace/launcher/types.ts` `LauncherDynamicItemProvider`），calculator / date-time-assistant 均用它 |
| 5 | WorkAction 已有 `accepts` / `requiresContext` 过滤机制 | `src/workflow/workObject.ts`、`src/workflow/workAction.ts`、`src/workflow/workflowRegistry.ts`（`getWorkActions`） |
| 6 | `textMatch` 内容加分机制已存在：插件项可声明 textMatch，对 contentText 命中则 `TEXT_MATCH_BOOST`，只加分不过滤 | `src/workspace/launcher/ranking.ts`（L147-151、L187） |
| 7 | 输出路由统一出口已有（copy / paste / editor / surface） | `src/workflow/outputRouter.ts`（`routeTextOutput`） |
| 8 | 前台应用感知原生层完备：取前台 app 名 / pid / 窗口标题、唤起时记住并恢复焦点 | `src-tauri/src/lib.rs`（`current_foreground_app_context`、`remember_previous_foreground_app`）；前端 `src/launcher/context/contextBroker.ts`（`foregroundContextProvider` → `WorkContextSnapshot.foreground`） |
| 9 | 前台应用尚未作为权限暴露给第三方插件 | `src/workspace/pluginTypes.ts` `PluginPermission` 列表中无相关项 |
| 10 | launcher usage 只记 `{count, lastSelectedAt}`，存 localStorage（zustand persist `hiven-settings`），无执行序列 | `src/workspace/launcher/types.ts`（`LauncherUsageRecord`）；`src/store.ts`（`launcherUsageBySurface`）；消费方仅 `src/workspace/launcher/ranking.ts` `usageScore` |
| 11 | SQLite 基础设施已就绪（rusqlite bundled，`plugin_kv_*` 命令族 + 单测） | `src-tauri/Cargo.toml`；`src-tauri/src/lib.rs`（`plugin_kv_get/set/list/usage/prune/clear`）；前端 `src/workspace/pluginStorage.ts` |
| 12 | kit 机制已有，插件经 SDK 注入使用、不直接 import | `src/kits/diff/*`；`src/pluginHostSdk.ts`（`PluginHostKits`、`createPluginHostKits`）；约定见 `doc/plugin-directory-convention.md` |
| 13 | 程序化多步工作流不存在；命令执行是单跳 Object→Action | `src/workspace/launcher/controller.ts`（`selectItem`、`applyResult`）；全仓无 pipeline/macro 机制 |
| 14 | 旧单文件脚本体系已退役、无迁移路径；自定义能力形态 = 目录插件（New Plugin 脚手架） | `doc/plugin-directory-convention.md`（Compatibility Release 一节）；`src/workspace/pluginScaffold.ts` |
| 15 | 外部选区 capture 当前禁用（Intent 设计 §3.3 记载），不阻塞一期 | 恢复可作为独立任务 |

**重要推论**：现状已有三套匹配雏形——`pluginActionManifest`（剪贴板动作）、`WorkAction.accepts`（workflow 过滤）、`textMatch`（ranking 加分）。本设计统一为一套两级混合协议（§5），不新增第四套。

## 3. 业界参考结论（吸收 4 条）

调研对象：Raycast、Alfred、LaunchBar、uTools、Script Kit、PopClip。

1. **uTools 声明式 matcher**（regex/over/img/files/window）：匹配阶段纯声明、不执行插件代码 → `accepts` 声明层。
2. **PopClip 两级过滤**（requirements 谓词粗筛 + regex 精筛）→ 两级混合协议的直接原型。
3. **Raycast 把 frecency 开放为可复用 hook** → 远期 frecency-kit 下沉为 kit。
4. **Alfred Universal Actions 单一类型系统同时服务内置与三方** → 内容类型协议全局唯一。

另：Alfred Workflows 画布是成熟编排模型，但本设计工作流期只做线性链（YAGNI）；Raycast Script Commands「头部注释即 manifest」是脚本包的体验标杆。

## 4. 总体架构

主路径（吸收 Intent 设计 §2.1）：

```text
唤起 Launcher
  → WorkContextSnapshot（前台 App / 剪贴板 / 编辑器…）
  → contentText 决议（Object Block > 编辑器选区 > 剪贴板）
  → content-kit.detectContent(contentText) → ContentDetection[]
  → 两级匹配：accepts 声明粗筛（host，零插件代码）
       → 命中者可选 match() 精筛（插件代码，超时预算内）
  → 命中归一 / 抬分为 LauncherItem（抬分不复制，去重）
  → ranking 扩展槽位统一排序（§6）
  → 单一列表展示 / 执行（L2 危险动作必确认，§9）
```

- 空 query：靠 context + content 推荐（「打开就猜」）。
- 有 query：别名 + 传统搜索 + dynamicItems 合并排序（「少搜全名」）。

边界分配（遵守 CLAUDE.md 插件系统边界）：

| 层 | 负责 | 不负责 |
|----|------|--------|
| kit | 内容类型识别纯函数；远期 frecency 算法 | 运行时状态、host API、产品策略 |
| framework / host | 快照、contentText 决议、accepts 求值、match() 调度（限条数/超时/失败隔离）、ranking 槽位、执行壳、确认 UI、权限检查、App/窗口/进程受控 API 骨架、journal 写入 | JWT/JSON/Chrome 等产品语义、插件展示文案 |
| plugin | accepts 声明、match() 精筛、别名表、动作执行、i18n 文案 | 直接改 host 私有 ranking 常量、跨插件 import |

依赖方向保持：`plugins → workspace public API / kits`；`workspace 不依赖 plugins`；`kits 不依赖 workspace / plugins`。

## 5. 统一匹配协议（两级混合，本设计核心）

### 5.1 声明层：accepts（必填，host 零成本求值）

落在 `WorkAction` / `PluginToolContribution`（`src/workspace/launcher/types.ts`）的声明字段上：

```ts
accepts?: {
  kinds?: ContentKind[]   // content-kit 识别的类型（json/url/timestamp/base64/color/csv/jwt/…）
  regex?: string          // 在 normalized 文本上精筛（声明层，host 执行）
  aliases?: string[]      // 短输入/中英别名，显式注册（规范化：小写、空白/标点变体）
  apps?: string[]         // 前台应用名匹配（文本智能包启用）
}
```

- host 对剪贴板的 `ContentDetection[]`、query、前台应用求值所有插件的 `accepts`——纯数据匹配，不执行任何插件代码。
- 未声明 `accepts` 的项不参与 Intent 推荐（只走传统搜索）。

### 5.2 精筛层：match()（可选，仅声明命中后执行）

```ts
match?(ctx: IntentMatchContext): IntentHit[] | null

type IntentMatchContext = {
  query: string
  locale: Locale
  context: WorkContextSnapshot
  contentText?: string
  detections: ContentDetection[]   // content-kit 结果，插件不必重复识别
}

type IntentHit = {
  id: string
  confidence: number   // 0–1，host 映射到 ranking 量级
  target: { kind: 'systemKey' | 'command'; id: string } | { kind: 'inline'; item: LauncherItemDraft }
  reason?: 'content' | 'alias' | 'context' | 'query'
}
```

Host 调度规则（吸收 Intent 设计 §3.2）：

1. `match()` 只对 accepts 命中的插件调用——插件装得多也不拖慢输入。
2. 同步、本地、可预期；单 matcher 软超时（数毫秒级预算，超时丢弃）；抛错/超时不影响其它插件。
3. 每插件 / 全局限命中条数，防刷屏。
4. Intent 指向已有 command 时：**抬分不复制**第二条列表项。
5. 危险动作不因高 confidence 跳过确认（§9）。

### 5.3 contentText 决议链（吸收 Intent 设计 §3.3)

```text
Object Block 文本 > 编辑器选区（若恢复）> 剪贴板文本 >（可选）query 像纯内容时参与识别
```

Global Launcher 默认对 contentText 跑 content 推荐；App 内命令条优先编辑器选区 / 当前 pane。

### 5.4 三套旧机制的收编计划

| 旧机制 | 处置 |
|--------|------|
| `pluginActionManifest.discoverActionsForBlock` | 包①一次性迁移到 accepts 求值，不留双轨 |
| `WorkAction.accepts` | 扩展为 §5.1 统一字段（同名字段，原地增强） |
| `textMatch` + `TEXT_MATCH_BOOST` | 一期保留不动（向后兼容）；协议稳定后作为独立清理项迁移为 `accepts.kinds/regex`，迁移前 Intent 命中与 textMatch 撞车按 §6 去重取 max |
| `launcher.dynamicItems` | 保留（输入即结果：算式/时间戳/web 补全）；与 Intent 撞车去重取 max，不双份 |

## 6. 统一排序与列表融合（整体吸收 Intent 设计 §4）

分数模型（在现有 `ranking.ts` 上扩展槽位，不推倒重写）：

```text
score = matchScore + intentScore + contextBoost + usageScore
      + textMatchBoost + dynamicBoost + hostStatic / installFreshness
```

量级意图（实现用常量表集中配置并校准）：

```text
精确/前缀命令名匹配          ≈ 3000–5000+
强 Intent（confidence≥0.85） ≈ 2000–2800
dynamic / 强 textMatch       ≈ 800–900（现有 DYNAMIC_ITEM_BOOST = 900）
contextBoost                 ≤ 400
usage                        ≤ ~100
```

保证：明确输入 App/命令名时名称匹配赢；仅贴 JWT/JSON 时 content Intent 顶上；常用 App 不在强文本意图场景永久压过文本动作。

空 query（打开即猜）：content 推荐（最多约 3 条）→ 情景动作（contextBoost）→ 高频 usage → 少量最近 App（不刷满顶部）。
有 query：传统搜索 + 别名 + dynamicItems 合并去重统一 rank；短 query 收紧误匹配；别名须显式注册，不做开放域猜测。

去重：同一 `systemKey`/command id 保留最高分一条；Intent 只抬分不复制；与 dynamicItems 撞车保留信息更完整者、分数取 max。

上下文加权示例：浏览器前台 → web-open/URL/翻译；终端/IDE → 格式化/编解码/JSON/YAML/行工具；聊天/飞书 → 翻译/剪贴板历史；前台缺失时降级为 content + usage，不阻塞。

性能与可观测：进程/窗口列表缓存 + 短 TTL；ranking 常量集中配置；开发模式可输出 score 分解（hit 带 `reason`）；一期不做用户可配置权重 UI。

## 7. 地基三件套

### 7.1 content-kit（`src/kits/content/`）

- API：`detectContent(text: string): ContentDetection[]`；每项 `{ kind, confidence, normalized, captures }`。
- `ContentKind`：以现有 `ObjectBlockKind` 全集为基线（执行时现场核对 `objectBlock.ts`），补齐：JWT、Unix 时间戳（秒/毫秒）、base64、URL 编码、颜色（hex/rgb）、CSV/TSV、JSON、YAML、URL、多行文本。
- 分层：kit 产出标准化谓词结果与捕获信息（高置信、低误报，宁缺毋滥）；插件专属判断（如「pretty JSON 推压缩」）留在插件 `match()`。
- 接入：经 `src/pluginHostSdk.ts` `PluginHostKits` 注入；launcher 自身 objectBlock kind 判定改为消费同一 kit——一份识别逻辑，Object Block / 推荐 / 工作流输入三处共用。
- 约束：kit 零 framework 依赖、纯函数、无状态（kit 准入规则）。

### 7.2 统一匹配协议

见 §5（即 Intent 设计的 M0 协议里程碑，按两级混合形态落地）。

### 7.3 usage journal（SQLite 新表，第一期只写不读）

- 表结构（append-only）：`usage_journal { id, command_id, surface_id, executed_at, prev_command_id, object_kind }`。
- 写入点：`src/workspace/launcher/controller.ts` `selectItem` 执行路径（与现有 `shouldRecord` 同位置，语义独立）。
- Rust 侧：对齐 `plugin_kv_*` 命令族新增 `usage_journal_append` / `usage_journal_prune`（保留 90 天或 5 万条，取先到者）。
- 现有 localStorage usage 与 `usageScore` 保持不动；journal 纯为远期隐式学习和 frecency-kit 积累数据。
- 审计约束（吸收 Intent 设计 §7.2）：不记剪贴板全文，只记类型摘要（`object_kind`）。

## 8. 推进路线（合并重排）

| 包 | 内容 | 对应 Intent 设计里程碑 | 依赖 |
|----|------|------------------------|------|
| ① | 地基三件套 + 协议落地 + 剪贴板 content 推荐切片 | M0 + M1 的 content 半边 | — |
| ② | 文本智能补全：alias 系统、插件批量接入、前台应用 contextBoost + 权限 | M1 的 alias 半边 + §4.6 | ① |
| ③ | 桌面控制 I：App 统一排序增强 + 网页/URL（含内部平台 URL 模板） | M2 | ① |
| ④ | 桌面控制 II：窗口（列出/聚焦/可选关闭） | M3 | ③ |
| ⑤ | 桌面控制 III：进程（搜索/确认结束）+ L0-L3 权限框架完整落地 | M4 | ④ |
| ⑥ | 显式工作流（线性命令链） | 二期项提前 | ① |
| ⑦ | 自定义脚本命令（目录插件形态 + shell 权限） | Shell Runtime 的受控子集 | ⑥弱依赖 |
| ⑧ | 飞书生态（日程/文档/消息，OAuth + background） | — | — |
| 远期 | 隐式学习（frecency-kit/连招/时段，吃 journal 数据）、Object-first 深化、Shell Runtime 产品化、可选 LLM、外部选区恢复 | 二期清单 | ①⑥ + 数据积累 |

每包独立交付、可随时停。M5（调参打磨）不设独立包，摊进②③⑤的验收。

## 9. 安全与权限（整体吸收 Intent 设计 §7）

| 级别 | 例 | 策略 |
|------|-----|------|
| L0 | 搜索、推荐、预览 | 默认可跑 |
| L1 | 写剪贴板、开 App/URL、聚焦窗口 | 直接执行 |
| L2 | 结束进程、关闭窗口 | **必须确认**（确认框含名称 + pid） |
| L3 | 任意 shell、强杀系统关键进程 | 一期不做默认入口 |

硬规则：高 confidence 不跳过 L2；关键系统进程 deny/warn 表（宁严勿松）；capability 未授权则动作不出现；L2 最小审计（时间、动作类型、目标摘要），不记剪贴板全文；默认不上传 context、无云端意图；生产日志不打 content 正文。

## 10. 包①详细设计：地基 + 协议 + 剪贴板感知推荐

### 10.1 验收场景（用户体感）

1. 复制 Unix 时间戳 → 唤起 Launcher → 零输入时 Object Block 标注「时间戳」，置顶推荐「转为日期时间」，回车即得结果。
2. 复制 base64 文本 → 置顶推荐「解码」。
3. 复制 CSV 片段 → 置顶推荐「用 CSV 工具打开」。

### 10.2 工作项

1. content-kit 落地（§7.1），launcher objectBlock 判定切换为消费 kit。
2. 两级混合协议落地（§5，本包不含 `aliases`/`apps` 维度的消费方，但字段一次定义到位）。
3. `pluginActionManifest` 一次性迁移到 accepts 求值（§5.4）。
4. 首批插件声明化改造：`src/plugins/date-time-assistant/`（时间戳）、`src/plugins/encode-decode/`（base64）、`src/plugins/csv/`（CSV）——协议第一批真实消费者。
5. usage journal 建表 + 写入（§7.3）。
6. 协议工程防护同包交付：软超时、失败隔离、限条数（§5.2）。

### 10.3 保持不动

剪贴板新鲜度规则、Backspace 二段删除、`search-only` 模式切换、输出路由、`usageScore`、`textMatch`、`dynamicItems`。

### 10.4 验收标准

- [ ] 10.1 三个场景在真实 App 内通过（真机验证，非仅构建通过）。
- [ ] 声明粗筛阶段零插件代码执行（断点/日志验证）；`match()` 仅对 accepts 命中插件调用。
- [ ] 坏 matcher（抛错/超时）不影响列表其余项（契约测试）。
- [ ] 新增动作文案全部走 i18n，中英文均正确展示。
- [ ] `npm run check:architecture` 通过（kit 无 framework 依赖；插件不直接 import kit 源码）。
- [ ] SQLite 中可见 journal 记录（含 `prev_command_id` 串联），无剪贴板正文。
- [ ] `git diff --check`、`npm run build` 通过。
- [ ] 三个改造插件版本号已更新且实际释放目录加载到新版本。

### 10.5 禁止事项

- 禁止在三套旧机制外新造第四套匹配语言或新 contribution 类型。
- 禁止引用已删除的 `instantSuggestions` 接口（`doc/instant-suggestion-plugin-design.md` 已过时）。
- 禁止修改 `ranking.ts` 的 usage 排序逻辑与 `textMatch` 行为（收编是后续独立清理项）。
- 禁止硬编码任何用户可见文案。
- 禁止把 JWT/JSON/CSV 等产品语义写进 framework（识别进 kit，动作与策略进插件）。
- 禁止 host 在无超时预算的情况下调用插件 `match()`。

## 11. 包②～⑧要点（到期出详细设计）

- **包② 文本智能补全**：alias 表显式注册（`jwt`/`解jwt`/`b64`/`fmt`/`翻译` 等，规范化小写、空白/标点变体、中英并列；支持「动作词 + content 形态」组合抬分）；插件接入优先级：encode-decode → json-tools/yaml/formatter → date-time-assistant/calculator → translate → csv/line-tools；前台应用 contextBoost + 新增 `PluginPermission`（如 `context.foreground-app`）。质量门槛：标准 JWT / pretty JSON → top3 内有正确动作；核心别名有单测；单次 content+alias 在预算内不卡输入。
- **包③ 桌面控制 I**：App 统一排序（名称匹配 + usage + 轻 contextBoost；空 query 仅少量最近 App 不刷顶；强文本意图时 App 让位）；URL/域名 content 与 query → 打开；web-open 模板/参数历史/dynamicItems 保持，Intent 抬分不双份；内部平台参数化 URL 模板（`{query}`/`{clipboard}` 占位符）并入 web-open 迭代。
- **包④ 桌面控制 II（窗口）**：列出可见窗口（应用名+标题），主动作聚焦；可选关闭（L2 确认）；别名 `切到`/`窗口`/`focus`；缓存 TTL 1–3s；不做分屏布局引擎。
- **包⑤ 桌面控制 III（进程）**：按名搜索，动作=结束进程（优先温和终止，强杀非默认）；空 query 不列进程；回车 → 确认框（名+pid）→ 执行；关键系统进程 deny/warn 表；L0-L3 权限框架完整落地。
- **包⑥ 显式工作流**：线性命令链（上一步文本输出 = 下一步输入），复用 `WorkAction.run(input, ctx)` 挂点；持久化后作为可搜索 launcher item；只支持文本管道，不做画布/分支/循环。
- **包⑦ 自定义脚本命令**：目录插件形态；New Plugin 脚手架（`pluginScaffold.ts`）加「脚本命令模板」+ shell 执行权限（新 `PluginPermission`，L3 边界内受控）；体验对标 Raycast Script Commands。
- **包⑧ 飞书生态**：日程/文档搜索/发消息；OAuth + `background` contribution；风险最高放最后。

## 12. 测试策略（吸收 Intent 设计 §9）

| 层 | 覆盖 |
|----|------|
| 单测 | content-kit 样例（高置信/低误报边界）；ranking 量级顺序；别名规范化；去重；L2 确认状态机 |
| 契约 | accepts 粗筛零插件调用；match() 超时/抛错隔离；未授权无危险动作项 |
| 故事/集成 | 贴 JWT 解码；`fmt` 格式化；开 Chrome；kill+确认；三个包①验收场景 |
| 架构 | `npm run check:architecture` 边界 |
| 手工 | macOS 真机：前台切换、focus、权限、IME 下别名（中文输入法 Enter 上屏不触发确认） |

沿用仓库 `scripts/test-*.mjs` 风格新增用例。

## 13. 成功度量

定性（主）：解 JWT/Base64、格式化 JSON、开常用 App、打开链接、切窗口——多数不必输入完整命令名；空 query + 普通中文不乱推编解码；危险动作零误执行。

定量（可选自用观测，journal 数据天然支持）：零 query 直接回车比例、短 query（≤4 字符）成功率、L2 确认覆盖 100%、打开到可交互延迟无感知卡顿。一期不做分析后台。

## 14. 风险与开放问题

| 风险 | 缓解 |
|------|------|
| `ObjectBlockKind` 现有全集未穷举 | 执行包①前现场核对 `objectBlock.ts`，`ContentKind` 必须覆盖现有全集防行为回退 |
| `pluginActionManifest` 现有声明格式未细查 | 迁移前核对所有现存消费插件，一次性改造完 |
| 排序打架 | 常量表集中 + score 分解日志；包②③验收时调参 |
| 窗口/进程 API 权限与稳定性 | 包④⑤可延后；探测失败隐藏入口 |
| match() 拖慢输入 | accepts 粗筛前置 + 超时预算 + 限条数 + 缓存 |
| journal 无上限增长 | prune 策略随 append 同包交付 |
| 多类型误识别 | kit 只给谓词结果；confidence 阈值与产品判断由插件 match() 兜底 |
| 范围膨胀 | 严格按包推进；Shell 自由入口 / LLM / Object-first 不进一期 |

## 15. 决策记录

| # | 决策 | 来源 |
|---|------|------|
| 1 | 三方向：上下文感知推荐、习惯学习与工作流、中枢广度扩展；不做 LLM 意图理解 | v1 brainstorm |
| 2 | 地基优先策略（kit + 协议 + journal） | v1 brainstorm |
| 3 | 统一智能入口，不切双模式；规则 + 上下文，一期无 LLM | Intent 设计 brainstorm |
| 4 | 匹配协议 = 两级混合（accepts 声明粗筛 + 可选 match() 精筛） | 本次合并裁决 |
| 5 | 推进顺序 = 文本智能 → 桌面控制（App/网页 → 窗口 → 进程）→ 工作流/脚本 → 飞书 | 本次合并裁决 |
| 6 | journal 第一期只写不读；现有排序 usage 不动 | v1 brainstorm |
| 7 | 三套旧匹配机制收编：pluginActionManifest 包①一次迁移；WorkAction.accepts 原地增强；textMatch 后续独立清理项 | 本次合并 |
| 8 | 桌面控制安全分级 L0-L3；L2 必确认；高 confidence 不跳确认 | Intent 设计 |
| 9 | 平台一期主攻 macOS | Intent 设计 |


## 15.1 实施状态（2026-07-19 收官）

| 包 | 状态 | 说明 |
|----|------|------|
| ① 地基 + 协议 + content 推荐 | ✅ 已交付 | content-kit、intentEngine、accepts 推荐、journal |
| ② 别名 + ranking 抬分 + 前台 | ✅ 已交付 | pathway OR、intentScore/contextBoost、foreground |
| ③ App + URL | ✅ 已交付 | 空 query 限流、强文本 App 让位、`{clipboard}` 模板 |
| ④ 窗口 | ✅ 已交付 | list/focus/close + L2 choices 确认（macOS） |
| ⑤ 进程 | ✅ 已交付 | 搜索/SIGTERM + deny 表 + L2 确认（macOS） |
| ⑥ 线性工作流 | ✅ MVP | 纯函数 pipeline + launcher item |
| ⑦ 脚本脚手架 | ✅ MVP | `script-command` 模板 + `shell.run` 权限（不默认执行 shell） |
| ⑧ 飞书生态 | ⏸ 延期 | 需独立 OAuth / background / 合规设计，不进本分支 |

分支：`feat/launcher-intelligence-package-1`


## 16. 相关文档

- 被本文吸收：`docs/superpowers/specs/2026-07-19-control-hub-intent-design.md`（其 §4 排序、§6 桌面控制、§7 安全、§9 测试被整体采纳；其 §3 纯命令式协议被 §5 两级混合取代）
- 边界哲学：`doc/diff-plugin-boundary-decision.md`；插件目录协议：`doc/plugin-directory-convention.md`；SQLite 基础设施：`doc/plugin-storage-sqlite-migration.md`
- 交互先例：`docs/superpowers/specs/2026-07-01-launcher-interaction-optimization-design.md`（L0 剪贴板智能与一步到位）
- 二期参考：`doc/future/shell-effect-runtime-design.md`
- 过时文档（勿作为实现依据）：`doc/instant-suggestion-plugin-design.md`、`doc/builtin-script-auto-inference.md`
