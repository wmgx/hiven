# hiven UI/交互优化机会清单

日期：2026-07-07　分支：`refactor/workbench-window-architecture`

范围声明：本清单不重复 `doc/archive/2026-07-07-ui-interaction-review.md` 与 `doc/archive/2026-07-07-architecture-review.md` 已覆盖的问题（i18n 硬编码、closeOnBlur、Escape 语义不一致、Pinned/Live Runner 死功能、`openDiffPage` 静默失效等）。凡与上述报告共享根因但结论/影响面不同的项，均在正文注明关联而非重复计入。

排序：按"预期用户价值 × 实现代价"从高到低。

---

## 1. 全应用的"命令执行反馈"通道已完全断链，用户感知不到任何命令成功/失败

**现状（证据）**：`setLastCommandStatus`（`src/store.ts:424`）被 9 个文件、覆盖几乎所有插件执行路径调用——`src/workspace/pluginCommandExecutor.ts:18,42,58,68,77,80`（每次命令 running/success/error）、`src/workspace/pluginHookManager.ts:51`、`src/workspace/pluginBackgroundManager.ts:56`、`src/workspace/launcher/pluginApi.ts:261`、`src/workspace/quickEditor/quickEditorActions.ts:59,125`（含插件专门用来"仅提示不改文本"的 `status.message` effect）、`src/components/PluginSettingsInline.tsx:123`、`src/components/PluginSettingsDialog.tsx:244`、`src/components/pluginSurface/PluginSurfaceRenderer.tsx:179`（所有插件 surface 的 `host.showMessage()` 最终都走这里）。但全仓搜索 `lastCommandStatus` 的唯一读取者是 `src/components/workspace/RenderStatusBar.tsx:16`，而它只被 `src/views/EditorView.tsx:34` 引用——`EditorView` 正是架构报告里确认的"退休主编辑器窗口后彻底不可达"的孤儿组件（`src/components/EditorWindow.tsx` 无任何导入者）。同样命运的还有一套完整做好的 toast 系统：`src/workspace/toast.ts`（`showToast()` 导出函数，含自动消失/persistent 选项）+ `src/components/workspace/ToastContainer.tsx`（含滑入动画、四种 level 配色、手动关闭按钮），`ToastContainer` 同样只被 `EditorView.tsx` 引用，`showToast()` 在全仓库没有任何调用点。也就是说：剪贴板历史里 `host.showMessage(t('message.deleted'), 'success')`（`src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx:223`）、`message.copied`、`error.pasteFailed` 等，以及 Quick Editor 命令栏执行任何插件命令的成功/失败提示，在当前可达的 Global Launcher + Quick Editor 架构下**全部静默丢失**，界面上什么都不会发生。
**优化方向**：把 `<ToastContainer />` 挂载到实际可达的根组件（`src/App.tsx` 的 `LauncherRuntimeApp` 与 Quick Editor detached window 根），并让 `setLastCommandStatus`/`host.showMessage` 的调用路径同时（或改为直接）调用已经写好的 `showToast()`。组件和样式都已存在，核心工作量是"挂载 + 路由"而不是从零设计。
**用户价值**：这是"复制成功、命令执行完成用户能感知吗"这一问题的直接答案——目前答案是否，本条一次性修复覆盖几乎所有插件命令的反馈缺失。
**代价粗估**：S-M（组件已建好，需要接线到当前可达的 root 并核实各调用点语义）。
**类别**：反馈

---

## 2. 剪贴板历史单条删除没有确认或撤销，最常用的键（Backspace）即可造成不可逆丢失

**现状（证据）**：`src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx:238-241` 的键盘处理里，`Delete` 或 `Backspace` 直接调用 `handleDelete(selectedItem.id)`（`:220-224`，内部 `repository.deleteItem` 立即执行，无二次确认），列表每一行也有一个鼠标可点的删除按钮（`:509-516`）同样直接触发。对照同一插件"清空全部"操作明确设计了确认弹窗（`src/plugins/clipboard-history/locales/zh.json:14` "确定要清空全部剪贴板历史吗？此操作不可撤销"、`:56` "确认清空"按钮），单条删除反而没有任何保护——而 Backspace 是用户在搜索框打字、或误触时最容易按到的键之一。
**优化方向**：给单条删除加一个短暂的 undo（例如复用上面第 1 条的 toast，"已删除 · 撤销"5 秒可撤销）而不是弹确认框打断心流；或者至少 Delete/Backspace 触发时用轻量视觉状态（如条目变灰 + 撤销提示）代替立即从列表消失。
**用户价值**：防止最高频交互（浏览剪贴板历史时误按 Backspace）导致的不可逆数据丢失。
**代价粗估**：S（复用第 1 条的反馈通道即可实现 undo toast）。
**类别**：交互流程 / 反馈

---

## 3. 插件权限授权页没有任何键盘路径，也没有 footer 快捷键提示

**现状（证据）**：`src/components/launcher/GlobalLauncherKeyboard.ts:108-115` 里 `itemPermissionFrame` 分支只处理 `Escape`（取消），其余按键直接落空——`Enter` 不会触发"允许"。而实际渲染的 `PluginSurfacePermissionGate`（`src/components/pluginSurface/PluginSurfaceRenderer.tsx:197-232`）"允许"/"返回"是两个普通 `<button>`（`:223-228`），既没有 `autoFocus`，也没有 `GlobalLauncherPermissionFrame.tsx` 层面的 footer 提示——对比同一文件家族里其它每一个 frame（搜索、collect-input、result、param-input）都有 `l-foot` + `LauncherHintKey` 告诉用户"↵ 确认 · esc 返回"，唯独权限门是例外（`grep "l-foot"` 在 `GlobalLauncherPermissionFrame.tsx` 零命中）。用户第一次使用任何需要权限的插件命令，必须用鼠标点击"允许"，且不会被告知这一点。
**优化方向**：在 `GlobalLauncherKeyboard.ts` 的 `itemPermissionFrame` 分支里补 `Enter` → `onGrant()`；在 `GlobalLauncherPermissionFrame.tsx` 加一条 `l-foot` footer，展示"↵ 允许 · esc 返回"。
**用户价值**：让"键盘优先"的产品承诺在插件首次使用的必经关卡上不掉链子。
**代价粗估**：S。
**类别**：键盘 / 交互流程

---

## 4. Global Launcher 搜索无结果时是一片空白，没有任何空态提示

**现状（证据）**：`src/components/launcher/LauncherMixedList.tsx:30` `if (items.length === 0) return null`；调用方 `src/components/launcher/GlobalLauncherSearchFrame.tsx:125-140` 的 `global-launcher-body` 容器在没有 `hint`（最近剪贴板提示）时不会渲染任何兜底内容，搜索区域直接呈现空白面板。i18n locale 文件里其实已经定义了 `palette.noResults`（`src/i18n/locales/palette.ts:5,71` "No actions found"/"未找到操作"），但该 key 目前只在 `LauncherDomainSearchStep.tsx:72`、`LauncherResultStep.tsx:147` 这两个不同的子流程里使用，主搜索路径完全没有消费它。
**优化方向**：在 `GlobalLauncherSearchFrame.tsx` 里，当 `items.length === 0 && query` 时渲染 `t(locale, 'palette.noResults')` 的空态（可以顺带给一条"检查拼写或安装更多插件"之类的辅助文案）。
**用户价值**：搜不到东西时至少告诉用户"确实没有"，而不是让人怀疑输入法坏了或者应用卡住。
**代价粗估**：S。
**类别**：反馈

---

## 5. 插件 surface 加载失败/未找到时，仍然显示一个永远转动的 loading 指示器

**现状（证据）**：`src/components/pluginSurface/PluginSurfaceRenderer.tsx` 里 `loading-runtime`（`:127-128`）、`error`（`:130-131`）、`surface-not-found`（`:133-134`）、`before-open`（`:136-137`）四种状态全部复用同一个 `PluginSurfaceMessage`（`:234-242`），而 `PluginSurfaceMessage` 内部固定渲染 `plugin-surface-window-message__indicator`（`:237`），对应 CSS（`src/components/PluginSurfaceWindow.css:86-97`）是一个 `animation: plugin-surface-spin 0.8s linear infinite` 的持续旋转圆环——也就是说插件"加载失败"或"未找到"时，用户看到的是一个和"正在加载"视觉上完全相同、还在不停转的指示器，只是旁边多了一行错误文案，容易让人以为程序卡在加载状态。这是一个独立于同一批文案已知 i18n 硬编码问题（见既有报告）之外的纯视觉/状态设计缺陷。
**优化方向**：`PluginSurfaceMessage` 按 `status` 传入图标——loading/before-open 用旋转指示器，error/surface-not-found 用静态错误图标（如 lucide `AlertTriangle`），并给 error 状态配合背景色/文字色区分（当前 `error` 消息颜色和 loading 消息颜色完全相同）。
**用户价值**：加载中和已失败在视觉上应该是两种状态，而不是共享一个"看起来还在转"的指示器造成误解。
**代价粗估**：S。
**类别**：反馈 / 视觉打磨

---

## 6. 设置页的"通用/快捷键/编辑器/行为"分组图标是拼凑的 Unicode 字符，不是 DESIGN.md 规定的 lucide 线性图标

**现状（证据）**：`src/surfaces/SettingsContent.tsx` 里 `SettingsListRow` 的 `icon` 参数在这一整页里全部传的是裸字符：`icon="文"`（:26，语言，已被既有报告单独标记为中文硬编码）、`icon="◐"`（:39，深色主题）、`icon="⌘"`（:45，全局快捷键）、`icon="A"`（:60，字号）、`icon="↵"`（:67，自动换行）、`icon="#"`（:70，行号）、`icon="⊡"`（:76）、`icon="📌"`（:79）、`icon="☾"`（:82）、`icon="↻"`（:88，版本）。DESIGN.md 明确写"Icons: Pure line (lucide-react style: thin stroke, no fill, currentColor only – exactly matching the app's current lucide usage)"（DESIGN.md:16）。对照同一设置面板的另一个 Tab——`src/surfaces/PluginsContent.tsx` 里插件快捷键区域老老实实用的是 `<Keyboard size={14} />`、`<AlertTriangle size={12} />` 等真实 lucide 组件——同一个"系统设置"页面下两个 Tab 的图标语言完全不统一，一个符合契约、一个是紧急拼凑的字符占位符。
**优化方向**：把这 10 行的 `icon` 替换为对应语义的 lucide 图标（如 Languages、Moon、Command、Type、WrapText、Hash、Bookmark、RefreshCw 等），与 `PluginsContent.tsx` 的图标语言统一。
**用户价值**：设置页是新用户建立"这是不是一个精工细作的工具"第一印象的地方，图标语言不统一会立刻暴露"这是占位符没有收尾"的信号，与"quiet, precise, capable"的品牌人设相悖。
**代价粗估**：M（10 处替换 + 需要选出语义匹配、风格一致的图标，可能要过一次设计确认）。
**类别**：视觉打磨

---

## 7. Global Launcher 选中行的圆角被两套 CSS 规则的级联冲突打平成直角，视觉上既不是文档承诺的"圆角高亮条"也不是纯 VS Code 风格

**现状（证据）**：DESIGN.md 的 Open Questions 明确记录最终选定的视觉是"neutral gray selected rounded bar"（DESIGN.md:114）。实际渲染的行同时命中两条规则：`src/index.css:4418-4443` 的 `.l-row` 基础规则设了 `border-radius: var(--radius-sm)`（单类选择器，特异度 0,0,1,0），`.l-row.sel`/`.l-row.selected` 用 `background: var(--accent-soft) !important` 着色；而 `src/index.css:311-316` 的 `.global-launcher-panel .cmd-item.selected, .palette-panel .cmd-item.selected` 用两类选择器（特异度 0,0,2,0，高于 `.l-row`）设了 `border-radius: 0` 且叠加 `box-shadow: inset 2px 0 0 var(--accent)`（左侧强调条）。由于 CSS 层叠按特异度而非书写顺序决出胜负，最终选中行 = 直角 + 柔和蓝色底色 + 左侧强调条三者叠加——既不是纯 Raycast 式圆角药丸，也不是纯 VS Code 式左条高亮，是两套历史上独立演进的选择器体系互相打架产生的"四不像"，可以在浏览器 DevTools 里直接验证（选中态计算样式 `border-radius` 为 `0px`）。
**优化方向**：二选一并清理另一套：要么在 `.l-row.sel`/`.l-row.selected` 上显式补回 `border-radius: var(--radius-sm)`（贴近文档"圆角高亮条"），要么承认现在的"左条+直角"是新的既成审美并在 DESIGN.md 里更新措辞、同时删掉 `.cmd-item.selected` 里矛盾的 `border-radius: 0`。当前"两条规则都留着、谁赢全靠特异度"的状态是需要清理的技术债。
**用户价值**：选中态是用户在 Launcher 里停留时间最长、扫视频率最高的视觉元素之一，两套皮肤打架产生的观感会被眼尖的用户注意到"这里有点怪但说不清哪里怪"。
**代价粗估**：S（一旦决定保留哪种视觉，改动是几行 CSS）。
**类别**：视觉打磨

---

## 8. Light 模式主题色实际是 `#2563eb`，与 DESIGN.md 明确承诺的 VS Code Blue `#007ACC` 不一致

**现状（证据）**：DESIGN.md 反复三次明确写"Accent: #007ACC (VS Code blue...)"（DESIGN.md:15）、"(Resolved) Exact accent: using VS Code #007ACC in light for authenticity and premium pop"（DESIGN.md:112）。但 `src/index.css:195-201` 的 light 主题变量块写的是 `--accent: #2563eb; --accent-hover: #1d56d8; ...  --color-accent: #2563eb;`（Tailwind blue-600，明显偏紫蓝，不是 VS Code 那个更青一点的 `#007ACC`），旁边 199 行的注释"统一 light 模式下的 accent 变量，避免旧紫色 tint 残留"说明这是一次有意的清理，但清理后落地的颜色值和文档"已解决"的颜色决议对不上。同一文件其余 light token（`--bg-page: #f3f3f3`、`--bg-surface: #ffffff`、`--text-primary: #000000`、`--text-secondary: #6f6f6f`、`--border: #e5e5e5`，均在 :186-193）都和文档完全吻合，只有 accent 这一个值实际落地时选了别的蓝。
**优化方向**：要么把 `--accent`/`--color-accent` 改成 `#007ACC` 并过一遍视觉回归（按钮、选中态、focus ring 等所有引用 accent 的地方），要么在 DESIGN.md 里把"已解决"的颜色决议更新为实际使用的 `#2563eb` 并说明原因（比如 `#007ACC` 在 accent-soft/tint 场景下对比度不够）。当前状态是"文档说已解决，代码另有选择"，两边都没错但互相矛盾。
**用户价值**：accent 色是全应用曝光度最高的品牌色（按钮、选中态、focus 环），文档与实现不一致会导致以后任何人（包括 AI agent）依据文档改色时引入新的不一致。
**代价粗估**：S（改值本身很轻，但需要设计一次确认，属于"看似小改动，实际有决策成本"）。
**类别**：视觉打磨

---

## 9. Global Launcher 结果列表刷新/切换时没有任何进入动效，尽管对应的 CSS 关键帧早就写好了

**现状（证据）**：`src/index.css:948-969` 定义了 `@keyframes palette-item-in`，并在 `:990-992` 封装成 `.anim-palette-item { animation: palette-item-in 0.2s ease both; }` 工具类；`:927-937` 同样有 `@keyframes dropdown-in` 和 `.anim-dropdown`。但全仓库搜索 `anim-palette-item`/`anim-dropdown` 在任何 `.tsx` 文件里都是零使用（`grep -rln "anim-palette-item\|anim-dropdown" src --include="*.tsx"` 无输出）。实际渲染搜索结果的 `LauncherMixedList.tsx:80-114` 只给 button 加了 `l-row cmd-item ...` 类，没有任何入场动效——每次按键过滤后新的结果集是硬切换出现的。
**优化方向**：把 `.anim-palette-item`（或者更轻量的、按 index 做小延迟的 stagger）应用到 `LauncherMixedListItem` 上，配合已有的 150-250ms 规范（该关键帧本身是 0.2s，正好落在区间内）。
**用户价值**：DESIGN.md 明确要求"Motion: Short, purposeful (150-250ms). State changes..."，这是一个成本极低、CSS 都写好了只是没接上的动效缺口，属于"举手之劳"级别的打磨点。
**代价粗估**：S。
**类别**：视觉打磨 / 交互流程

---

## 10. 设置页语言选择下拉（LocaleSelect）完全无法用键盘操作

**现状（证据）**：`src/surfaces/SettingsContent.tsx:132-167` 的 `LocaleSelect` 是一个纯 `<div onClick>` 手搓下拉：触发器 `<div className="sel-ctl" onClick={...}>`（:149）没有 `tabIndex`、没有 `role="button"`；展开的选项列表 `<div className="settings-select-item" onClick={...}>`（:156）同样是无 `role`/无 `tabIndex` 的 `div`；关闭逻辑只监听 `mousedown`（:138-142），完全没有 `keydown` 处理——不能用 Tab 聚焦到触发器，不能用 Enter/Space 展开，展开后不能用方向键选项、不能用 Enter 确认、不能用 Esc 收起，唯一的操作方式是鼠标点击。这是设置页里唯一的自定义下拉控件（对比同页的 `Toggle`、字号步进按钮都是原生 `<button>`，天然可键盘操作）。
**优化方向**：最小改法是把触发器和选项都换成原生 `<button type="button">`（天然获得 Tab 焦点、Enter/Space 触发、可见 focus ring），展开态再补方向键在选项间移动 + Enter 确认 + Escape 关闭。
**用户价值**：DESIGN.md 明确写"Full keyboard everywhere. Visible focus."（Accessibility 一节），这是设置页里唯一一个把这条承诺完全破例的控件，对键盘用户/键盘优先用户是一个真实的操作死角。
**代价粗估**：S-M（换成语义化按钮是小改动；补完整方向键导航略增工作量）。
**类别**：键盘 / 视觉打磨

---

## 11. Quick Editor 工具栏的语言标签看起来像控件，实际不可点击、也没有任何提示如何修改

**现状（证据）**：`src/components/quickEditor/QuickEditorToolbar.tsx:58-64` 把当前语言渲染成 `<span className="text-[10px] px-1.5 py-0.5 rounded" ...>{languageLabel}</span>`——有内边距、有圆角，视觉上和一个小徽章/按钮没有区别，但没有 `onClick`、没有 `title`、没有任何 hover 反馈。修改语言的唯一路径是打开 Quick Editor 命令面板（Cmd+K）后手动输入"language"/"语言"匹配到 `host:pane:set-language` 命令（`src/workspace/launcher/hostEditorActions.ts:355-369`）。用户第一次想换语言、点了这个"看起来能点"的标签，什么都不会发生，也不会被引导去用 Cmd+K。
**优化方向**：至少给这个 span 加一个 `title`（如"⌘K 输入「语言」修改" / "Press ⌘K and type 'language' to change"）；更进一步可以让点击直接打开命令面板并预填"language"查询。
**用户价值**：消除"看起来是控件却是死的"这种一次性的挫败体验，同时给键盘路径做一次免费的可发现性广告。
**代价粗估**：S（仅加 tooltip）到 S-M（加点击预填）。
**类别**：键盘 / 交互流程

---

## 12. Quick Editor 的分栏与切换焦点操作没有独立快捷键，必须先打开命令面板再输入搜索词

**现状（证据）**：`src/workspace/launcher/hostEditorActions.ts` 里 `host:pane:split-right`（:228，别名 `['split', 'split right', 'pane right', '右侧分栏', '分栏']`，:236）、`host:pane:split-down`（:245）、`host:pane:focus-next`（:284）、`host:pane:focus-previous`（:304）全部只能通过 Launcher/命令面板按名字搜到。对照同一个 Quick Editor 面板里，`src/components/quickEditor/QuickEditorPanel.tsx:116-130` 已经给"打开命令面板"（Cmd+K）和"关闭当前 pane"（Cmd+W）注册了 Monaco action 级别的直接快捷键（`keybindings: [2048 | 41]`、`[2048 | 53]`），说明这套机制现成可用，只是没有覆盖 split/focus 这两个动作。全仓搜索 `focus-next`/`focus-previous`/`focusRelativePane` 在 `src/hotkeys/` 和 `src/components/quickEditor/` 下没有任何绑定。
**优化方向**：仿照 Cmd+K/Cmd+W 的写法，给 split-right/split-down/focus-next/focus-previous 各加一条 Monaco action 快捷键（常见约定如 Cmd+\ 分栏、Cmd+] / Cmd+[ 切换焦点），命令面板路径保留作为"记不住快捷键时的兜底"。
**用户价值**：分栏和切换焦点是编辑器里的高频动作，"每次都要 Cmd+K 再打字搜"对一个标榜"Keyboard delight: Every surface feels built for speed"的产品来说摩擦明显偏高。
**代价粗估**：S-M（复用已有的 action 注册模式，主要工作是选定不冲突的按键组合）。
**类别**：键盘

---

## 13. 搜索结果不高亮匹配片段，拼音/首字母匹配对用户来说像"猜的"

**现状（证据）**：`src/workspace/searchRanking.ts` 实现了相当完整的匹配体系——直接子串（:63-68）、别名子串+拼音+混合首字母（:70-73，`pinyinMatch`/`mixedAcronymMatch` 定义在 :25-57）、六级 tier 打分（`scoreSearchableFields`，:88-124）。但渲染层 `src/components/launcher/LauncherMixedList.tsx:102-107` 只是 `<span className="r-title">{item.title}</span>`、`<span className="r-desc">{item.subtitle}</span>` 原样输出，没有任何高亮匹配片段的逻辑——`GlobalLauncherSearchFrame.tsx` 和 `EditorCommandBarHost.tsx` 两个复用同一组件的入口都受影响。当用户靠拼音首字母（如输入"fzq"命中"格式化"）或别名命中时，结果列表上完全看不出"为什么是这一条"，体验上更像黑箱猜测而不是可验证的搜索。
**优化方向**：先做最容易的一档——直接子串匹配（title/subtitle 里连续出现 query 的部分）用 `<mark>` 或加粗高亮；拼音/首字母匹配可以退而求其次，在该行右侧加一个极简的匹配类型提示（如小字"拼音"）而不必真的高亮汉字片段。
**用户价值**：把已经很强的搜索算法的"结果"变成用户能看懂、能建立信任的"过程"，减少"这个应用怎么知道我要找这个"的困惑感，也提升复杂查询下的可扫描性。
**代价粗估**：M（直接子串高亮容易；拼音匹配的高亮定位涉及原文与拼音串的映射，如果做全套需要更多设计取舍）。
**类别**：交互流程 / 视觉打磨

---

## 14. 全局没有 `prefers-reduced-motion` 支持，与 DESIGN.md 的无障碍承诺不符

**现状（证据）**：DESIGN.md 明确写"Accessibility & reduced motion: WCAG AA+, full keyboard, respects prefers-reduced-motion"。但 `src/index.css`（7196 行，定义了 `pulse-dot`/`badge-pop`/`card-in`/`console-line-in`/`dropdown-in`/`running-pulse`/`palette-item-in`/`bump`/`pinned-dropdown-in`/`object-target-push` 共 10 个 `@keyframes`，见 :883-969、:1557、:6532）里没有一处 `@media (prefers-reduced-motion: reduce)`。全仓搜索确认唯一处理了这个媒体查询的文件是 `src/plugins/translate/style.css:392`，是某个插件自己做的局部处理，host/framework 层完全没有覆盖。
**优化方向**：在 `index.css` 顶层补一条通用规则（如 `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; } }`），对无限循环动画（`pulse-dot`/`running-pulse`）额外确认它们不是承载功能语义（比如"正在运行"的唯一指示），必要时降级为静态图标+文字。
**用户价值**：对有前庭功能敏感/动作敏感的用户，这是一个从"文档写了但完全没做"到"做到"的可验证无障碍缺口，一次性全局生效。
**代价粗估**：M（全局规则本身是 S，但需要过一遍两个 infinite 循环动画是否承载功能语义，避免降级后丢失状态指示）。
**类别**：视觉打磨 / 反馈

---

## 15. Global Launcher 列表行不显示插件已绑定的自定义快捷键，快捷键的"可发现性"止步于设置页

**现状（证据）**：`src/surfaces/PluginsContent.tsx` 已经为插件 surface 做了完整的快捷键录入 + 冲突检测（`shortcutBindableSurfaces`/`pluginSurfaceShortcuts`/`scripts.surfaceShortcutConflict`，:858-940），用户可以给"剪贴板历史"这类插件 surface 绑定一个全局快捷键。但 `src/workspace/launcher/types.ts` 的 `LauncherItem`/`display` 类型定义里没有任何 shortcut/accelerator 字段，`src/components/launcher/LauncherMixedList.tsx` 渲染每一行时也只展示 `r-tag`（类型标签，如"命令"/"插件"）和选中态的 `↵`，从未展示"这个条目已经绑定了 ⌘⇧V"这类信息。用户设置好快捷键之后，如果想确认"我到底给这个功能配的是哪个键"，必须回到设置页面逐条翻找，Launcher 列表本身给不出这个信息。
**优化方向**：`buildGlobalLauncherItems`（`src/components/launcher/GlobalLauncherItems.ts`）读取 `usePluginSurfaceShortcutStore` 里已绑定的 accelerator，在对应行的 `r-tag` 旁边或替代位置渲染一个小 `<kbd>` 提示（类似 Raycast 列表右侧的快捷键徽标）。
**用户价值**：把"我配置过的快捷键"从"设置页里的历史记录"变成"浏览列表时顺手就能确认"的即时反馈，减少配置完就忘、或者不确定是否生效的困惑。
**代价粗估**：M（需要打通 plugin-surface-shortcut store 与 launcher item 构建管线，涉及跨模块的数据拼接）。
**类别**：键盘

---

## 16. 设置页切换语言会静默触发整页硬刷新，没有任何"即将重新加载"的提示

**现状（证据）**：`src/surfaces/SettingsContent.tsx:33-36`：
```tsx
onChange={(value) => {
  updateSetting('locale', value)
  setTimeout(() => window.location.reload(), 100)
}}
```
点击语言选项 100ms 后整个页面硬刷新，中间没有任何过渡、提示文案或 loading 状态——对不熟悉这个行为的用户，视觉上和"应用崩溃重启"没有区别。
**优化方向**：给这 100ms 窗口配一个极简的"正在切换语言…"提示（哪怕只是把下拉菜单短暂替换成一行文字），或者用一次轻量的 fade-out 过渡代替生硬的白屏刷新。
**用户价值**：把一个可能被误解为"崩溃"的行为，变成一个可预期、可解释的"设置正在生效"过程。
**代价粗估**：S。
**类别**：反馈

---

# DESIGN.md 契约本身值得进化的点

1. **"Open Questions" 里的 Launcher 分组描述与实际的排序设计已经脱节，但没有互相引用**：DESIGN.md:114 写"referenced Raycast layout for item rows...section headers（'建议'/'结果'）"，暗示结果应该分区块展示。但更晚、更具体的 `doc/plans/2026-06-12-launcher-system-design.md:122` 明确写"There is no 'Common Features' group"，且 `src/workspace/launcher/ranking.ts` 顶部注释直接引用"design doc §6"说明这是刻意的产品决策（单一排序列表，不分组）。这不是实现没跟上文档，而是**有一份更新、更具体的设计文档已经推翻了 DESIGN.md 这一句话，但两份文档没有互相引用，导致 DESIGN.md 读者会得到过时的结论**。建议 DESIGN.md 要么删掉"section headers"这句话，要么明确标注"该决定已被 2026-06-12 Launcher 排序设计取代，见该文档"。
2. **Dark 模式 accent 色在文档内部自相矛盾**："Final chosen visual scheme"一节说"modern indigo accent #8b93ff range"（DESIGN.md:17），而"Visual language"一节说"Accent: A sharp, modern teal-indigo (e.g. #3b82f6 or refined #6366f1)"（DESIGN.md:75）——两处给出的是不同色号，且都不是同一个"indigo"。代码实际用的是 `#3b82f6`（`src/index.css:127`），符合第二处但不符合作为"最终定稿"的第一处。建议在下一次设计复核时收敛成唯一色号，避免"文档内部哪句话才是权威"的歧义。
3. **DESIGN.md 仍然以"Main workbench + sidebar/rail + 多 pane"为核心信息架构描述**（DESIGN.md:6,54,56 等），但这与本次和既有架构报告确认的事实（当前产品形态是"系统托盘 + 全局热键 Launcher + 可 detach 的单编辑器"，没有常驻主窗口/侧边栏概念）不是细节滞后，是整个 IA 章节已经不对应任何可达界面。这一点架构报告已经建议"加一行过期声明"，本报告从 UI 设计契约的角度重复确认其必要性：只要这一章不更新，后续任何人（含 AI agent）依据 DESIGN.md 做"侧边栏/多 pane"相关的设计决策都会走错方向。
4. **"Motion: Short, purposeful (150-250ms)"的表述没有区分微交互（hover/选中态切换）与宏观状态变化（面板展开、pane 分栏）**：实测代码里绝大多数 hover/selected 过渡是 120-140ms（如 `src/index.css:4428` 等大量 `transition: ... 0.12s/0.14s`），这些其实符合更常见的"快速反馈类交互应比 150ms 更短"的实践惯例，并不违反设计初衷；但字面对照 DESIGN.md 的单一区间会显得"处处违规"。建议把动效规范拆成两档——"即时反馈类（hover/按下/选中）≤150ms"和"结构性状态变化（面板展开、分栏、detach）150-250ms"——这样代码现状能更准确地被评估，也更方便日后判断"这处 120ms 是合规的快反馈还是该補到 150ms 的结构过渡"。
