# hiven `refactor/workbench-window-architecture` 架构审查报告

审查时间：2026-07-07　分支相对 `main` 领先 **281 commits**（2026-06-27 ～ 2026-07-07，约 10 天）。

## 总评（确认的事实为主）

1. **Quick Editor host-surface 化本身完成度很高**：`doc/2026-07-02-quick-editor-host-surface-design.md` 列出的 8 项"特判清理清单"逐条核对，**全部落实**，且 Future Work（Escape 链迁移）按设计明确留了 `TODO(escape-migration)` 注释，未假装完成。这部分是本次审查里质量最好的一块。
2. **但窗口架构的另一半改动——"退休主 editor 窗口"——制造了一个未被任何文档记录的连锁破坏**：`useWorkspaceStore`/`effectRunner`/`panelRegistry`/`PresentationHost`/`DiffPageView` 等一整套"多 Pane 工作区"实现，连同 `EditorView.tsx`/`WorkspaceShell.tsx`/`EditorWindow.tsx`，在 97b1e50（"retire standalone editor window entry"）之后已经**从任何可达入口彻底断开**，`npm run build` 产物里也没有它们的 chunk。Text Diff 插件的核心路径（`openDiffPage`）因此静默失效（细节见下）。这是本次最重要的发现。
3. **`npm run check:architecture` 当前处于失败状态**（3 条 CSS/HTML 模板字符串违规），且至少 2 条（`web-open`、`csv`）可证实是本分支新引入/新触发的，不是历史遗留可以豁免的问题。AGENTS.md 明确把这个命令列为"验证要求"的第一条。
4. **DESIGN.md / PRODUCT.md 描述的形态（主工作台 + 侧边栏 + 多 pane）与当前代码已经不是"文档滞后"级别的脱节，而是文档描述的 UI 树在生产构建里已经是死代码**——不是没写完，是写好过、现在够不到了。
5. 插件边界（plugin ↔ host 深层 import、跨插件 import、kit 依赖方向）本身的自动化守卫较完备，抽查未发现绕过（tsconfig path alias 没有被用来绕过 host 深路径检测）。
6. 项目自带的"契约测试"（`scripts/test-*.mjs`）绝大多数是**正则匹配源文件文本**，不是运行时行为测试；这类测试结构性地看不见"文件还在、但已经无法从任何入口到达"这种退化，因此第 2 条的回归全部测试绿灯通过。

---

## 一、重构完成度对照表

### 1.1 Quick Editor host-surface 特判清理清单（对照设计文档第 6 节）

| # | 设计要求 | 现状 | 结论 |
|---|---|---|---|
| 1 | `GlobalLauncherHost.tsx` 删除 quick-editor 渲染分支，走 host surface 通道 | `src/launcher/hosts/GlobalLauncherHost.tsx` 全文搜索不到任何 quick-editor 专属渲染分支，统一走 `GlobalLauncherPanel`/`GlobalLauncherSystemSurfaceFrame` | 已完成 |
| 2 | closeOnBlur 三元特判 → 读 shell 配置表 | `GlobalLauncherHost.tsx:211-212`：`getHostSurfaceShell(launcherHostSurfaceTarget)?.closeOnBlur ?? activeSurfaceFrame?.surface.shell?.closeOnBlur`，配置表在 `src/components/launcher/hostSurfaceShell.ts:13`（`'quick-editor': { closeOnBlur: false }`） | 已完成 |
| 3 | 输入源 effect 的 mode 特判删除 | `GlobalLauncherHost.tsx:97-107` 的 `prepareLauncherInputSource`/`restoreLauncherInputSource` effect 现在只依赖 `open`，无 mode 分支 | 已完成 |
| 4 | `GlobalLauncherGeometry.ts` 删除 mode 尺寸特判，用统一 host surface 尺寸 | `src/components/launcher/GlobalLauncherGeometry.ts:42-70` 统一用 `hostSurfaceTarget` 判断走 `STANDALONE_SURFACE_MAX_WIDTH/HEIGHT`，未见 per-mode 分支 | 已完成 |
| 5 | `GlobalLauncherHostLifecycle.ts` Escape mode 特判删除，接入 interceptor 协议 | `src/components/launcher/GlobalLauncherHostLifecycle.ts:127-131` 先调 `runLauncherEscapeInterceptor(event)`，并留有 `// TODO(escape-migration): ...` 注释，与设计文档 Future Work 完全对应 | 已完成（含诚实的未完成标注） |
| 6 | `globalPinnedLauncher.ts` 的 3 处 mode 判断改为 hostSurfaceTarget | `src/hotkeys/globalPinnedLauncher.ts:27,28,92,195` 均已改为 `state.launcherHostSurfaceTarget === 'quick-editor'` | 已完成 |
| 7 | `store.ts` 删除 `globalLauncherMode` 全套（含 full/pinned-only） | 全仓库 `grep -rn "globalLauncherMode\|GlobalLauncherMode"` 零命中；`openGlobalLauncherOverlay()`/`setGlobalLauncherOpen(open)` 均已去掉 mode 参数 | 已完成 |
| 8 | `GlobalLauncherKeyboard.ts` hostSurfaceTarget 分支在 interceptor 激活时让位 | `src/components/launcher/GlobalLauncherKeyboard.ts:87-97`：`if (event.key === 'Escape' && !hasLauncherEscapeInterceptor())` | 已完成 |

`openQuickEditor`/`closeQuickEditor`/`toggleQuickEditor` 也已从 store 中整体删除（全仓库零命中）。两段式 Escape（`src/components/quickEditor/useQuickEditorEscape.ts`）、Detach 到独立窗口（`QuickEditorDetachedView.tsx` 含 try/catch + console.warn 错误处理、关闭按钮）均按设计文档第 3/5/7 节实现，细节吻合。

**Future Work（Escape 链迁移）现状**：确认仍是 TODO，只接入了 Quick Editor 一个页面，settings / plugin surface / permission 仍走旧的 if/else 链（`GlobalLauncherHostLifecycle.ts:133-165`）。这是文档承认的技术债，不算本次审查的新发现，但目前也没有排期痕迹（无对应 issue/TODO 文件）。

### 1.2 未被任何文档提及的连锁回归：主 editor 窗口退休后 Diff 能力失效

这是本次审查发现的**最重要问题**，链路如下（每一跳都有代码证据）：

1. `97b1e50`（"fix: retire standalone editor window entry"）从 `src-tauri/src/lib.rs` 删除了 91 行原生"editor"窗口创建代码，`src/main.tsx` 的 `loadRootComponent()` 现在只识别 `'launcher' | 'plugin-surface' | 'quick-editor'` 三种 `?window=` 取值（`src/main.tsx:9,37-42`），不再有任何路径会把 `?window=editor` 传给任何窗口。
2. `src/workspace/launcher/pluginApi.ts:79-83` 的 `isEditorWindowRuntime()` 判定逻辑是 `new URLSearchParams(window.location.search).get('window') === 'editor'`——**由于第 1 步，这个函数现在在任何窗口里都恒为 `false`**，包括 Global Launcher 和 detached Quick Editor 窗口。
3. `createPluginLauncherApi()` 里几乎所有方法（`replaceActiveText`/`insertText`/`getPaneSnapshot`/`dispatchEffects`/`openDiffPage` 等，`pluginApi.ts:113-274`）都以 `isEditorWindowRuntime()` 分流：true 分支操作 `useWorkspaceStore`（多 pane 工作区），false 分支退化为走 Quick Editor / 快照。**true 分支现在是死代码，但 false 分支并不总能等价替代**——`openDiffPage` 的 false 分支是：
   ```ts
   openDiffPage: (payload) => {
     if (isEditorWindowRuntime()) {
       useWorkspaceStore.getState().openDiffPage(payload)
     } else {
       void showQuickEditorSurface()   // payload 被直接丢弃
     }
   },
   ```
   （`src/workspace/launcher/pluginApi.ts:268-274`）
4. `src/plugins/textDiff/index.tsx:93-96`（"text-diff.compare" 命令）调用顺序是 `await ctx.api.showEditorWindow()` 然后 `ctx.api.openDiffPage({ original, modified })`。`showEditorWindow` 现在只是打开 Quick Editor host surface（`openEditorWindow()` → `showQuickEditorSurface()`，`pluginApi.ts:113-119`），Quick Editor 里**没有任何代码消费 `openDiffPage` 的 payload**（Quick Editor 用的是完全独立的 `useQuickEditorStore`，不是 `useWorkspaceStore`）。
5. 真正渲染 Diff 的 `DiffPageView`（`src/plugins/textDiff/DiffPageView.tsx`）只在 `src/views/EditorView.tsx:4,34` 被引用；`EditorView.tsx` 只被 `src/components/EditorWindow.tsx:22` 引用；而 `EditorWindow.tsx` 在全仓库搜索**没有任何导入者**（`grep -rn "components/EditorWindow" src` 零命中）。也就是说 `EditorView`/`WorkspaceShell`/`PanelHost`/`PanelHostV2`/`PresentationHost`/`effectRunner`/`surfaceCoordinator`/`RegexTesterPanel`/`DualEditorView`（经由 DiffPageView）这整棵树**在当前代码里是孤儿**，`npm run build` 产物 `dist/assets/` 里也确认搜不到这些模块对应的 chunk（tree-shaking 直接把它们排除在外，因为没有任何 import 边到达它们）。

**结果**：用户在 Global Launcher 执行"Text Diff / Compare"命令、选好两个源、点确认后，代码会打开 Quick Editor 窗口，但窗口里什么也不会发生——没有报错、没有降级提示，Diff 内容被静默丢弃。这不是"功能未做"，是"功能曾经能跑（`56e9519 fix(text-diff): support global launcher by adding clipboard+empty sources and showing editor window` 等历史提交专门为此适配过），后来被同分支的窗口退休提交在没有回归测试兜底的情况下打断"。

**测试为什么没拦住**：`scripts/test-window-architecture-phases.mjs:135-149` 现在仍然对 `isEditorWindowRuntime()`、`effectRunner`、`workspaceStore` 的字符串模式做断言（例如第 135 行要求 `pluginCommandExecutor` 包含 `if (!isEditorWindowRuntime())...`），这些断言是"文件里有没有这行代码"的静态正则匹配，不是"这条代码路径是否还能被执行到"。本机验证：
```
node scripts/test-window-architecture-phases.mjs   → window architecture phase checks passed
node scripts/test-editor-window-launch.mjs         → editor window launch checks passed
node scripts/test-quick-editor-host-surface.mjs    → all assertions passed
node scripts/test-no-main-window-startup.mjs       → no main window startup checks passed
node scripts/test-desktop-tray-startup.mjs         → desktop tray startup checks passed
```
全部绿灯，但绿灯只证明"字符串还在"，不证明"能被用到"。这是这套契约测试体系的结构性盲区，建议作为方法论风险单独记录（见"风险与建议"）。

### 1.3 其它残留特判 / dead code 扫描结果

- `globalLauncherMode`、`openQuickEditor`/`closeQuickEditor`/`toggleQuickEditor`：零残留（见 1.1）。
- `src/workspace/editorWindow.ts` 的 `requestOpenEditorWindow`/`requestFocusEditorWindow` 等函数**没有被删除，而是被改写为转发到 `showQuickEditorWindow()`**，是有意的兼容层，不是遗留特判；Rust 侧 `validate_surface_instance_kind` 仍接受 `"editor"` 这个 kind（`src-tauri/src/lib.rs:123`）也是为了配合这层转发（`kind: 'editor'` 现在语义上指向 Quick Editor 窗口），非死代码。
- `EditorWindow.tsx`（308 行）/`EditorView.tsx`（241 行）/`WorkspaceShell.tsx`（134 行）三个文件（共 683 行，是"死代码"链路的入口三件套）本身仍留在仓库里未删除，且它们各自最后一次被有意义修改是在 2026-07-02（"redesign as fullscreen page"等），也就是"退休标准 editor 窗口"提交（07-06）发生前 4 天——说明退休提交是在这些文件还在被积极维护的状态下，直接切断了它们的唯一入口，但没有回头清理或迁移这些文件本身。

---

## 二、架构守卫现状

`scripts/check-architecture.mjs`（284 行）覆盖的规则：

- **禁止路径存在**：`src/workspace/jsonDiff.ts`、`lineDiff.ts`、`CoreJsonDiffRenderer.tsx`、`DualEditorView.tsx`（这几个文件本身不允许出现在指定位置，逼迫 diff 语义留在插件里）。
- **禁止关键词出现在 `src/workspace`**：`jsonDiff`/`lineDiff`/`semanticDiff`/`CompareRenderer`/`DiffSurface`/`registerCompareRenderer`/`monaco.diff`/`DiffEditor` 等——落实 AGENTS.md"workspace 不含 diff 语义"的规则。
- **禁止旧命名残留在全部 `src`**：`core.diff`/`core.json-diff`/`jd-` 前缀。
- **kit 不依赖 workspace/plugins**（`src/kits` import 检查）、**workspace 不依赖 plugins**（`src/workspace` import 检查）——对应 AGENTS.md 的依赖方向表。
- **插件互相不 import**（`checkPluginCrossImports`）、**插件不直接 import host 深层路径**（`components/store/workspace/i18n/kits`，`checkPluginHostDeepImports`）、**插件不直接 import `@tauri-apps/*`**——这三条是当前对"插件走 host API/SDK，不允许跨目录 import host 内部实现"这条规则最直接的自动化落地，且本次审查抽查未发现绕过（`tsconfig.app.json` 的 path alias 只映射到 `@hiven/plugin`/`@hiven/plugin-ui` 这两个公开 SDK 入口，没有别名可以绕开深路径正则）。
- **插件 index 文件边界**（`checkPluginIndexBoundaries`）：声明了 `ui`/`background`/`settings` 复杂 surface 的插件，index 文件里 JSX return 块不能超过 2 个，也不能塞 240 字符以上的模板字符串（防止插件把整块 UI/HTML 写进本该只做"组装 contribution"的入口文件）。
- **插件 CSS 边界**：不能选中 host 私有类名（`.global-*`/`.command-palette-*`/`.workspace-*`），不能覆盖全局元素选择器（`body`/`button`/`input` 等）。
- **clipboard-history 专项**：不许 import `@tauri-apps/*`、不许 import host 深层路径、必须有 `surfaces/settings/background/storage` 四个目录——这是针对某个具体插件的加强约束，说明历史上出过问题后专门补的护栏。

**运行结果（本次审查实测，只读）**：

```
$ npm run check:architecture
Architecture boundary check failed:
- plugin index must not contain large CSS/HTML template strings: src/plugins/csv/index.ts
- plugin index must not contain large CSS/HTML template strings: src/plugins/json-tools/index.ts
- plugin index must not contain large CSS/HTML template strings: src/plugins/web-open/index.tsx
```

**当前处于失败状态**，与 AGENTS.md/CLAUDE.md 明确要求的"改动后至少执行 `npm run check:architecture`"矛盾。逐个核实是否为历史遗留：

- `src/plugins/web-open/index.tsx`：对比 `main` 分支同文件，main 版本（8506 字符）**不触发**该规则；当前分支版本（11025 字符，来自 `2b62459 feat: web-open 支持正则匹配直开 + URL 一步打开 + favicon 缓存`）新增了一个 240+ 字符的模板字符串 → **本分支新引入的违规**。
- `src/plugins/csv/index.ts`：main 版本已经有长模板字符串，但当时 `declaresComplexPluginSurface`（是否含 `ui:`/`background:`/`settings:` 声明）为 false，所以规则不触发；当前分支版本新增了复杂 surface 声明，与既有的长模板字符串叠加后才触发 → **本分支使潜伏问题变为真实违规**。
- `src/plugins/json-tools/index.ts`：main 分支上这个路径不存在（是从旧的 `src/plugins/json/index.ts` 迁移改名而来，属于本分支范围内的产物）。

结论：这 3 条不是"历史包袱、可以豁免"，而是本分支范围内引入或激活的、需要在合并前处理的真实红线违规。另外，脚本里能看到 main 分支曾经存在的 `legacyAllowList = new Set(['jsFilter', 'regex-tester'])` 在本分支被清空为 `new Set()`——说明本分支同时也在收紧历史豁免，方向是对的，只是新代码又踩进了另一条规则。

**该守卫脚本明显没覆盖、但按本次审查发现应该覆盖的边界**：

1. **可达性/死代码检测**：脚本只做文本模式匹配和 import 方向检查，完全无法发现"文件存在、语法正确、但从任何入口都无法到达"这类退化（第一部分 1.2 的整条死链路）。这类问题只能靠构建产物分析或显式的模块图工具发现，建议至少加一个轻量的"入口可达性"检查（例如从 `main.tsx` 的已知入口出发做一次 import 图遍历，标记出 `src/` 下未被覆盖到的 `.tsx`/`.ts` 文件，人工复核）。
2. **`isEditorWindowRuntime()` 之类"看起来是运行时分支、实际上恒定值"的死分支**：没有工具能自动发现，但可以考虑加一条 lint 规则或注释约定，要求这类"环境探测函数"在其所依赖的环境标记（这里是 `?window=editor`）被移除时同步报警。
3. Rust 侧（`src-tauri/src/lib.rs`）完全没有对应的架构守卫——例如"不应该有硬编码中文/英文 UI 文案"这条规则（AGENTS.md 明确写了"禁止在插件或 framework 中直接写死中文/英文作为最终 UI 文案"）在 TS 侧靠 i18n 管线约束，但 `desktop_tray_text()`（`src-tauri/src/lib.rs:4211-4225`）直接硬编码了"打开 Hiven"/"退出 Hiven"/"Open Hiven"/"Quit Hiven"四个字符串，靠读系统 `LC_ALL`/`LANG` 环境变量判断中英文，而不是走应用内 i18n/locale 设置。这条目前甚至被 `scripts/test-desktop-tray-startup.mjs` 显式断言"必须提供中英文"（等于把硬编码写进了契约测试）。技术上原生托盘菜单确实很难在 webview 尚未加载时读到应用内 locale 设置，这是可以理解的例外，但与仓库规则字面冲突，建议至少在 AGENTS.md 里显式记一条"原生托盘菜单文案例外"，否则容易被后来者当成反面教材抄进其它原生代码里。

---

## 三、边界违规抽查

- **plugin → host 深层 import**：抽查未发现绕过 `checkPluginHostDeepImports` 的手法（没有用 path alias、没有用动态 `import()` 拼接字符串路径绕开静态正则）。这条边界目前守得住。
- **framework 混入产品语义**：`checkForbiddenSourceTerms('src/workspace', [...])` 覆盖了 diff/JSON 相关关键词，抽查 `src/workspace/*.ts` 未发现新的 diff/JSON 语义泄漏（`workspaceStore.ts` 里的 `openDiffPage` 方法名本身踩在语义边界上，但看当前实现只是把 payload 转给注册的 renderer/effect，不包含具体 diff 算法，且这部分现在是死代码，不构成活跃的边界违规）。
- **kit 依赖方向**：`src/kits/ui/DualEditorView.tsx` 是 diff 渲染用的纯 kit 组件，检查其 import 未依赖 workspace/plugins，符合"kit 不进 workspace/plugins"的规则；但如 1.2 所述，它现在只被死代码路径引用，实际上也是孤儿。
- **多语言硬编码**：TS 侧未抽查到新增的硬编码中文/英文最终文案（i18n 管线看起来在被认真维护，quick editor 本次改动专门补了 `quickEditor` locale namespace）；Rust 侧 tray 文案硬编码如上节所述，是一个确认存在、但可能被有意接受的例外。
- **插件目录/entry 约定**：抽查 `src/plugins/csv`、`json-tools`、`web-open` 未发现绕开固定 entry（`index.ts(x)`）约定的情况，只是这三个 index 文件本身违反了"index 只做组装"的边界（见第二节）。

---

## 四、方向脱节：DESIGN.md/PRODUCT.md vs 当前代码形态

**当前代码的实际窗口拓扑（确认的事实，来自 `src-tauri/tauri.conf.json` + `src-tauri/src/lib.rs` + `src/main.tsx`）**：

- `tauri.conf.json` 的 `app.windows` **只静态声明一个窗口**：`label: "launcher"`，且 `visible: false`、`skipTaskbar: true`、`decorations: false`、`transparent: true`——启动时不会展示任何可见窗口。**没有 `main` 窗口声明**（有专门的契约测试 `test-no-main-window-startup.mjs` 断言这一点并通过）。
- 启动流程（`lib.rs:4228-4266` 的 `run()`）：`configure_desktop_tray(app)` 创建系统托盘（`hiven-tray`，macOS 下 `ActivationPolicy::Accessory`，不进 Dock），托盘菜单只有"打开 Hiven / 退出 Hiven"两项。**没有创建任何编辑器窗口**。
- 运行时按需创建的窗口只有两类：`quick-editor`（`QUICK_EDITOR_WINDOW_LABEL`，Detach 后的独立编辑器）、`plugin-surface`（插件窗口）。`src/main.tsx:37-43` 的 `loadRootComponent()` 证实这是全部三种 window 类型（`launcher`/`plugin-surface`/`quick-editor`），其余情况一律加载 `App.tsx` 的 `LauncherRuntimeApp`（纯 launcher 运行时，不含任何"主工作台"UI，`App.tsx:29-31` 明确 `export default function App() { return <LauncherRuntimeApp /> }`）。
- 唯一入口是 Global Launcher（隐藏窗口，热键唤出）+ 系统托盘；Quick Editor 是"单编辑器换宿主"模型（默认长在 launcher 里，可以 detach 成独立窗口），不存在"主窗口"这个概念。

**DESIGN.md（"2026-06-16 定稿"）描述的形态**：

- "Primary product surfaces: **Main workbench**（editor panes, **sidebar/rail**, topbar, status), Global Launcher, Command Palette, Plugins view, Pinned Runner, Settings"（DESIGN.md:6）。
- "Left rail（collapsible, 48-56px icons...）: Primary navigation (Editor, Plugins, Settings) + Pinned actions"（DESIGN.md:54）——即侧边栏导航。
- "Main canvas...Default: Single prominent editor pane... that can split on demand (horizontal/vertical...)"（DESIGN.md:56）——即多 pane 工作台。
- Sidebar 组件、48px 图标 rail、pane 分栏 tabs 等大量描述（DESIGN.md:90-93）。

**脱节结论（不是程度问题，是范畴问题）**：

1. DESIGN.md 里的"Main workbench + sidebar/rail + 多 pane"这一整套 IA，在当前代码里对应的实现就是第一节 1.2 提到的 `EditorView.tsx`/`WorkspaceShell.tsx` 那条死链路——**它不是"还没做"，是"做完了、后来入口被切断、文档没跟着改"**。这与常规的"设计文档滞后于实现细节"不同，属于文档描述了一个已经从产品里退场的形态。
2. 当前产品事实上的主入口是"系统托盘 + 全局热键唤出的 Launcher"，完全找不到 DESIGN.md 里"sidebar rail 常驻导航"这类概念的对应实现——因为压根没有一个"常驻可见窗口"可以放 sidebar。
3. PRODUCT.md 相对克制，没有直接描述具体 UI 布局，脱节程度比 DESIGN.md 小，但它仍然通篇以"desktop workbench"（桌面工作台）作为产品人设的核心比喻（"reliable desktop workbench"），跟"托盘 + 全局唤出面板 + 可 detach 的单编辑器"这种更接近 Raycast/Spotlight 的交互模型在心智模型上也有错位，只是没有 DESIGN.md 那么具体、那么容易证伪。
4. 值得注意：`doc/2026-07-02-quick-editor-host-surface-design.md` 作为最新、最贴近当前代码的设计文档，完全没有提及 DESIGN.md 的存在或需要同步更新，说明"窗口架构重构"系列文档和"UI & Design System"文档目前是两条互不感知的文档线，这也是导致脱节没有被及时发现的直接原因。

---

## 五、状态与复杂度风险

1. **跨窗口 store 不实时同步是已知且被显式处理的约束，不是新风险**：`doc/2026-07-02-quick-editor-host-surface-design.md` 第 74 行明确写"这是必要机制而非特判：accelerator 在系统层吞掉按键，其 handler 可能运行在 main webview（store 不跨窗口实时同步）"，`editorBridge.ts` 里大量用 `localStorage` 做跨窗口快照传递（`EDITOR_ACTIVE_CONTEXT_SNAPSHOT_KEY`/`EDITOR_ACTIVE_PANE_SNAPSHOT_KEY`，带 TTL 30s）+ Tauri event 做"活跃窗口在线广播"双通道兜底，是经过设计的补偿机制，思路清楚（persist 兜底 + event 实时，互为降级路径）。这部分风险是"已知且已缓解"，不是本次新增风险。
2. **真正的新风险是"看起来仍是运行时分支、实际上恒为假"的死分支扩散面很广**：`isEditorWindowRuntime()` 这一个判定函数，直接影响 `pluginApi.ts`（约 10 处分支）、`pluginInputResolver.ts`、`inputResolver.ts`、`workspacePublicApi`（`executeEffects`）、`effectRunner.ts`、`pluginCommandExecutor`、`toolbarCommandRunner` 等至少 7-8 个文件的分支走向（`test-window-architecture-phases.mjs:135-145` 逐一断言过这些文件都含这个判定）。这些代码现在全部只会走 false 分支，true 分支（含 `useWorkspaceStore`/`runtimeRegistry`/`effectRunner` 的调用）永远死代码，但从代码本身完全看不出这一点——不读 `main.tsx` 的窗口路由表，任何后来的开发者都会以为这是一条正常的双态分支。这是本次审查评估下来复杂度/可维护性风险最高的一点：**大量"必要机制"的外观下，混入了一段现在已经不必要、但仍在被认真维护和测试字符串模式的机制**，边界已经模糊到需要跨 5-6 个文件追踪才能确认。
3. **多 webview 状态一致性**：Quick Editor 走独立的 `useQuickEditorStore`（zustand persist，走 localStorage），与 Global Launcher 主体状态（`useAppStore`）、已经死掉的 `useWorkspaceStore`三套 store 并存，职责边界目前靠"谁在哪个窗口跑"人工划分，没有类型层面的强制隔离。短期没问题（Quick Editor 范围明确），但如果之后还要接入更多"可 detach"的 host surface（settings/plugins 也是候选，按当前 `LauncherHostSurfaceTarget` 的类型已经预留了 `'system-settings' | 'system-plugins'`），这种"每加一个 detach 目标就再拆一个独立 store + 手写 localStorage 快照协议"的模式会线性增加维护成本，建议在下一次涉及"更多 surface 可 detach"的设计里，把 editorBridge.ts 这套"snapshot + event 双通道"抽成一个可复用的跨窗口状态同步小工具，而不是每个 surface 各写一遍。

## 风险与建议（按优先级）

1. **高优先级 / 建议在合并前处理**：`npm run check:architecture` 当前失败（3 条），且明确不是历史豁免，属于本分支引入的红线违规，按仓库规则这应该是硬阻塞项。
2. **高优先级 / 建议尽快决策**：Text Diff 插件的 `openDiffPage` 路径已经被自身分支的另一个改动（97b1e50）打断，用户操作会静默无效果。建议二选一：(a) 把 Diff 迁移到 Quick Editor 的 pane 模型上重新接线；(b) 在决策清楚前，至少让 `openDiffPage` 的 fallback 分支给出明确的"暂不支持"提示，而不是静默丢弃 payload。同时建议清理或明确标注 `EditorWindow.tsx`/`EditorView.tsx`/`WorkspaceShell.tsx`/`effectRunner.ts`/`panelRegistry`/`PresentationHost`/`RegexTesterPanel` 这条死链路的去留：删除、迁移到 Quick Editor，或者至少在文档里写清楚"这套 Workspace Extension Architecture 暂时下线，等 Diff 迁移完成后再决定"。
3. **中优先级**：DESIGN.md 需要一次明确的"过期声明"或重写——目前它仍标注"Status: Active"，但描述的主工作台/侧边栏形态已经是死代码，容易误导后来者（包括 AI agent）以为这是要恢复的目标态。建议至少加一行"当前实现已转向 launcher-only 架构，本文档待随窗口架构重构收尾后重写"，避免脱节被继续放大。
4. **中优先级**：`check-architecture.mjs` 建议补一条"入口可达性"检查（或作为独立脚本），哪怕只是从 `main.tsx` 已知的窗口路由出发做一次简单的 import 图遍历、把从未被引用到的 `src/**/*.tsx` 列出来供人工复核，能提前抓住本次审查里发现的这类"死链路"问题。
5. **低优先级**：Rust 托盘文案硬编码中英文双语（`desktop_tray_text`）与仓库"禁止硬编码 UI 文案"的规则字面冲突，建议在 AGENTS.md 里显式记一条例外说明，避免被误当作反例复制到其它原生代码里。
