# hiven UI/交互现状盘点报告

日期：2026-07-07　分支：`refactor/workbench-window-architecture`

## 总评

整体架构已经按 2026-07-01/07-02 两份设计文档完成了 Quick Editor host-surface 化与 Escape interceptor 协议改造，这两块与文档描述基本一致、实现扎实。但盘点中发现三类严重问题：(1) **Pinned Action / Live Runner 功能在 6-30 重构中被整体拔除，目前完全不可达**（无法 pin、无法查看、无渲染），但数据模型、设置项仍在，属于"看得见摸不着"的死功能；(2) **App 内命令入口没有任何键盘快捷键路径**，唯一入口按钮的 tooltip 承诺的快捷键实际打开的是 Global Launcher 独立窗口而非按钮本身打开的面板，与 AGENTS.md 明确的交互契约矛盾；(3) **i18n 违规大面积存在**，尤其"剪贴板/编辑器选区推荐动作"整条链路（Object Block 推荐卡片）从数据到渲染都是中文硬编码，与 locale 设置无关；插件通用错误态/加载态（`PluginSurfaceRenderer` 等 framework 组件）全部是硬编码英文，这些都是本该体现"系统 i18n 管线"却完全绕过的地方。此外 `GlobalLauncherSystemSurfaceFrame` 里遗留一条不可达的旧 settings/plugins 死分支，`system-settings` 的 `closeOnBlur` 也没有按设计文档配置为 `false`。

---

## 1. 全局 Launcher（GlobalLauncherHost / Panel / Frame）

**现状**：搜索 + 结果列表为主入口；host surface（quick-editor / system-settings / system-plugins）与 plugin surface 原地展开，面包屑返回；Escape 走 window-capture 优先链 + `launcherEscapeInterceptor` 单槽协议；standalone 窗口失焦按 shell 配置决定是否关闭。

问题清单：

- **P0** `system-settings` / `system-plugins` 两个 host surface 没有配置 `closeOnBlur: false`，与设计文档明确要求相悖。`src/components/launcher/hostSurfaceShell.ts:12-14` 的 `HOST_SURFACE_SHELL` 表只登记了 `'quick-editor'`；`src/launcher/hosts/GlobalLauncherHost.tsx:208-214` 读取该表失败后又拿不到 `activeSurfaceFrame`（那个字段只服务 plugin surface，不服务 host surface），最终 `closeOnBlur` 落到 `undefined`，`useCloseStandaloneLauncherOnBlur`（`src/components/launcher/GlobalLauncherWindowLifecycle.ts:34`：`if (closeOnBlurRef.current === false) return`）视为"默认失焦即关闭"。对照设计文档 `doc/2026-07-01-unified-navigation-design.md:64-72`："`closeOnBlur: false`，不因失焦关闭，必须手动关闭或回退"。**用户会怎么遇到**：从托盘唤起 standalone launcher 打开系统设置页，切到另一个 App 或点击桌面，设置页会静默关闭，编辑到一半的设置状态直接消失，且没有任何提示。

- **P0**（详见"横向不一致"第 1 条）：主 Editor 页面顶部 "Run Action" 按钮的 tooltip 承诺的全局快捷键，实际不会打开按钮点击时打开的同一个面板，而是始终弹出 Global Launcher 独立窗口。证据：`src/views/EditorView.tsx:194-202`、`src/hotkeys/globalPinnedLauncher.ts:193-201`。

- **P1** `GlobalLauncherSystemSurfaceFrame.tsx:49-79` 里同时存在两套"设置/插件"渲染分支：`target === 'system-settings' || target === 'system-plugins'` 渲染新的 `SystemSettingsSurface`（含面包屑）；否则 fallback 到 `target === 'settings' ? <SettingsSurface /> : <PluginsSurface />`（`src/surfaces/SettingsSurface.tsx`、`src/surfaces/PluginsSurface.tsx`，懒加载、**不带面包屑头**）。全仓搜索确认 `openLauncherHostSurface('settings')` / `('plugins')` 已无任何调用点（`src/workspace/launcher/hostActions.ts`、`pluginApi.ts`、`surfaces/actions.ts` 全部改用 `'system-settings'`/`'system-plugins'`），这条 fallback 分支及其对应的 `SettingsSurface`/`PluginsSurface`/`SettingsSurfaceContent` 组件已是死代码，属于"移除旧入口"未做干净的技术债，容易在后续维护中被误当作仍然生效的路径修改。

- **P1** Escape 处理存在两套并行实现，且其中一套在标准 Global Launcher 面板里永远执行不到：`src/components/launcher/GlobalLauncherHostLifecycle.ts:182-186` 用 `window.addEventListener('keydown', handleHostEscape, true)`（原生 capture，注册在 window 级别）处理 Escape，逻辑覆盖 surfaceFrame/hostSurfaceTarget/itemPermissionFrame/`controllerRef.back()`/关闭；该 handler 在非 IME、非 interceptor 场景下总是 `preventDefault + stopPropagation`（`:141-142`），事件根本不会传导到 `GlobalLauncherPanel` 自身的 React `onKeyDown`。而 `src/components/launcher/GlobalLauncherKeyboard.ts:78-179` 的 `handleGlobalLauncherKeyDown` 又重复实现了几乎一样的 Escape 分支（surfaceFrame/hostSurfaceTarget/itemPermissionFrame/collect-input/param-input/result），这套逻辑对 `GlobalLauncherPanel` 而言是死代码，只对 `QuickEditorCommandOverlay`（它没有走 window-capture 链）部分生效。两套实现分叉是过去"Quick Editor 内 Cmd+K 导致窗口消失"一类 bug 反复出现的同类型风险（`doc/2026-07-02-quick-editor-host-surface-design.md` 背景所述），建议后续按该文档 Future Work 收敛为单一 interceptor 协议。

- **P2** `SurfaceBreadcrumbHeader.tsx:19,32` 的 `aria-label="Back to hiven"` / `aria-label="Close"` 硬编码英文，未走 i18n（详见 i18n 专节）。

## 2. Quick Editor（surface + detach 独立窗口）

**现状**：默认作为 launcher host surface 原地展开，可 Detach 为独立窗口，同一份 zustand store 换宿主；两段式 Escape 已实现为 `launcherEscapeInterceptor` 协议 + detached 窗口下的 window capture 双路径。

- 与设计文档 `doc/2026-07-02-quick-editor-host-surface-design.md` 对照，核心机制基本落地：`closeOnBlur:false`（`hostSurfaceShell.ts:13`）、`useQuickEditorEscape`（`src/components/quickEditor/useQuickEditorEscape.ts`）两段式提示、命令 overlay 走 `GlobalLauncherFrameSwitch`、IME composition 接线（`QuickEditorCommandOverlay.tsx:175-176`）、i18n 命名空间齐全（`src/i18n/locales/quickEditor.ts` 中英文都补齐）。这部分实现质量较好。

- **P1** `QuickEditorCommandOverlay.tsx:144-149` 的 `onKeyDownCapture`（Escape 专用、总是整体关闭 overlay）与同一元素上 `onKeyDown={(event) => handleGlobalLauncherKeyDown(...)}`（`:150-174`，其中对 collect-input/param-input/result 帧的 Escape 语义是"先退一层"）叠加：React 在同一 DOM 节点上，capture 阶段调用 `stopPropagation()` 会阻止同节点的 bubble 阶段处理器继续执行（DOM AT_TARGET 阶段按注册顺序中止），因此 Quick Editor 命令面板处于嵌套帧（比如正在参数输入/结果选择）时按 Escape 会**直接整体关闭命令面板**，而不是像 Global Launcher 主搜索里那样先退一级。这与 Global Launcher 自身"先退一级再退出"的既定语义不一致（详见"横向不一致"第 2 条）。

- **P2** `QuickEditorPaneSurface`（`src/components/quickEditor/QuickEditorPanel.tsx:117,125`）里 Monaco action 的 `label: 'Quick Editor Command'` / `label: 'Close Quick Editor Pane'` 硬编码英文——这两个 action 会出现在 Monaco 自身的命令面板（F1/Cmd+Shift+P）里，未走 i18n。

## 3. 系统设置页（设置 + 插件管理合并页）

**现状**：`SystemSettingsSurface.tsx` 左侧 Tab（设置/插件管理）+ 右侧内容区，容器整合、内容不变，符合 `doc/2026-07-01-unified-navigation-design.md` 的"合并不改内容"原则；`SurfaceBreadcrumbHeader` 提供 `← hiven / 系统设置 / ×`。

- 滚动问题在此次核实中**未复现**：`.sscroll`（`src/index.css:5280-5285`，`overflow-y: auto`）用于设置 Tab；插件 Tab 内层 `.a-list.plugin-master-list` 也显式 `overflow-y: auto`（`src/index.css:5103-5109`），说明文档提到的"滚动修复"这项已经生效，不构成当前问题。

- **P0**（与"1. 全局 Launcher"重复计入一次）：`closeOnBlur` 未配置为 `false`，standalone launcher 窗口下失焦即关闭系统设置页，见上文详述。

- **P2** `SystemSettingsSurface.tsx:16` 的 tab 定义里图标用 lucide 组件是好的，但 `src/surfaces/SettingsContent.tsx:26` 里 `<SettingsListRow icon="文" ...>` 把中文字符"文"当图标字形使用，无论当前 locale 是中文还是英文都会显示这个汉字，属于把中文写死进最终 UI（即使其它行都用了 `⌘`/`A`/`↵`/`#` 等语言无关符号，这一处是例外）。

## 4. Pinned Runner / pinned actions

**现状一句话**：这是本次盘点里最严重的发现——**Pinned Action / Live Runner 功能目前对用户完全不可达**，但底层数据结构、持久化、设置项仍然存在，是一次未清理干净的功能回归。

- **P0** 无任何入口可以创建 pin。`pinPluginCommand`（`src/store.ts:172,277-294`）在全仓范围内只有类型声明和自身实现，没有任何调用点（已用 `grep -rn "pinPluginCommand"` 核实）。

- **P0** 即使 store 里存在历史遗留的 `pinnedActions` 数据（比如老版本 persist 下来的），Launcher 列表构建函数也会直接丢弃它们：`src/components/launcher/GlobalLauncherItems.ts:9-27` 的 `buildGlobalLauncherItems` 对入参 `pinnedActions` 直接 `void pinnedActions`（第 24 行），只返回 `domainItems`，永远不会产出 `kind: 'pinned'` 的条目。`git log -p` 显示这是 `a80ca72`（"refactor: workbench 窗口架构重构 - 插件 surface 模式迁移"，6-30）里主动删掉的：此前版本（`44f0b7e`）有完整的 `buildPinnedItems`（排序、可搜索、渲染），refactor 时被替换为 `void pinnedActions` 且没有后续补回。

- **P0** 即使强行调用 `openPinnedAction(pinnedId)`（`src/store.ts:335-337`），也没有任何组件读取其写入的 `activePinnedActionId` 来渲染 Live Runner 界面——全仓搜索 `activePinnedActionId` 只在 `store.ts` 内部出现，没有第二处消费者。`doc/pinned-action-live-runner.md` 里设计的 `PinnedRunnerView`（输入/输出双栏、Auto Run、Controls Panel 等）在当前代码里没有对应实现文件。

- 由此产生的下游死代码：`src/components/launcher/GlobalLauncherClose.ts:42-84`（`finishPinnedLauncherSelection`）、`src/components/launcher/useGlobalLauncherSelectionController.ts:73-82`（`item.kind === 'pinned'` 分支）、`LauncherMixedList.tsx:9,121`（`kind: 'pinned'` 类型与文案）、`src/workspace/pinnedActionRuntime.ts`、`pinnedActionFactory.ts`、`pinnedActionIdentity.ts`、`pinnedPluginCommandRunner.ts` 整批文件都已经没有可达路径能被触发。

- **P1** 佐证问题的放大器：`src/surfaces/SettingsContent.tsx:79-84` 的设置页里仍然保留着 "记住 Pinned 输入内容"（`persistPinnedInput`）、"保留 Pinned Tombstone"（`persistPinnedTombstone`）两个可勾选开关，控制着一个用户根本无法创建实例的功能——用户会看到"这是什么？"式的困惑设置项。

## 5. 剪贴板历史（clipboard-history surface + Object Block）

**现状**：`clipboard-history` 插件以 `rendersTitlebar: true`、`closeOnBlur: true` opt-out 自定义头部（自带 back/search/settings/close），`src/plugins/clipboard-history/index.tsx:158-166`；Surface 本身实现质量高，i18n 走 `t()` 全覆盖（`ClipboardHistorySurface.tsx` 检查未发现硬编码文案）。

- **P0**（i18n，详见"i18n/文案"专节第 1 条）：作为剪贴板历史入口之一的 "Object Block"（launcher 输入框里代表剪贴板/选区内容的 token）及其推荐动作列表，从数据模型到渲染整条链路都是中文硬编码，与 `settings.locale` 完全无关。这不是 clipboard-history 插件自身的问题（它是 framework/launcher 层的 `src/launcher/clipboard/*` 与 `src/components/launcher/ObjectBlockToken.tsx`、`RecentClipboardHint.tsx`、`RecommendedActionRow.tsx`、`OutputTargetExpansion.tsx`），但用户在 Global Launcher 和 App 内命令入口触碰剪贴板内容时都会看到。

- **P2** `ObjectBlockToken.tsx:58` 的 `aria-label="Remove object block"` 硬编码英文。

## 6. 插件 surface 通用 shell（标题栏、opt-out、closeOnBlur）

**现状**：`PluginSurfaceRenderer.tsx` 是三种呈现形态（`global-launcher` / `plugin-surface-window` / `editor-panel`）共用的核心渲染器，负责运行时加载、权限门、错误边界；`rendersTitlebar` opt-out 通过 `surface.shell.rendersTitlebar` 声明，Global Launcher 侧读取后决定是否套 `SurfaceBreadcrumbHeader`（`GlobalLauncherPluginSurfaceFrame.tsx:23,31-37`），standalone 窗口侧同样读取（`PluginSurfaceWindow.tsx:18,80-85`）——两处判断逻辑一致，这块设计良好。

- **P0**（i18n，详见"i18n/文案"专节第 2 条）：`PluginSurfaceRenderer.tsx` 里所有通用状态文案（加载中/未找到/打开中/失败/权限网关之外的兜底文案）全部硬编码英文，尽管组件本身持有 `locale` 参数。这些文案会出现在**所有**插件 surface 的加载/错误路径上（Global Launcher、独立窗口、editor-panel 三种呈现形态全部受影响）。

- **P1** `PluginSurfaceWindow.tsx:54-67` 的独立插件 surface 窗口 Escape 处理没有 IME 检查（对比 Global Launcher 侧所有 Escape 处理都先过 `shouldIgnoreImeKeyDown`/`isImeComposingRef`），是本次盘点里发现的唯一一处"裸" Escape 监听：`window.addEventListener('keydown', onKeyDown, true)` + `document.addEventListener(...)` 双重绑定，直接 `hideCurrentWindow`，不检查任何 IME 组合状态。

- **P2** `PluginSurfacePanel.tsx:22`（editor-panel 呈现下）"Plugin surface target missing" 硬编码英文；`PluginSettingsDialog.tsx:139` "No settings available for this plugin." 硬编码英文。

---

## 横向不一致

1. **同一个"Run Action"承诺的快捷键，键盘触发和鼠标点击走向两个完全不同的界面**。`src/views/EditorView.tsx:194-202`：按钮 `onClick` 调用 `setEditorCommandBarOpen(true)`（打开 App 内命令入口面板），按钮 `title` 却显示 `t('runActionWithShortcut', { shortcut: runActionShortcut })`，其中 `runActionShortcut` 来自全局 `globalPinnedLauncherShortcut`（`EditorView.tsx:60`）。而该全局快捷键真正的路由函数 `routeGlobalPinnedLauncherShortcut()`（`src/hotkeys/globalPinnedLauncher.ts:193-201`）只在 Quick Editor host surface 处于激活态时才特殊处理，**其余一切情况（包括主 Editor 窗口正处于前台）一律 `showLauncherWindow()`**，即弹出独立 Global Launcher 窗口；Rust 侧 `show_launcher_window_for_hotkey`（`src-tauri/src/lib.rs:541-579`）同样不检查任何"编辑器是否前台"的条件。用户在主编辑器里按下 tooltip 告知的快捷键，看到的不是按钮点击后出现的那个面板，而是一个完全不同的独立窗口。这与 `AGENTS.md`"App 编辑器页面在前台时快捷键唤起端内命令入口，否则唤起 Global Launcher"的规则直接矛盾，也没有全仓范围内任何其它路径把 `editorCommandBarOpen` 和键盘事件关联起来（已用 `grep -rn "editorCommandBarOpen"`/`setEditorCommandBarOpen`/Cmd+K 相关关键字核实，唯一写入点就是这一次 `onClick`）。

2. **Escape 的"先退一级再整体退出"语义在不同宿主下不统一**：Global Launcher 主体（含 collect-input/param-input/result 帧）走 window-capture 的 `useGlobalLauncherHostEscape`，逐级退出（surface → host surface → permission → controller back → 关闭）；Quick Editor Command Overlay 用自己的 capture 处理器把 Escape 直接映射为整体关闭（不退到上一级帧，详见"2. Quick Editor"P1 条）；Editor Command Bar（`EditorCommandBarHost.tsx:159-173`）在 `inControllerFrame` 为真时直接把按键处理权移交给各个 frame 子组件自己的 `onKeyDown`（`LauncherCollectInputStep.tsx:78-92`、`LauncherParamStep.tsx:185-213`、`LauncherResultStep.tsx:66`），是第三种架构（局部委托 vs. 集中处理）。三处虽然大体都能"退出"，但退出的层级颗粒度、集中/分散的实现方式均不同，属于同类交互在不同 surface 里分别手搓的结果。

3. **失焦关闭策略缺少统一默认值**：`clipboard-history` 显式声明 `closeOnBlur: true`；`quick-editor` 显式声明 `closeOnBlur: false`；`system-settings`/`system-plugins` 未声明、隐式落到"关闭"（见上文 P0）。设计文档里"系统提供默认头部栏，插件可 opt-out"暗示的是一个明确的默认值，但当前实现里"未声明"和"显式声明 true"效果相同，容易在新增 host surface 时被遗忘。

4. **App 内命令入口（Editor Command Bar）的 placeholder 硬编码中文，Global Launcher 对应位置走 i18n**：`GlobalLauncherSearchFrame` 的搜索框走 `t(locale, 'palette.globalPlaceholder')`（`GlobalLauncherHost.tsx:389`），而 `EditorCommandBarHost.tsx:272` 的 recommended-actions 输入框写死 `placeholder="输入动作或搜索…"`，同一产品概念（launcher 输入框占位符）在两个宿主下一个走多语言、一个硬编码。

---

## i18n / 文案专项

### 1. Object Block / 推荐动作链路——整条功能中文硬编码，与 locale 无关（最严重）

这条链路服务于 Global Launcher 与 Editor Command Bar 两个入口的"剪贴板/选区快速动作"功能，从数据到渲染全部忽略 `locale`：

- `src/launcher/clipboard/actionRecommendation.ts:29-31` 每个 action 同时定义 `title`（英文）与 `titleZh`（中文），但渲染层只用 `titleZh`：
  - `src/components/launcher/RecommendedActionRow.tsx:36` `<span className="action-title">{action.titleZh}</span>`，从不读取 `action.title`，组件也不接收 `locale` props。
  - `src/components/launcher/OutputTargetExpansion.tsx:32` 同样 `{action.titleZh}`。
- `src/components/launcher/RecommendedActionRow.tsx:39` `来自 {provider}` 硬编码"来自"；`:41` `Tab 输出` 硬编码。
- `src/components/launcher/OutputTargetExpansion.tsx:44` `默认` 硬编码；`:49` `↵ 确认 · esc 返回` 硬编码。
- `src/launcher/clipboard/actionExecutor.ts:263` `getOutputTargetLabel(target, locale: 'en' | 'zh' = 'zh')`——默认值是中文，且两个调用点（`RecommendedActionRow.tsx:26`、`OutputTargetExpansion.tsx:43`）都没有传入真实 `locale`，永远吃默认值。
- `src/components/launcher/ObjectBlockToken.tsx:41` `内容已隐藏`、`:52` `再按 Backspace 删除` 硬编码中文；`:58` `aria-label="Remove object block"` 硬编码英文。
- `src/components/launcher/RecentClipboardHint.tsx:41` `` `${hint.ageLabel}复制 · ${kindLabel}` `` 硬编码"复制"。
- `src/launcher/clipboard/objectBlock.ts:198` `` `${getKindLabel(kind)} · ${params.lineCount} 行` ``、`:216` `` `${getKindLabel(kind)} · ${params.charCount} 字` `` 硬编码"行"/"字"单位。

**影响**：英文 locale 用户在 Global Launcher 粘贴/选中文本触发推荐动作时，看到的整块 UI（标题、来源、快捷提示、底部 hint）都是中文，是当前代码库里最集中、最系统性的 i18n 违规区域。

### 2. Framework 级插件 surface 通用状态文案——硬编码英文

`src/components/pluginSurface/PluginSurfaceRenderer.tsx` 是 Global Launcher / 独立插件窗口 / editor-panel 三种呈现形态共用的核心组件，其通用状态文案完全绕开 i18n：

- `:128` `"Loading plugin surface..."`
- `:131` `surfaceState.title`，其中 `:115` 赋值为 `'Plugin surface failed to open'`
- `:134` `"Plugin surface not found"`
- `:137` `"Opening plugin surface..."`
- `:270` `"Plugin surface crashed"`（`PluginSurfaceErrorBoundary`，甚至不接收 `locale` prop）
- `:272` 按钮文案 `"Back"`

以及相关联的：

- `src/components/pluginSurface/PluginSurfacePanel.tsx:22` `"Plugin surface target missing"`
- `src/components/PluginSurfaceWindow.tsx:74` `"Invalid plugin surface target"`；`:82` fallback 标题 `'Plugin Surface'`
- `src/components/PluginSettingsDialog.tsx:139` `"No settings available for this plugin."`

### 3. 其它零散硬编码

- `src/launcher/hosts/EditorCommandBarHost.tsx:272` `placeholder="输入动作或搜索…"` 硬编码中文（对照 Global Launcher 同类位置走 i18n，见"横向不一致"第 4 条）。
- `src/components/ShortcutRecorder.tsx:121` `title="点击录入快捷键"` 硬编码中文，用于设置页全局快捷键录入控件，英文 locale 下也会看到中文 tooltip。
- `src/components/SurfaceBreadcrumbHeader.tsx:19` `aria-label="Back to hiven"`、`:32` `aria-label="Close"` 硬编码英文。
- `src/surfaces/SettingsContent.tsx:26` `icon="文"` 用中文字符作图标字形，与同文件其它行使用的语言无关符号（`⌘`/`A`/`↵`/`#`/`⊡`）不一致。

---

## 设计文档承诺但未落实的交互

- `doc/2026-07-02-quick-editor-host-surface-design.md` "Future Work"：**Escape 链迁移（TODO）**——settings / plugin surface / permission 各页面的 Escape 处理逐个迁移到 `launcherEscapeInterceptor` 协议，host 默认链最终瘦身为「IME 检查 → interceptor → controller.back → 关窗」。当前 `src/components/launcher/GlobalLauncherHostLifecycle.ts:127-130` 留有对应 TODO 注释，尚未推进；这与本报告"横向不一致"第 2 条、"1. 全局 Launcher"P1 条描述的重复 Escape 实现是同一处技术债。
- `doc/2026-06-15-app-launcher-design.md` 描述的 `app-launcher` first-party 插件（本机应用启动器）目前尚未实现：`src/plugins/app-launcher/` 目录不存在，属于设计已确认但代码未开工，不是回归，仅供归档参考。
- `doc/pinned-action-live-runner.md` 全篇描述的 Pinned Action / Live Runner（sidebar 常驻入口、双栏 Runner、Controls Panel、Tombstone 恢复等）目前是"曾经实现、后被移除"的状态，详见"4. Pinned Runner / pinned actions"一节；该文档已经与当前"tray + Launcher"架构的信息架构（无 sidebar 概念）产生冲突，若要恢复此功能需要先重新设计入口位置，而不是简单地把 `buildGlobalLauncherItems` 里的 `void pinnedActions` 改回去。

## TODO / FIXME / HACK

全仓搜索（排除测试文件）UI/交互相关的仅一处：`src/components/launcher/GlobalLauncherHostLifecycle.ts:127` `// TODO(escape-migration): migrate the settings / plugin surface / host ...`，对应上文"设计文档承诺但未落实"第一条。未发现其它与本次审查范围相关的 FIXME/HACK 注释。
