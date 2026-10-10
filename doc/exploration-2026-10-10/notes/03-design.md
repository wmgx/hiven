# Hiven 设计与交互探索报告（设计视角）

> 基准：master（c69ed99）。未修改、未推送。
> 证据等级标注：//。

## 0. 方法与环境结论

- `npm run build` 成功（25.86s，vite 构建通过，仅有 chunk 体积警告）。
- **未能跑起真实 UI**。具体阻碍：Linux 无头环境，`node_modules` 初次安装被 npm tar 解包 monaco-editor 时 ENOENT 中断两次，第三次 `npm ci` 才成功；随后 `/opt/meta-chromium/chrome`（Chromium 152）在本沙箱 headless 渲染完全无输出（`--dump-dom about:blank` 返回空、`--screenshot` 不生成文件；dbus 缺失、`--single-process` 下 V8 proxy 解析器不可用）。按任务要求记录阻碍后转向源码分析，未死磕。
- 主要依据：`DESIGN.md` / `PRODUCT.md` / `AGENTS.md`、设计文档（`doc/2026-07-07-escape-chain-unification-design.md` 等）、`src/components/launcher/*`（约 30 个文件）、`src/launcher/hosts/GlobalLauncherHost.tsx`、`src/components/quickEditor/*`、`src/components/pluginSurface/*`、`src/surfaces/*`、`src/i18n/locales/*`、`src/index.css`（11255 行）。

## 1. 设计健康度总评

**好的地方（值得保持）：**

1. **设计系统是文档化的，不是口头的。** `DESIGN.md` 明确了 surfaces 清单、色彩 token（light `#2563eb` / dark `#3b82f6`）、字体（UI system/Inter、内容 JetBrains Mono）、动效预算（launcher 唤起**无动画**、反馈 ≤150ms）、anti-references（PRODUCT.md：拒绝 SaaS 落地页风、泥玻璃、低对比 hover）。CSS 里 token 落实一致（`.l-row.sel` light 用 accent 12% tint + 内描边，dark 用 white 10% alpha，注释写明了"Tinycast"意图）。
2. **Launcher 交互框架是统一的。** `GlobalLauncherFrameSwitch`（search / param-input / collect-input / result / permission / plugin-surface / settings 七种帧）+ `handleGlobalLauncherKeyDown` + `useOutputDestinations` 被 Global Launcher 与 Quick Editor 命令 overlay 复用，目的地切换（↵ 复制 / ⇧↵ 粘贴前台 / ⌘↵ 带回 launcher，Tab 循环）在 collect-input 与 result 帧语义一致。这是"少切应用"链路的骨架，且是对的骨架。
3. **Escape 链统一迁移已落地。** 7-07 设计文档列出的 9 项迁移在代码中已兑现：host 链瘦身为 IME 检查 → interceptor → `controller.back()` → 关窗；permission frame、plugin surface frame、Quick Editor 两段式 Esc 都注册了 interceptor；`PluginSurfaceWindow` 补了 IME 检查。中文输入法 Enter 上屏不会误确认（`shouldIgnoreImeKeyDown` + 120ms 上屏保护）。
4. **错误恢复成体系。** 插件崩溃有 `PluginSurfaceErrorBoundary` + 错误态 message（带返回）；权限拒绝有专门的 permission frame（Enter=允许，Esc=返回）；命令失败在帧内红色条（collect 帧带 `role="alert"`）；粘贴失败 toast + 自动降级为"已复制"。i18n 覆盖率高，核心文案无 hardcode（`pickLocale` 只用于短暂性文案，符合仓库规范）。
5. **性能意识是工程化的。** 唤起后 React 树常驻、隐藏只用 CSS（`GlobalLauncherHost` 注释明示"热键复用 React 树"）；telemetry 落盘 `~/.local/hiven/logs/launcher-perf.ndjson`，first-paint ≥120ms 即判 jank。设计上有"快"的 KPI，不是口号。

**结构性风险：**

1. **文档与实现脱节。** `DESIGN.md` 写 Quick Editor 是"**single** editor（no multi-pane split）"，但 `QuickEditorPanel.tsx` 实际完整支持多 pane 分屏（`paneOrder`/`splitDirection`、`⌘\` 右分屏、`⇧⌘\` 下分屏、`⌘W` 关 pane、`⌘⌥←→` 切换 pane）。这是产品方向信号混乱：要么文档错了（分屏已是事实功能），要么实现越界了。建议二选一并更新文档——这比任何 UI 微调都重要。
2. **11255 行的单体 `index.css`。** 视觉一致性目前靠人工维持，没有 token lint；长期会腐烂。
3. **排序是黑盒。** 详见 §3。

## 2. 分链路审视

### 2.1 启动搜索

- 唤起：隐藏窗口即时显隐、无动画；React 树常驻复用；telemetry 度量 first-paint。观感上应该快（待 telemetry 数据验证）。
- 空状态（刚打开未输入）：显示 idle 列表（上限 12 条，`MAX_VISIBLE_IDLE`），超限提示"输入关键词以缩小范围…"（`palette.moreResultsHint`）。最近命令/系统命令/视图混合，合理。
- 搜索反馈：本地 ranking 是同步的，无"搜索中" spinner——数据量下合理；但 `busy` 脉冲只存在于 param/collect 帧，search 帧无 busy 态。若未来接异步数据源（dynamic suggest）需要补。
- **排序零解释**：`ranking.ts` 的 `score = matchScore + frecencyScore + favoriteBoost`，另有 learned-rule boost（`firePriority` 起步 45，高于 builtin direct-answer 的 30）和 ⌘P 固定。但 UI 上只有**标题 match 高亮**和**拼音 badge**，用户无法理解"为什么这条排第一"。Raycast/Linear 至少有分组或来源标记。这是每天打开最高频的信任问题。
- ⌘1–8 快捷运行：前 8 行显示 `⌘N` badge（SuperCmd 风格），可发现性好；但与右侧 kind tag 的合并逻辑复杂（`r-tag-combo` 把 ⌘N 折进 tag pill），行尾信息密度偏高，快速扫读时 tag 的语义（App/Command/打开的标签页…）会被快捷键 badge 稀释。
- footer 的 primary action capsule（运行/打开/复制 + ↵）清晰，是全链路最好的"可预期性"设计之一。

### 2.2 内容输入（Object Block）

- 挂载路径清晰：剪贴板**只能**经 Object Block / 推荐动作进入（`attachPolicy`），不直接当普通输入；粘贴多行文本自动转 block；输入框右侧有"作为内容处理"按钮（`palette.useQueryAsContent`），query 一键转 block。
- `ObjectBlockToken` 信息密度好：`[预览文本 · kind · 来源 ×]`，secret 掩码、snapshot/invalid badge、删除前选中态 hint。Backspace 空输入删 block 有退出过渡。
- IME：全局 `shouldIgnoreImeKeyDown`，组合中 Enter 不确认。但 **Escape 被刻意永不忽略**（`imeKeyboard.ts` 注释："a stuck composition flag must not trap the user"），host Esc 处理只清 flag 不 return——**中文输入法候选词中按 Esc 会同时关闭 launcher**。这是防卡死的设计权衡，但对中文用户是每天高频的真实摩擦（详见 §4 问题 2）。

### 2.3 工具间衔接

- launcher → Quick Editor：`executeObjectAction` 提供 openInEditor / newPane / insertBelow / replaceSelection 等目标；collect-input/result 的三目的地切换一致；clipboard-history 等 surface 支持"带回 launcher"（return-to-launcher）闭环。链路骨架顺滑。
- **衔接断裂 1**：`QuickEditorCommandOverlay` **没有传 `onPastePreviewText`**，其 collect-input/result 帧的目的地只有"复制/带回 launcher"，没有"粘贴到前台应用"。用户在编辑器里触发命令，想把结果直接粘贴回原应用——做不到，必须先复制、关 overlay、再粘贴。与 Global launcher 不一致。
- **衔接断裂 2（P0）**：`QuickEditorCommandOverlay` 有 `closeOnFocusLeave`——**焦点离开面板就整体关闭 overlay**。用户在多步参数输入中途点一下编辑器（或焦点被 Monaco 抢走），overlay 直接关闭，**已输入的参数全部丢失**。Global launcher 没有 blur-close（独立窗口有 `useCloseStandaloneLauncherOnBlur`，但那是整窗策略且可配置）。这是数据丢失类问题。
- Quick Editor 两段式 Esc（第一次只出轻提示、1.5s 内第二次才退出）防误触是对的；Monaco find widget 打开时 Esc 优先关 widget（plugin surface frame 的 interceptor 有同样处理）。一致。

### 2.4 结果交付

- 单文本结果与 collect-input live preview **共享** `LauncherOutputTargets`（copy / paste-foreground / return-to-launcher），键盘映射统一（↵/⇧↵/⌘↵，Tab 循环，footer 只保留 ⇥+esc 避免重复）。preview well 常驻挂载、打字时高度不抖（`lastPreviewRef` latch）、stale 态有 `data-stale` 标记。交付规则一致、可预期——这是代码里做得最好的部分之一。
- live preview 为空时显示 `LauncherEmptyWell`（"开始输入"），suggest 模式空结果有"返回"按钮。空态不裸奔。
- `primaryActionLabel` 对 dynamic directAnswer 显示"复制"；在 Quick Editor overlay 里复用同一 footer 时，实际行为是"写入编辑器"而非"复制"——若成立，是"所见非所得"，需真实 UI 验证。

### 2.5 设置页 / 插件管理页 IA

- `SystemSettingsSurface` 是 5 tab 侧边栏：基本设置 / AI 订阅 / 插件管理 / 学习规则 / 行为观察。信息架构清晰，但两个细节：
1. "学习规则" tab 用 **Sparkles** 图标，而 Quick Editor 顶栏的"运行命令"按钮也是 **Sparkles**——同一图标两种含义，易混淆。
2. 切换语言触发**全页 reload + 全屏 spinner 遮罩**（`switchingLocale`），粗暴但有效；会丢失 launcher 上下文，可接受。
- 插件管理：builtin/installed/dev 三类分区、有搜索（`searchableFieldsMatch`）、状态标签（启用/禁用/错误/阻塞）、图标用 pluginId hash 选 6 种蓝色系（刻意避开紫粉，符合 brand）。dev 插件支持 watch/reload/import（zip/URL/本地目录/Github 目录），对"可扩展"定位是加分的。但**插件行操作（启用/禁用/卸载/设置/快捷键）全部挤在一行**，1134 行的 `PluginsContent.tsx` 提示信息密度已接近上限。
- AI 订阅 tab：OAuth 登录后 1.5s 轮询、最多 5 分钟，静默失败不打扰；quota 展示。流程完整。

### 2.6 键盘操作覆盖度

- Global launcher：↑↓/Enter/Esc/Tab/⌘1–8/⌘P/⌘↵/⇧↵/空格（多选）/⌫（空输入退栈），覆盖完整；footer hints 与实际按键一致（除 §4 问题 8）。
- 设置页 tabs 是普通 button（Tab 可达），无 roving tabindex/箭头键导航——可接受，未断裂。
- Quick Editor：⌘K 命令、⌘W 关 pane、⌘\ 分屏等，但**分屏快捷键无处可发现**（无 footer hint、无命令面板入口说明），用户只能读源码知道。

### 2.7 返回 / 取消（Esc 层级）

- 统一模型已落地："每按一次 Esc 向外退一层"（IME → 页内浮层 → 流程帧 → 页面 → 关窗）。permission/surface/overlay 都经 interceptor 注册，无裸奔。
- Quick Editor 命令 overlay 的 Esc 语义已从"整体关闭"修正为"退一级"（`overlayEscapeHandler` 先 `controller.back()`），与 Global 一致。好。
- 遗留摩擦见 §4 问题 2（IME + Esc）。

### 2.8 错误恢复

- 命令失败：帧内红色错误条；collect 帧带 `role="alert"`，search 帧的 error 条无 role——小不一致。
- 插件崩溃：`PluginSurfaceErrorBoundary` 捕获，`PluginSurfaceMessage` error 态带"返回"按钮，不会白屏。
- surface 打不开（target 非法）：`WindowMessage` 显示 `invalidTarget`。
- 粘贴失败：toast 提示 + 自动降级"已复制到剪贴板"。Toast 四级（info/success/error/warning），挂载点覆盖主窗口/插件窗口/detached 编辑器。Global launcher 窗口内的 toast 依赖主窗口的 `ToastContainer`——Tauri 下 launcher 是独立窗口，独立 launcher 窗口是否有 ToastContainer 挂载。

### 2.9 美观与一致性

- token 落实好；行高 44px、圆角 10px、行间距 2px 的 Raycast 式列表；hover 用中性灰（注释明确拒绝"近乎隐形的墨洗"式 hover，回应了 PRODUCT.md anti-references）。
- 小不一致三处：`RecentClipboardHint` 用 📋 emoji 图标（全站其余用 Lucide）；`LauncherParamStep` 复用了本地 `HintKey` 而非 `LauncherFooterHints` 的 `LauncherHintKey`（视觉一致、代码重复）；search 帧 error 条与 collect 帧 error 条样式/role 不统一。

## 3. i18n 抽查

- 核心链路（launcher 帧、设置、编辑器、权限、toast）文案走 `t()`，中英 key 齐全；`pickLocale` 仅用于短暂性文案，符合仓库规范；托盘原生文案是文档认可的唯一例外。
- **漏网 1**：`src/launcher/clipboard/objectBlock.ts` 的 `SOURCE_LABELS` 硬编码中文（'剪贴板'、'当前选区'、'当前 pane'、'当前文档'、'两个 pane'、'剪贴板历史'），`ObjectBlockToken` 直接渲染——**英文 locale 下仍显示中文**。违反仓库"用户可见文案必须走 i18n"规则。`KIND_LABELS` 多为英文技术词（JSON/URL/SQL），双语可接受。
- **漏网 2**：`RecentClipboardHint` 的 📋 emoji 在英文 locale 下无问题，但图标体系与 Lucide 不一致；其 `locale = 'zh'` 默认参数在未传 locale 时恒为中文（调用方都传了，低风险）。
- 长文本排版：德式 kbd（如 `⌘⇧V`）与中文混排无断裂设计；`launcher-empty-well` 等容器无固定宽度，CJK 下应安全。需真实 UI 确认。

## 4. 问题清单

| # | 位置 | 现象 | 严重程度 | 改进方向 |
|---|------|------|----------|----------|
| 1 | `QuickEditorCommandOverlay.tsx` `closeOnFocusLeave` | overlay 失焦即整体关闭，多步参数输入丢失 | **P0** | 失焦保持 overlay（仅 Esc/×/执行关闭），或至少保留 controller 帧栈；与 Global launcher 的关闭策略对齐 |
| 2 | `GlobalLauncherHostLifecycle.ts` + `imeKeyboard.ts` | 中文 IME 候选词中按 Esc 会关闭 launcher（Escape 永不忽略是防卡死的权衡） | **P1** | `isComposing`/keyCode 229 时让 IME 优先消费，同时加 compositionend 丢失的超时熔断（如 2s 自动解除），保住防卡死意图 |
| 3 | `ranking.ts` + `LauncherMixedList` | 排序零解释：frecency/固定/learned-rule boost 不可见，只有 match 高亮 | **P1** | 行内 subtle 来源信号（如"常用"标记）或 footer 说明排序依据； learned 命中的行给轻量标识 |
| 4 | `QuickEditorCommandOverlay.tsx` | overlay 内无"粘贴到前台应用"目的地（未传 `onPastePreviewText`） | **P1** | 补齐第三目的地，或在产品语义上明确"编辑器内命令输出只写编辑器"并让 footer 说清楚 |
| 5 | `GlobalLauncherSearchFrame.tsx` | 无结果时只有 title+hint，`LauncherEmptyWell` 的 action slot 空置 | P2 | 无结果时提供"作为内容处理"一键转 Object Block，把死路变通路 |
| 6 | `DESIGN.md` vs `QuickEditorPanel.tsx` | 文档称 single editor（no multi-pane split），实现有完整多 pane 分屏 | P2（方向级） | 二选一：承认分屏是功能并补文档/发现入口，或按文档砍掉分屏 |
| 7 | `objectBlock.ts` `SOURCE_LABELS` | 来源标签硬编码中文，英文 locale 下仍显示中文 | P2 | 走 i18n key |
| 8 | `LauncherParamStep.tsx` footer | 文本参数时 footer 显示"↵ 选择"，实际是提交/运行 | P3 | 按参数类型区分 footer 动词（提交/运行/选择） |
| 9 | `RecentClipboardHint.tsx` | 📋 emoji 与 Lucide 体系不一致 | P3 | 换 Lucide `Clipboard` 图标 |
| 10 | 设置页 tabs | Sparkles 图标同时用于"学习规则"和编辑器"运行命令" | P3 | 学习规则改用 `BrainCircuit`/`GraduationCap` 等 |
| 11 | search/collect error 条 | search 帧 error 无 `role`，collect 帧有 `role="alert"` | P3 | 统一为 `role="alert"` |
| 12 | Quick Editor 分屏快捷键 | ⌘\/⌘W/⌘⌥←→ 无处可发现 | P3 | 在状态栏或命令面板露出，或砍掉分屏（见 #6） |

## 5. 如果只改 3 处交互，收益最大的是

1. **Overlay 失焦不丢输入（#1）。** 这是唯一的数据丢失类问题。Quick Editor 是"精确文本工作台"的核心 surface，命令 overlay 是用户在编辑器里最高频的调用方式；多步参数（尤其是 text-diff 选两个 pane、encode 选参数）输入到一半因焦点漂移全丢，是对"精确/可靠"品牌最直接的伤害。改动小（去掉 blur-close 或改为失焦保持），收益是信任。
2. **中文 IME 下 Esc 让行输入法（#2）。** 目标用户含中文开发者，launcher 是"每天打开几十次"的入口；候选词中按 Esc 是输入法肌肉记忆，当前行为（关 launcher）每次都会打断心流。加超时熔断后防卡死意图可保留，风险可控。
3. **排序可解释性（#3）。** 用户每天打开 launcher，第一行是不是他想要的、以及"为什么是这条"，决定了他是否信任这个入口。frecency/learned-rule/pin 三种 boost 零可见，用户学不会"怎么让它更懂我"，学习功能（#10 的 tab）也就永远没有心智模型。行内给一个 subtle 的来源标记（如"常用""已固定"），成本远低于调 ranking 算法。

## 6. 给产品方向的附带判断（设计视角，供交叉审查）

- **不要加 AI 聊天框。** Launcher 的核心资产是"唤起无动画、≤150ms 反馈"的手感；任何聊天框都会破坏 quiet/precise 的品牌并引入延迟。AI 若接入，最顺的两个环节是：① **输入理解**——把自然语言转成"命令+参数预填"（仍是规则执行，有确定回退）；② **结果后处理**——对输出做摘要/结构化，渲染在现有 preview well 里，不开新 surface。且必须有"无 AI 时走规则"的静默降级。
- **Object Block 是差异化资产。** "剪贴板/选区是对象、可被推荐动作处理"是 Boop/Raycast 都没有做透的模型；#5（无结果转 block）和 #4（编辑器内粘贴前台）都是在加固这条链路，值得优先于加新插件。
- **可删除/合并的候选**：设置页 5 个 tab 中"行为观察"与"学习规则"对普通用户是同一心智（"它在学我"），可合并为一个"学习与记录"；Quick Editor 的分屏若不做发现入口就不如砍掉（#6/#12）。
