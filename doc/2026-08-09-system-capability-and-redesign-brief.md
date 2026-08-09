# hiven 系统能力全景与重设计简报

**日期:** 2026-08-09  
**用途:** 交给 Codex / 架构评审做系统重设计时的上下文包  
**读者:** 零上下文 AI / 产品 / 架构  
**权威来源:** `PRODUCT.md`、`DESIGN.md`、`AGENTS.md`、`doc/prd.md`、`doc/project-analysis.md`、`doc/2026-07-19-launcher-intelligence-roadmap-design.md`、`doc/plans/2026-08-01-launcher-follow-through-and-feature-steal.md`、代码现状

---

## 0. 一句话

> **hiven = launcher-only 的跨平台「精确文本工作台」+ 插件 host。**  
> 灵感来自 Boop，交互对标 Raycast/Alfred 一类全局 launcher，但不做全能 OS launcher。

成功标准：常见文本操作**快找、可预期、可扩展**；打开少打字、输入即懂、结果可续。

---

## 1. 产品定位

| 项 | 内容 |
|----|------|
| 品牌 | Quiet, precise, capable（安静、精确、能干） |
| 用户 | 开发者 / 技术用户（也覆盖高频文本处理办公用户） |
| 核心模型 | 文本输入 → Action → 输出结果（Action First，不是 CLI 优先） |
| 形态 | **Launcher-only**：托盘是唯一常驻入口 → Global Launcher → host surface 原地展开 / 插件独立窗 |
| 不是 | IDE、RPA、低代码、ETL、全能 OS launcher、云协作平台 |
| 一期不做 | 必选 LLM、通用宏录制、自由 shell 默认入口、Raycast 扩展兼容、云同步、文件全局搜索、截图/窗管主路径 |

### 产品哲学（从 PRD / intelligence 路线收束）

1. **Action First** — Command Palette 只是 Action 的一种触发方式  
2. **参数化 Action** — 结构化参数 + GUI 配置，而非完整 CLI 字符串  
3. **上下文感知** — 剪贴板 / 选区 / 前台 App 驱动推荐，少搜命令全名  
4. **规则优先** — 一期无 LLM；成功 =「少搜命令名」  
5. **插件边界** — host 只做容器/调度；diff / JSON / 飞书等产品语义在插件  

---

## 2. 已有功能（现状能力地图）

### 2.1 壳层 / Framework（host 负责）

| 能力 | 说明 |
|------|------|
| Global Launcher | 全局热键唤起；搜索 / 执行 / 参数收集；与主编辑器 I/O 分离 |
| 托盘 + 全局热键 | 唯一常驻入口；支持双击修饰键、Per-app 热键 toggle |
| Host surfaces | Quick Editor / 系统设置 / 插件管理：在 launcher 内原地展开 |
| Quick Editor | Monaco；可 detach 独立窗；单编辑器，非多 pane 主工作台 |
| Plugin surface 窗 | 插件独立托管窗（一致 chrome） |
| 插件 registry | 目录包 + manifest；dev/prod 隔离；install/enable/disable |
| Command / ranking | 统一 launcher item；frecency；alias；intentScore；contextBoost |
| Object Block | 剪贴板内容挂载 → 推荐动作 → 输出目标（三段式） |
| content-kit + Intent | `accepts` 声明粗筛 + 可选 `match()` 精筛；content 类型识别 |
| 输出路由 | copy / paste 前台 / editor / surface |
| i18n | 中英；用户可见文案强制走 locale |
| SQLite plugin storage | plugin_kv + usage journal |
| Telemetry | launcher perf NDJSON（`~/.local/hiven/logs/launcher-perf.ndjson`） |
| 桌面控制（macOS） | 开 App、URL、窗口 list/focus/close（L2 确认）、进程搜索/结束（L2） |
| 线性工作流 MVP | 纯函数 pipeline，可搜 launcher item |
| 脚本脚手架 | `script-command` 模板 + `shell.run` 权限（不默认开放 shell） |
| Desktop Target Provider | App / 窗口 / 进程 / Chromium 标签混排（D0–D3） |

### 2.2 First-party 插件（源码目录 `src/plugins/`）

**发布索引（`src/builtin-plugins/index.json`，v37 核心包）：**

| 插件 | 能力摘要 |
|------|----------|
| encode-decode | Base64 / URL / HTML / JWT 等编解码 |
| formatter | JSON/XML/SQL/CSS 等格式化 |
| json-tools | JSON 工具 + surface |
| line-tools | 行级处理（去重、排序、前缀等） |
| text-utils | 通用文本工具 |
| crypto | Hash 等 |
| csv | CSV/TSV 转换、SQL filter、surface |
| yaml | YAML |
| calculator | 算式 / dynamicItems 钉顶 |
| date-time-assistant | 时间戳 ↔ 日期、时间助手 |
| translate | 翻译 surface + providers |
| regex-tester | 正则测试 |
| text-diff | 文本 Diff surface（含 JSON semantic 相关能力在插件侧） |
| clipboard-history | 剪贴板历史 + background + 常用/收藏 + 回 launcher |
| js-filter | JSON 表达式过滤 |
| web-open | 开 URL、模板、`{clipboard}`、favicon、query history |

**源码中另有、未必全在 builtin 释放索引：**

| 插件 | 能力摘要 |
|------|----------|
| feishu | 飞书 L1 混排 + L2 命令树（文档/会话/联系人/日程/任务/消息等，基于 lark-cli） |
| browser-tabs | Chromium 标签桥 |
| snippets | 文本/模板 snippet（R3） |
| user-commands | 自定义命名命令（R3） |
| variable-case | 变量命名风格转换 |
| random | 随机生成 |

### 2.3 Kits（纯算法，无状态）

- `content` — 内容类型识别  
- `diff` — 纯 diff 算法  
- `editor` / `ui` — 编辑与 UI 基元  

### 2.4 交互「跟手」层（R1–R4 文档标记已落地）

- 空搜克制：Recent / Favorites / 限流 App，不刷全库  
- frecency  
- ⌘1–8 编号秒选并执行  
- footer 主行动 + Actions  
- content 主推收敛  
- 剪贴板历史 → Object Block → 粘贴回前台  
- Snippets / 自定义命令  
- 双击修饰键 / Per-app 热键  
- Launcher 暗色材质（Tinycast 对照）  

### 2.5 技术栈

React 19 + TypeScript + Tailwind + Zustand · Tauri v2 · Monaco · GitHub Releases 自动更新 · 跨平台 macOS/Win/Linux

---

## 3. 想做 / 已规划但未做满的能力

### 3.1 产品目标体验（「跟手」验收语言）

| 形态 | 期望 |
|------|------|
| 打开即猜 | 新鲜剪贴板 → Object + 主推 1 + 次要 ≤3；否则 Recent/Favorites/少量 App |
| 输入即懂 | dynamicItems 钉顶 + 别名 + content 抬分 + frecency |
| 内容即动作 | detect → 主推 1 → live preview（纯函数）→ ↵ 定去向、⇥ 切去向 |
| 结果即继续 | 结果仍可再变换 / 复制 / 粘贴前台 / 开编辑器 |

### 3.2 Intelligence 路线中的远期项（包①–⑧ 主路径已交付，以下仍属远期）

- 隐式学习深化：frecency-kit 下沉、连招、时段（吃 usage journal）  
- Object-first 大重构深化  
- Shell Runtime 产品化（受控子集之外的完整体验）  
- 可选 LLM（非主路径）  
- 外部选区 capture 恢复  
- VS Code 标签 Provider（D4 暂缓）  

### 3.3 设计已有、接线/打磨仍可能缺口

| 主题 | 文档 | 状态提示 |
|------|------|----------|
| Live preview 协议 | `doc/2026-07-26-launcher-token-input-live-preview-design.md` | 设计完整；需核对是否全量接线到 format/case/encode 等 |
| 结果 secondary actions | `doc/2026-07-20-launcher-text-result-secondary-actions-redesign.md` | 设计优先接线于新功能 |
| Token 输入 / 参数阶段 UI | UI redesign summary + token design | 参数=蓝色标签塌缩 + 列表同构；⌫ 二段返回 |
| 无结果 fallback | UI review P2 | Raycast/Alfred 式「用 Web 搜索 {query}」 |
| Escape 链统一 | escape-chain design | 多 surface 仍可能有旧 if/else |
| Shell effect runtime | `doc/future/shell-effect-runtime-design.md` | 未来 |
| 插件市场 / 云同步 / 账号 | PRD 明确 MVP 不做 | 仍不做 |

### 3.4 明确非目标（重设计时不要扩成这些）

- SuperCmd 式截图标注 / Alt-Tab / Widgets / 听写 / 摄像头  
- 必选 LLM / Agent 主路径 / 实时语音  
- Raycast 扩展生态兼容  
- Spotlight/Alfred 式文件全局搜索、菜单项搜索（一期）  
- 把 host 做成 code-review / IDE  
- 插件运行时互相依赖、第四套 matcher 语言  

---

## 4. 竞品与参考（抄什么 / 不抄什么）

### 4.1 总表

| 产品 | 我们参考什么 | 不抄 / 边界 |
|------|--------------|-------------|
| **Boop** | 产品源头：桌面文本变换脚本工作台 | 不止 macOS、不止单编辑器脚本列表 |
| **Raycast** | 行布局、瞬开零动画、frecency 心智、内容即动作、Script Commands 形态、Calculator 式 dynamic 结果 | 不做扩展商店兼容、云同步、全能 OS 中枢 |
| **Alfred** | Universal Actions 类型系统、Workflows 成熟度（我们只做线性链）、剪贴板历史类比 | 不做画布编排、不走文件搜索主路径 |
| **LaunchBar** | 行业 launcher 对照（intelligence 调研） | — |
| **uTools** | 声明式 matcher（regex/over/img/files/window）→ 我们的 `accepts` | — |
| **PopClip** | 两级过滤（requirements + regex）→ accepts + match() | — |
| **Script Kit** | 脚本扩展生态对照 | 不全盘做成脚本 IDE |
| **Tinycast** | **质感与克制**：空搜分区、真图标、footer 动作语法、剪贴板回前台、Snippets 形、设计不变量 | 禁搬 AGPL 源码 |
| **SuperCmd** | **手速糖**：⌘1–8、Suggestions 空搜、Actions ⌘K 语法 | 不抄截图/窗管/Widgets/听写/AI 主路径 |
| **VS Code Light+** | 视觉基线：冷白、#2563eb accent、密度与可读性 | 不是 IDE 产品 |
| **tableconvert 等** | CSV 工具 surface 交互参考 | — |

### 4.2 业界结论（已吸收进设计）

1. 匹配阶段声明优先、少跑插件代码（uTools）  
2. 两级过滤（PopClip）  
3. frecency 可复用（Raycast）  
4. 内容类型协议全局唯一（Alfred Universal Actions）  
5. 高频键盘路径永远不 animate（Raycast）  

---

## 5. 系统不足与重设计应盯紧的裂缝

> 供 Codex 重设计时优先「找洞」，不是立刻列实现任务。

### 5.1 定位裂缝（文档 vs 现实）

| 问题 | 说明 |
|------|------|
| **双源叙事** | 早期 README/PRD：Boop 式编辑器 + Command Palette；现行：launcher-only + Quick Editor。DESIGN/PRODUCT 已迁，README/project-analysis 仍有「主窗 + 多 pane」残留描述 |
| **工作台退休后的孤儿树** | 主 editor 窗口退休后，多 pane `useWorkspaceStore` / `EditorView` / Diff 页等曾出现「文件还在、入口断了」类回归（见 `doc/archive/2026-07-07-architecture-review.md`） |
| **测试方法论盲区** | 大量 `scripts/test-*.mjs` 是源码正则契约，**看不见**「代码在但路径不可达」 |

### 5.2 架构 / 协议裂缝

| 问题 | 说明 |
|------|------|
| **匹配机制历史包袱** | Intent accepts/match、pluginActionManifest、textMatch、dynamicItems 曾并行；收编计划已写，实现层是否完全单轨需 Codex 现场核对 |
| **输出与 I/O 双路径** | Global vs App 内命令：语义共享、I/O 必须分离；边界细、易串路 |
| **Plugin API 在无 editor 运行时的降级** | 大量 API 曾依赖 `isEditorWindowRuntime()`；false 分支是否等价（尤其 Diff / pane / effect）是系统性风险 |
| **Host 膨胀风险** | 桌面控制、飞书、浏览器标签、工作流都已进产品；若边界松动，host 会变成「小 Raycast + 飞书客户端」 |
| **Kit vs Plugin vs Host** | 文档纪律清楚，但 content 识别 / ranking 常量 / 产品策略容易渗入错误层 |

### 5.3 体验 / 完成度裂缝

| 问题 | 说明 |
|------|------|
| **Live preview 是否真「输入即结果」** | 设计拍板；纯函数子集接线完成度需审计 |
| **结果可续（secondary actions）** | 设计有，是否成为默认闭环需核对 |
| **无结果死胡同** | 应有 web search fallback 等（UI review） |
| **危险操作确认** | 卸载插件、进程 kill 等确认完整性需统一 L0–L3 |
| **执行中反馈** | 网络插件（翻译）busy 反馈曾过弱 |
| **焦点 / a11y / i18n 硬编码** | UI review 列过一串 P2–P4；可能部分未清 |
| **立体白 / 动效系统** | 设计与 token 齐全，接线不完整（动画挂在错误频段等） |
| **性能** | first-paint、rank-items 重复、webview 唤醒；已有 telemetry，需用数据驱动而非感觉 |

### 5.4 生态 / 扩展裂缝

| 问题 | 说明 |
|------|------|
| **无插件市场** | 扩展靠本地目录；第三方门槛高 |
| **脚本 vs 插件双轨历史** | 旧单文件脚本退役；用户自定义 = 目录插件 / user-commands / snippets，心智是否清晰 |
| **飞书深度 vs 文本工作台主线** | 飞书 B0–B5 已重；重设计需明确「中枢广度」与「文本深度」权重 |
| **跨平台桌面控制** | 窗口/进程一期偏 macOS；Win/Linux 能力不对齐 |
| **权限模型** | L0–L3 与 PluginPermission 存在，产品化是否对用户可见、可配置 |

### 5.5 工程 / 可维护性裂缝

| 问题 | 说明 |
|------|------|
| **文档过载与过时并存** | `doc/` 极多；`instantSuggestions` 等已废；执行易读错旧文 |
| **契约测试假绿** | 见上 |
| **状态分裂** | zustand settings、SQLite journal、plugin storage、launcher usage 多套 |
| **Surface / window 模型复杂** | launcher / host surface / plugin surface / detach quick-editor / 原生托盘 |
| **i18n 强制 vs 原生层例外** | 托盘文案硬编码双语是唯一认可例外，边界要守 |

---

## 6. 建议 Codex 重设计时的问题清单

请 Codex **先审计再设计**，优先回答：

1. **系统中枢是什么？**  
   - A) 精确文本工作台（Boop 深化）  
   - B) 桌面控制中枢（Raycast 轻量）  
   - C) 工作内协作入口（飞书 + 剪贴板）  
   现状是 A 为主、B/C 已并入；重设计需裁决主线与卫星能力。

2. **Surface 信息架构如何一刀切？**  
   仅 launcher + 可 detach 编辑器 + 插件窗？是否彻底删除多 pane 遗骸？Diff 的规范宿主是什么？

3. **单一匹配与排序协议如何固化？**  
   消灭双轨；定义 content → intent → ranking → execute 的唯一数据流与性能预算。

4. **Plugin API 最小完备集？**  
   在「无主 editor 运行时」前提下，text I/O、surface、clipboard、shell、desktop target 各暴露什么；禁止 silent discard。

5. **跟手闭环的最小产品切片？**  
   打开即猜 / 输入即懂 / 结果可续 中，哪些是 P0 验收故事（可测、可埋点）。

6. **与竞品差异化一句话？**  
   建议方向：*「文本工作台级的 content 智能 + 插件边界清晰的 host，而不是又一个 Raycast。」*

7. **明确永不做的清单是否仍成立？**  
   LLM 主路径、文件搜索、截图窗管、扩展商店兼容——是否写入 DESIGN 硬约束。

8. **测试策略如何升级？**  
   从「源码正则」到「可达路径 + 关键故事 E2E + architecture 边界」。

---

## 7. 给 Codex 的推荐阅读顺序

1. `PRODUCT.md` + `DESIGN.md` + `AGENTS.md`（边界与品牌）  
2. 本文档（全景）  
3. `doc/2026-07-19-launcher-intelligence-roadmap-design.md`（智能协议与包①–⑧）  
4. `doc/plans/2026-08-01-launcher-follow-through-and-feature-steal.md`（跟手 + 竞品抄什么）  
5. `doc/2026-07-19-ui-ux-review-and-redesign-summary.md`（体验债务）  
6. `doc/diff-plugin-boundary-decision.md` + `doc/plugin-directory-convention.md`  
7. `doc/archive/2026-07-07-architecture-review.md`（历史结构性坑）  
8. 代码入口：`src/workspace/launcher/`、`src/launcher/`、`src/plugins/`、`src/kits/`、`src-tauri/src/lib.rs`

---

## 8. 附录：能力 vs 竞品对照（简表）

| 能力域 | 我们 | Raycast | Alfred | Boop | Tinycast/SuperCmd |
|--------|------|---------|--------|------|-------------------|
| 文本变换脚本/插件 | ✅ 强 | 扩展 | Workflow | ✅ 本职 | 弱/中 |
| 全局 launcher | ✅ | ✅ | ✅ | ❌ | ✅ |
| 剪贴板历史 | ✅ | 扩展/系统 | ✅ | ❌ | ✅ |
| 内容感知推荐 | ✅ Intent | 部分 | Universal Actions | ❌ | Suggestions |
| Diff / JSON 工作台 | ✅ 插件 | 弱 | 弱 | 弱 | ❌ |
| 飞书深度 | ✅ 重 | 扩展 | — | ❌ | ❌ |
| 桌面 App/窗/进程 | ✅ macOS | ✅ | ✅ | ❌ | SuperCmd 更强 |
| 截图/窗管/Widget | ❌ | 部分 | 部分 | ❌ | SuperCmd |
| 扩展商店 | ❌ | ✅ | Gallery | ❌ | — |
| LLM 主路径 | ❌ 一期 | 有 | — | ❌ | SuperCmd 有 |

---

## 9. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-09 | 初版：汇总定位、已有功能、规划、竞品、不足与 Codex 问题清单 |
