# UI 体验打磨三批次（速赢 / 视觉对齐 / 键盘搜索）设计文档

> 日期：2026-07-07
> 状态：设计确认，待执行
> 前置依赖：第一包（`doc/2026-07-07-workbench-retirement-cleanup-design.md`）执行完成后再做本文档内容。硬依赖两点：批次 A 多条依赖第一包 4.4 节接通的 toast 反馈通道；批次 B1 需在第一包删除设置页 Pinned 死开关之后进行。
> 证据来源：`doc/archive/2026-07-07-ui-opportunities.md`（逐条 file:line 证据）。行号为 2026-07-07 快照，执行前以符号名重新定位。
> 已拍板的产品决策（2026-07-07，产品负责人确认）：① Launcher 选中行收敛为**圆角药丸**样式（Raycast 式，无左侧竖条）；② light 主题 accent **追认代码现状 `#2563eb`**，更新文档而非改代码。

## 全局约束（三个批次通用）

1. 所有新增用户可见文案必须走 i18n 管线、中英文同步补齐——这是仓库红线，无例外。
2. 外科手术式修改：只改本文档列出的点，不顺手重构、不改无关样式。
3. 每批次独立提交、独立验收；批次内每条完成即可跑一次构建。B、C 两批次之间无依赖，可并行。
4. 每批次完成后执行仓库验证四件套：`git status --short --ignored` / `npm run check:architecture` / `git diff --check` / `npm run build`，涉及 UI 的条目按各自验收标准做真机验证。

---

## 批次 A：体验速赢（7 条，均为小改动）

### A1 剪贴板历史单条删除加撤销

现状：`ClipboardHistorySurface.tsx` 中 `Delete`/`Backspace` 及行内删除按钮直接调用 `repository.deleteItem`，立即不可逆；对照"清空全部"却有确认弹窗。

规格：

- 删除仍即时生效（列表立即移除，保持响应快感），**不加确认弹窗**。
- 同时弹出 toast：「已删除 · 撤销」（复用第一包 4.4 接通的 toast 通道），撤销窗口 5 秒；点击「撤销」恢复条目至原位置，置顶态与元数据不丢。
- 实现方式（软删延迟提交，或先删再重插）由执行侧定，以上述行为为准。
- 焦点保护：仅当焦点在列表（非搜索输入框）时 Backspace 才触发删除；执行前先核实现状是否已隔离，未隔离则一并修。

验收：列表选中一条按 Backspace → 条目消失 + toast 出现 → 5 秒内点撤销 → 条目回原位；搜索框内打字删字符不误删条目。

### A2 插件权限授权页补键盘路径

现状：权限门的「允许/返回」是两个普通按钮，Enter 无绑定、无 autoFocus、无 footer 快捷键提示；launcher 其它每个 frame 都有 `l-foot` 提示，唯独这里没有。

规格：Enter → 允许；Esc → 返回（已有）；补 `l-foot` footer「↵ 允许 · esc 返回」（复用 `LauncherHintKey` 组件与既有 hint 样式，文案 i18n）。键盘处理挂在权限 frame 现有的键盘链位置（`GlobalLauncherKeyboard.ts` 的 `itemPermissionFrame` 分支；若第三包已执行、该逻辑已迁入 interceptor，则在对应 handler 内实现）。

验收：触发任意需要权限的插件命令 → 不碰鼠标，Enter 完成授权；footer 提示可见、双语正确。

### A3 Launcher 搜索无结果空态

现状：`LauncherMixedList.tsx:30` 空列表 `return null`，搜索区域纯空白；`palette.noResults` 文案 key 已存在但主搜索路径未消费。

规格：`GlobalLauncherSearchFrame` 中当 `items.length === 0 && query 非空` 时渲染空态：主文案 `palette.noResults`，样式与 `LauncherDomainSearchStep.tsx:72` 既有空态一致。query 为空时维持现状。不加插画、不加按钮（气质克制）。

验收：输入乱串 → 显示「未找到操作 / No actions found」；清空输入恢复默认列表。

### A4 插件 surface 失败态与加载态视觉区分

现状：loading / error / not-found / before-open 四种状态共用同一个持续旋转的指示器（`PluginSurfaceMessage` 固定渲染 spinner），失败时看起来像永远在加载。

规格：`PluginSurfaceMessage` 增加按状态分派的图标——loading / before-open 保持旋转指示器；error / surface-not-found 换 lucide `AlertTriangle` 静态图标 + 错误色（`--color-error` 系 token）。**只改视觉状态区分，不动文案内容**（这批文案的 i18n 问题属已跳过的第二包范围，不在本条扩大）。

验收：构造一个加载失败（如卸载插件后打开其 surface 残留入口）→ 看到静态警示图标而非旋转圈，颜色与加载态明显不同。

### A5 Launcher 结果列表入场动效

现状：`@keyframes palette-item-in` 与工具类 `.anim-palette-item`（0.2s，符合动效规范）在 CSS 里已写好，全仓零使用；结果集是硬切换。

规格：

- `LauncherMixedListItem` 应用 `.anim-palette-item`；可加轻微 stagger（每项 delay `index * 12ms`，只对前 8 项，其后为 0）。
- 真机检查连续打字过滤时是否闪烁；若闪烁，降级为仅在「结果集从空到有 / frame 切换」时应用，连续过滤不重放。
- 受 B4 的 `prefers-reduced-motion` 全局规则约束（自动获得，无需单独处理）。

验收：打开 launcher、输入字符，结果条目有轻柔进入感；快速连续输入不闪烁。

### A6 切换语言时的过渡提示

现状：`SettingsContent.tsx:33-36` 选择语言后 `setTimeout(() => window.location.reload(), 100)`，无任何提示的整页硬刷新，观感如崩溃。

规格：点击语言选项后，将设置行（或内容区）就地替换为一行轻提示「正在切换语言…」（以**目标语言**显示，i18n key 双语补齐），延时放宽到约 300ms 再 reload，让提示可被看清。不做复杂动画。

验收：中英互切各一次，能看到提示行，无"白屏闪断"的突兀感。

### A7 Quick Editor 语言标签可发现性

现状：`QuickEditorToolbar.tsx:58-64` 语言标签是带内边距圆角的 span，长得像按钮但无 onClick、无 title、无 hover 反馈；改语言唯一路径是 Cmd+K 搜命令，无任何引导。

规格：

- 加 `title` tooltip：「⌘K 输入「语言」修改 / Press ⌘K and type "language"」（i18n）。
- 点击行为：打开 Quick Editor 命令面板并预填查询词（当前 locale 为中文预填「语言」，英文预填 "language"），复用 `openQuickEditorCommand` 通道，需支持初始 query 参数（如无则加）。
- hover 给轻微底色反馈 + `cursor: pointer`。

验收：hover 语言标签出现 tooltip；点击后命令面板打开且已预填、第一条即 set-language 命令。

---

## 批次 B：视觉契约对齐（4 条）

### B1 设置页图标统一为 lucide

现状：`SettingsContent.tsx` 的 `SettingsListRow` 图标全是拼凑字符（`◐` `⌘` `A` `↵` `#` `⊡` `☾` `↻` 等），同一设置页的插件 Tab（`PluginsContent.tsx`）却用真 lucide 组件，图标语言分裂；DESIGN.md 明确规定 lucide 线性图标。

规格：全部替换为 lucide 组件，`size={14}`、strokeWidth 与 `PluginsContent.tsx` 现用值一致。建议映射（执行者可按语义微调，最终映射列入交付说明供验收）：语言→`Languages`、深色主题→`Moon`、全局快捷键→`Command`、字号→`Type`、自动换行→`WrapText`、行号→`Hash`、版本→`Info`；其余行按语义就近选取。注意：Pinned 两行已在第一包删除，不需处理。`SettingsListRow` 的 `icon` prop 类型从 string 改为 ReactNode。

验收：设置 Tab 与插件 Tab 图标风格一致；无残留字符图标；两主题下图标颜色随 `currentColor` 正常。

### B2 Launcher 选中行收敛为圆角药丸（已拍板）

现状：两套 CSS 打架——`.l-row` 设了圆角（低特异度），`.global-launcher-panel .cmd-item.selected` 用更高特异度设 `border-radius: 0` + 左侧 `inset box-shadow` 强调条，最终渲染为「直角 + 蓝底 + 左条」混合体。

规格：

- 删除 `src/index.css:311-316` 一带 `.cmd-item.selected` 的 `border-radius: 0` 与左条 `box-shadow`。
- 确保选中态实际渲染圆角 `var(--radius-sm)`、背景 `var(--accent-soft)`；hover 态同语言（圆角、更淡的底色）。
- 清理而不是叠加：两套选择器体系里失效/矛盾的规则删除，不留"靠特异度打架"的状态。
- 两主题都验证。DESIGN.md 无需改措辞（"rounded bar" 本来就是既定决议）。

验收：DevTools 选中行 computed `border-radius` ≠ 0；无左侧竖条；light/dark 两主题观感正常。

### B3 light 主题 accent 文档追认（已拍板，只改文档）

现状：DESIGN.md 三处写 `#007ACC`，代码实际 `#2563eb`（有意清理的结果）。

规格：DESIGN.md 中 light accent 的表述更新为 `#2563eb`，注明：2026-07-07 产品拍板追认——实际落地经观感校准，`#007ACC` 在淡 tint 与小控件场景存在感不足；VS Code Light+ 的表面/文字/边框 token 不变。**代码零改动。**

验收：DESIGN.md 内 light accent 无 `#007ACC` 残留表述；与 `src/index.css` 实际值一致。

### B4 全局 prefers-reduced-motion 支持

现状：DESIGN.md 承诺 respects prefers-reduced-motion，`src/index.css`（10 个 `@keyframes`）零落实；唯一处理过的是 translate 插件自己的局部 CSS。

规格：

- `index.css` 顶层加全局规则：`@media (prefers-reduced-motion: reduce)` 下 `animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important;`（含 `::before/::after`）。
- 专项核查两个 infinite 循环动画（`pulse-dot`、`running-pulse`）是否为某状态的唯一指示；若是，在 reduce 下保留静态视觉替代（如实心圆点），不得让状态信息消失。

验收：系统开启"减少动态效果"后，launcher 打开/列表/toast 均无动画但功能与状态指示完整。

---

## 批次 C：键盘与搜索增强（4 条）

### C1 语言选择下拉键盘化

现状：`LocaleSelect` 是纯 `<div onClick>` 手搓下拉，无 tabIndex/role/keydown，键盘完全不可操作——设置页唯一破例控件。

规格：触发器与选项均改为原生 `<button type="button">`（天然获得 Tab 焦点、Enter/Space 触发、focus ring）；展开态支持 ↑↓ 在选项间移动、Enter 确认、Esc 收起并归还焦点给触发器；补 `role="listbox"` / `role="option"` 与 `aria-expanded`。视觉保持现状（复用现有 `sel-ctl` / `settings-select-item` 样式类）。

验收：全程不碰鼠标完成一次语言切换；焦点环可见；VoiceOver 读得出选项。

### C2 Quick Editor 分栏/切焦点直接快捷键

现状：split-right / split-down / focus-next / focus-previous 四个命令只能 Cmd+K 打字搜索；同面板的 Cmd+K、Cmd+W 已示范了 Monaco action 级快捷键机制。

规格：

- 仿照 `QuickEditorPanel.tsx:116-130` 的既有模式注册 Monaco action 快捷键。候选（执行前必须先列出与 Monaco 默认 keybinding 的冲突表再定稿，**明确避开 Cmd+[ / Cmd+]，它们是 Monaco 缩进键**）：右分栏 `Cmd+\`（VS Code 同款）、下分栏 `Cmd+Shift+\`、焦点切换 `Cmd+Alt+←` / `Cmd+Alt+→`。
- 命令面板中对应命令行需展示快捷键提示（如命令列表项右侧 kbd 徽标，与 C4 同一展示语言）。
- surface 形态与 detached 形态都要生效。

验收：Quick Editor 内 `Cmd+\` 出现右分栏，`Cmd+Alt+→` 焦点移动到下一 pane（有可见焦点定义）；与 Monaco 缩进/查找等默认键无冲突。

### C3 搜索结果匹配高亮

现状：`searchRanking.ts` 有六级匹配体系（子串/别名/拼音/混合首字母），渲染层原样输出标题，拼音命中时结果像黑箱。

规格（第一期，克制版）：

- **直接子串命中**：title/subtitle 中连续匹配段用 `font-weight: 600` + accent 色强调（不用 `<mark>` 黄底，不符气质）；需要 ranking 层把匹配区间（start/end）随结果透出，渲染层不重复实现匹配逻辑。
- **拼音/首字母命中**：不做逐字定位，在该行类型标签旁加极简小字标记「拼音」（i18n），说明命中方式。
- 别名命中可与拼音同样处理（标记「别名」）或第一期忽略，执行侧择一并记录。

验收：输入英文子串看到匹配段加粗变色；输入拼音首字母（如 `fzq`）命中行出现「拼音」标记；视觉不喧宾夺主。

### C4 Launcher 行内展示已绑定快捷键

现状：设置页可为插件 surface 绑定全局快捷键（含冲突检测），但 launcher 列表行从不展示已绑定的键，用户配完即忘、要回设置页翻。

规格：

- `LauncherItem` 的 display 结构增加可选 `shortcut` 字段；`buildGlobalLauncherItems` 从 `usePluginSurfaceShortcutStore` 读取已绑定 accelerator 拼入对应条目。
- 行右侧渲染 `<kbd>` 徽标（样式与 footer `LauncherHintKey` 同族：小号、边框、mono 字体），位置在类型标签左侧；未绑定的行不渲染、不占位。
- accelerator 展示格式统一为 mac 符号（⌘⇧V），复用设置页已有的格式化函数（如有）。

验收：给剪贴板历史绑一个快捷键 → launcher 列表该行出现 ⌘ 徽标且与设置页显示一致；解绑后消失。

---

## 建议执行顺序与批次划分

第一包 → 批次 A（依赖 toast 通道）→ 批次 B、C（互不依赖，可并行或先 B 后 C）。每条独立 commit，批次为验收单元。

## 风险提示

- A1 的撤销窗口与 toast 生命周期耦合，注意 toast 被顶掉/手动关闭时的提交时机（关闭即提交删除）。
- A5 动效若与虚拟滚动（`@tanstack/react-virtual`，剪贴板列表在用）叠加需确认不影响滚动性能——本条只作用于 launcher 主列表，不动剪贴板列表。
- C3 需要 ranking 层透出匹配区间，注意不要为此把渲染层与 ranking 内部实现耦合（透出的应是纯数据 start/end，不是匹配器对象）。
- C2 键位若真机发现与用户系统级快捷键冲突（如输入法切换），降级方案为 Cmd+数字聚焦第 N 个 pane，需回报再定。
