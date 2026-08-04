# Launcher 跟手推荐与竞品能力引入计划

**日期:** 2026-08-01  
**状态:** R1–R4 已落地（含 Per-app 热键 + launcher 暗色材质）（2026-08-01）  
**读者:** 执行 AI / 评审 / 产品（假定零上下文；实现前现场核对路径）  
**产品:** hiven  
**前置:** `doc/2026-07-19-launcher-intelligence-roadmap-design.md`（包①–⑧ 已交付，分支 `feat/launcher-intelligence-package-1`）

---

## 0. 一句话

> **先抄推荐手感，再抄功能清单。**  
> 在已有 Intent / ranking / Object Block 地基上，把 Tinycast / SuperCmd 的「打开就猜、输入即懂、结果可续」做满；只引入与文本工作台+插件 host 同向的功能，不做全能 OS launcher。

---

## 1. 竞品与边界

### 1.1 参考对象

| 产品 | 定位 | 我们主要抄什么 |
|------|------|----------------|
| [Tinycast](https://github.com/abue-ammar/tinycast) | 开源极简原生 palette（~3MB，AGPL） | 空搜分区、真图标、footer 动作语法、剪贴板回前台、Snippets/自定义命令产品形、设计不变量纪律 |
| [SuperCmd](https://supercmd.sh/) | 商业全能 Swift launcher | ⌘1–8、Suggestions 空搜、Actions ⌘K 语法；**不抄** 截图/窗管/Widgets/听写/AI 主路径 |
| Raycast（间接） | 行业基线 | frecency 心智、内容即动作、Script Commands 形态（包⑦ 已有脚手架） |

### 1.2 产品边界（非目标）

| 不做 | 原因 |
|------|------|
| 截图标注 / Alt-Tab / 系统 Widgets / 摄像头 | SuperCmd 卖点，非文本工作台 |
| 必选 LLM / Agent 主路径 / 实时语音 | 与 intelligence「一期无 LLM」一致；可远期可选 |
| Raycast 扩展兼容 / 云同步 | 工程与隐私黑洞 |
| 文件全局搜索 / 菜单项搜索（一期） | Spotlight/Alfred 领地，分心 |
| 复活 `instantSuggestions` 旧接口 | 已删除；现行 = `dynamicItems` + accepts/match + ranking |
| 第四套 matcher / 新 contribution 类型 | 继续收编进统一协议 |

### 1.3 已有地基（勿重做）

| 能力 | 证据（执行前再核对） |
|------|----------------------|
| Object Block + 剪贴板推荐 | `src/launcher/clipboard/objectBlock.ts`、`actionRecommendation.ts`、`useClipboardObjectBlock.ts` |
| content-kit + intentEngine | intelligence 包① |
| alias / intentScore / contextBoost / 前台 | 包② |
| App 限流 + URL + `{clipboard}` | 包③ |
| 窗口/进程 L2 | 包④⑤ |
| 线性工作流 / 脚本脚手架 | 包⑥⑦ |
| dynamicItems（calc / date-time / web-open…） | `useLauncherSession.ts`、各插件 |
| ranking usage | `src/workspace/launcher/ranking.ts` |
| 输出路由 / secondary actions 设计 | `outputRouter`；`doc/2026-07-20-launcher-text-result-secondary-actions-redesign.md` |
| live preview 设计 | `doc/2026-07-26-launcher-token-input-live-preview-design.md` |
| 剪贴板回 launcher | `doc/2026-07-19-clipboard-history-return-to-launcher-design.md` |
| 常用/收藏剪贴板 | `doc/2026-07-12-clipboard-frequent-favorite-design.md` |
| persistable recents | `src/workspace/launcher/persistableRecents.ts` |

---

## 2. 「跟手」产品形态（验收语言）

### 2.1 打开即猜（空 query）

```text
唤起
  → 剪贴板新鲜？ → Object Block + 主推 1 动作 + 次要 ≤3
  → 否则 → 分段列表（限条，不刷全库）:
        Recent 命令（frecency）
        Favorites / Pinned（若有）
        少量最近 App（沿用包③ 限流）
  → 禁止：空搜刷满全部插件/命令
```

### 2.2 输入即懂（有 query）

```text
打字
  → dynamicItems 钉顶（算式 / 时间 / URL…）
  → 别名 + content 抬分（抬分不复制第二条）
  → 普通搜索 + frecency
  → 强文本意图时 App 让位（已有，保持）
```

### 2.3 内容即动作（Object / 剪贴板）

```text
detectContent(kind)
  → 主推 1（高置信）
  → 次要 2–4
  → 纯函数 → live preview
  → ↵ = 默认输出去向；⇥ 切换去向（与既有交互设计一致）
```

### 2.4 结果即继续

```text
执行后结果仍可在 launcher 内：
  再变换 / 复制 / 粘贴前台 / 打开编辑器
（对齐 secondary actions 设计，接线优先于新功能）
```

### 2.5 手速层（交互糖）

| 项 | 来源 | 优先级 |
|----|------|--------|
| ⌘1–⌘8 / Ctrl+1–8 选第 N 项 | SuperCmd | R1 |
| footer = 主行动 + Actions，键位帮助降级 | Tinycast / SuperCmd | R1 |
| 选中整行 tint；App/插件真图标或色标 | 两者 | R1 视觉可并行 |
| Tab 切 Clipboard surface | Tinycast | R2（勿与参数 ⇥ 去向冲突） |

---

## 3. 功能引入决策表

### 3.1 跟手推荐（优先）

| 能力 | 决策 | 包 | 说明 |
|------|------|-----|------|
| 空搜 Recent / Favorites 分段 | **做** | R1 | 接 frecency + pin |
| frecency（频次×近因） | **做** | R1 | 替换/增强裸 count usage |
| ⌘1–8 编号选中 | **做** | R1 | 全局 launcher 列表 |
| content → 主推唯一 | **加强** | R1 | JSON/URL/Base64/时间戳至少 |
| calc / 时间钉顶 | **保持+加强** | R1 | 单位换算可增量 |
| 纯函数 live preview 接线 | **做** | R1 | 设计已有 |
| footer 动作语法 | **做** | R1 | 与视觉质感包可同批 |
| 剪贴板回 launcher 当 Object | **做** | R2 | 设计已有 |
| 剪贴板常用/收藏 | **做** | R2 | 设计已有 |
| 粘贴回唤起前前台 App | **做** | R2 | 原生 foreground 已有 |
| Snippet 关键词展开 | **做** | R3 | 新 first-party 插件 |
| 自定义命名命令 + 热键 | **做** | R3 | 接包⑦ 脚手架；L2/L3 安全 |
| 选区规则 Quick Fix（非 AI） | **可选** | R3+ | 恢复选区 capture 后 |
| 双击修饰键唤起 | **可选** | R4 | 非核心 |
| Per-app 热键 toggle | **可做** | R4 | 桌面跟手 |
| 文件搜索 / 窗管 / 截图 / AI 主路径 | **不做** | — | §1.2 |

### 3.2 文本能力（我们本该更强）

不「抄功能名」，而是 **用推荐协议把已有插件送上门**：

- encode-decode / json-tools / yaml / formatter / variable-case / translate / csv / line-tools / textDiff  
- 验收：复制典型内容 → 零输入或 ≤4 字别名 → top3 内有正确动作  

---

## 4. 包划分与依赖

```text
R1 跟手推荐 MVP     ← 无强依赖，可立即开
  ↓
R2 剪贴板跟手闭环   ← 依赖 R1 空搜/Object 体验稳定
  ↓
R3 Snippets + 自定义命令 +（可选）规则 Quick Fix
  ↓
R4 桌面手速糖（双击修饰键 / per-app 热键等）
```

视觉「Tinycast 对照」暗色 launcher（材质/图标/footer）可与 **R1 并行**，但 footer 动作文案以 R1 语义为准。

---

## 5. 包 R1 — 跟手推荐 MVP（详细）

### 5.1 目标

打开少打字、输入立刻有建议、剪贴板一步走；列表可用编号键秒选。

### 5.2 范围

| # | 工作项 | 落点建议 | 验收 |
|---|--------|----------|------|
| R1.1 | **frecency**：`score = f(count, recency)` 替代或扩展 `usageScore` | `ranking.ts`；usage 存储结构可加 `lastSelectedAt`（已有则直接用） | 常用命令空搜/弱匹配更靠前；单测量级顺序 |
| R1.2 | **空搜分段**：Recent（frecency top N）/ Favorites（用户 pin）/ 限流 App | `useLauncherSession` 或 list 组装层；Favorites 需持久化 key | 空搜 ≤ 约 12 条可见主项；无全库刷屏 |
| R1.3 | **Favorites / Pin 命令** | settings 或列表 Actions「固定」；存 store / SQLite | pin 后空搜稳定出现；可取消 |
| R1.4 | **⌘1–8 选第 N 可见结果行** | `GlobalLauncherKeyboard` + 列表 index 映射 | 1–8 触发与 ↵ 同学价；IME composition 中不触发 |
| R1.5 | **content 主推唯一**：高置信只抬 1 条主动作到顶区 | intentEngine / actionRecommendation 展示策略 | JSON/URL/b64/时间戳四条故事手工+单测 |
| R1.6 | **live preview 接线**（纯函数子集） | 对齐 `2026-07-26-launcher-token-input-live-preview-design.md`；先 format/case/encode | 改参或挂 Object 后预览更新；↵ 只定去向 |
| R1.7 | **footer 主行动 + Actions** | `LauncherFooterHints` / Result 帧；i18n | 主行动文案随选中项变（打开/复制/执行…）；次要进 Actions |
| R1.8 | **calc 单位/币种（可选增量）** | calculator 插件 | `10km to mi` 或等价；失败安静不报错刷屏 |

### 5.3 非范围（R1）

- Snippets、自定义 shell 入口产品化、窗口管理、暗色材质全盘重做（材质可另 PR）  
- 改 accepts 协议形态、新 contribution 类型  

### 5.4 验收故事（必须全过）

1. **JSON 零输入**：复制 pretty/minified JSON → 唤起 → 无 query → 主推格式化/压缩之一 → ↵ → 结果可复制或已在预览。  
2. **算式**：输入 `1+2*3` → 顶部结果 → ↵ 复制。  
3. **别名**：输入 `json` 或中文「格式化」→ top3 内 format。  
4. **空搜克制**：冷启动空搜不出现完整插件表；可见 Recent/Favorites/少量 App。  
5. **编号键**：有 ≥3 条结果时 ⌘3 等价选中并执行第 3 项（或选中+↵，产品二选一，PR 内写死一种）。  
6. **IME**：中文输入法 composition 中 Enter 不上屏触发确认（既有约束）。  
7. **构建**：`npm run check:architecture`、相关 `scripts/test-*.mjs`、`npm run build`。

### 5.5 测试

| 层 | 内容 |
|----|------|
| 单测 | frecency 公式边界；空搜条数上限；编号 index 映射；主推去重不双份 |
| 契约/集成 | 四条 content 故事；dynamicItems 仍钉顶 |
| 手工 | 真机 Global Launcher + 剪贴板 + IME |

---

## 6. 包 R2 — 剪贴板跟手闭环

| # | 工作项 | 依赖文档/代码 |
|---|--------|----------------|
| R2.1 | 历史项「送到 launcher」→ Object Block | `2026-07-19-clipboard-history-return-to-launcher-design.md` |
| R2.2 | 常用 / 收藏条目 | `2026-07-12-clipboard-frequent-favorite-design.md` |
| R2.3 | 粘贴目标 = 唤起前前台 App | `contextBroker` / Tauri foreground |
| R2.4 | （可选）Tab 或快捷入口进 Clipboard surface，不丢 Object 语义 | 与 ⇥ 输出去向键位表冲突时以去向为准，Clipboard 用别的键 |
| R2.5 | 图文历史：文本跟手优先；图片预览次之 | 不对齐 SuperCmd 全量 |

**验收：** 历史选一条 → 回 launcher → 推荐动作可执行 → 粘贴回原 App。

---

## 7. 包 R3 — Snippets + 自定义命令

| # | 工作项 | 说明 |
|---|--------|------|
| R3.1 | **Snippets 插件** | Markdown/文本模板；占位符；可选关键词展开（默认关；需 Accessibility 时即时提示） |
| R3.2 | **自定义命令** | 命名 + 命令行 + 可选热键；目录插件或脚本模板；`shell.run` L3；执行 L2 确认 |
| R3.3 | 均进入统一搜索 + 别名 + frecency | 无第二套 UI 模式 |
| R3.4 | （可选）规则 Quick Fix | trim / case / JSON；**非 AI**；依赖选区 capture 策略 |

**安全：** Snippet 展开与 shell 不得默认全开；权限与确认对齐 intelligence §9。

---

## 8. 包 R4 — 桌面手速糖（低优先）

- 双击修饰键唤起 launcher（⌘⌘ / ⌥⌥）  
- Per-app 热键 focus/hide toggle  
- 不扩展为窗管产品  

---

## 9. 架构与实现约束

1. **统一协议：** 只使用 `accepts` / `match()` / `dynamicItems` / ranking 槽位；禁止新 matcher 语言。  
2. **边界：** JWT/JSON/… 语义在 kit 或插件；host 不进产品语义。  
3. **i18n：** 所有用户可见文案走 locale。  
4. **性能：** 空搜与输入路径不阻塞；frecency O(n) 可接受；dynamicItems 保持 progressive。  
5. **插件版本：** 行为变更的 first-party 插件必须 bump 版本并保证释放目录加载新版本。  
6. **视觉：** 材质/图标可并行，但 R1 功能不依赖完整暗色重做。  
7. **许可证：** 学习 Tinycast 设计规则与产品形；**禁止** 整段搬 AGPL 源码进本仓库。

---

## 10. 成功标准

| 维度 | 标准 |
|------|------|
| 跟手 | 解 Base64/JWT、格式化 JSON、算式、开常用命令——多数 ≤4 字符或零输入 |
| 克制 | 空搜不刷屏；误推率可接受（普通中文句子不乱推编解码） |
| 手速 | ⌘1–8 可用；footer 表达「当前能干什么」而非说明书 |
| 延续 | 结果 secondary actions 可继续处理 |
| 工程 | architecture check + 相关测试 + build 绿 |

---

## 11. 建议实施顺序（工程）

```text
1. R1.1 frecency + 单测
2. R1.2 + R1.3 空搜分段 / Favorites
3. R1.4 ⌘1–8
4. R1.5 主推唯一策略打磨
5. R1.6 live preview 接线（子集）
6. R1.7 footer 动作语法 + i18n
7. R1.8 calculator 增量（可选）
8. 视觉并行 PR：暗色 scrim / 真图标 / 去蓝左边条（非阻塞）
9. R2 → R3 → R4
```

每步可独立 PR；R1 全部故事通过前不宣称「跟手 MVP 完成」。

---

## 12. 决策记录

| # | 决策 | 日期 |
|---|------|------|
| 1 | 以 Tinycast 为质感+克制参考，SuperCmd 为手速糖参考；不做全能 OS 复制 | 2026-08-01 |
| 2 | 优先跟手推荐（R1），功能引入按 R2–R4 分期 | 2026-08-01 |
| 3 | 不新造 matcher；不复活 instantSuggestions | 2026-08-01 |
| 4 | Snippets / 自定义命令进 R3；窗管截图 AI 明确不做 | 2026-08-01 |
| 5 | 包①–⑧ 已交付；本计划为「跟手补强 + 选抄功能」新序列 R1–R4 | 2026-08-01 |

---

## 13. 相关文档

- 智能化主路线：`doc/2026-07-19-launcher-intelligence-roadmap-design.md`  
- live preview：`doc/2026-07-26-launcher-token-input-live-preview-design.md`  
- 结果次要动作：`doc/2026-07-20-launcher-text-result-secondary-actions-redesign.md`  
- 剪贴板回 launcher：`doc/2026-07-19-clipboard-history-return-to-launcher-design.md`  
- 剪贴板常用收藏：`doc/2026-07-12-clipboard-frequent-favorite-design.md`  
- 交互重设计：`doc/2026-07-19-ui-ux-review-and-redesign-summary.md`  
- 过时勿引用：`doc/instant-suggestion-plugin-design.md`  

---

## 14. 下一步（人工/执行）

- [x] R1.4 语义：⌘1–8 = **立即执行**（与 SuperCmd 一致）  
- [x] Favorites：`launcherFavoriteKeys` 经 zustand persist → localStorage（`hiven-settings`）  
- [x] R1 实现（frecency / empty-open 克制 / Favorites ⌘P / ⌘1–8 / footer 主行动 / 推荐 cap）  
- [x] R2 剪贴板跟手闭环（历史 ⌘↵ 回 launcher、文本粘贴到前台、常用/收藏、契约测试）  
- [x] R3 Snippets + 自定义命令（`src/plugins/snippets`、`src/plugins/user-commands`；script-command 脚手架接 `ctx.shell.run`）  
- [x] R4 双击修饰键：既有 `globalPinnedLauncherShortcut` double-modifier（设置页可配）  
- [x] R4 Per-app 热键：`toggle_installed_app` + 设置页绑定 + `installAppHotkeys`  
- [x] Launcher 暗色材质（Tinycast 对照：blur scrim、20px 圆角、white-alpha 选中）  

### R3 落地索引

| 能力 | 路径 |
|------|------|
| Snippet 展开纯函数 | `src/plugins/snippets/expand.ts` |
| Snippets 插件 + settings object-list | `src/plugins/snippets/` |
| Custom Commands + L2 确认 + shell.run | `src/plugins/user-commands/` |
| tools 注入 shell | `src/workspace/launcher/toolAdapter.ts` + `PluginToolContext.shell` |
| script-command 脚手架 | `src/workspace/pluginScaffold.ts` |
| 测试 | `scripts/test-snippets-expand.mjs`、`scripts/test-user-commands-model.mjs` |  

### R1 落地索引（2026-08-01）

| 项 | 路径 |
|----|------|
| frecency + empty-open 过滤/cap + favoriteBoost | `src/workspace/launcher/ranking.ts` |
| Favorites 纯函数 | `src/workspace/launcher/favorites.ts` |
| Favorites 持久化 | `src/store.ts`（`launcherFavoriteKeys`） |
| ranking 接线 favoriteKeys | `src/workspace/launcher/useLauncherSession.ts` |
| ⌘1–8 立即执行 · ⌘P pin | `src/components/launcher/GlobalLauncherKeyboard.ts` |
| footer 主行动语法 | `src/components/launcher/GlobalLauncherSearchFrame.tsx` |
| 推荐列表 cap=5 | `src/launcher/clipboard/actionRecommendation.ts` |
| 空搜可见条数 12 | `LauncherMixedList.MAX_VISIBLE_IDLE` |
| 测试 | `scripts/test-launcher-ranking.mjs`、`scripts/test-launcher-favorites.mjs` |  
