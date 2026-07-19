# Hiven 2026-06-26 重构设计完成计划

来源设计：`/Users/bytedance/Downloads/hiven_refactor_design_2026-06-26 (1).md`  
补充材料：`/Users/bytedance/.codex/attachments/5497c707-2943-4263-b1d5-c40cb119ff3e/pasted-text-1.txt`  
代码分支：`refactor/workbench-window-architecture`  
计划日期：2026-06-29

## 1. 目标

把 Hiven 从“文本工具 + 启动器 + 插件集合”收敛为设计文档里的形态：

```text
Hiven = 本地个人命令工作台
Object → Action → Surface → Output Target
```

最终用户行为必须成立：

```text
启动 Hiven → 不出现主窗口
全局快捷键 → 出现 Spotlight Launcher
输入 editor → 打开编辑器窗口
编辑器 Cmd+K → 只出现编辑器局部动作
插件快捷键 → 打开插件独立窗口
剪贴板历史选择 → 可 paste 到前台 app
复杂文本 → 可送入 Editor
Editor 中可附着 translator / clipboard / json panel
关闭所有窗口 → tray/background 仍运行
```

## 2. 当前代码事实

本计划基于当前代码扫描，而不是只基于设计文档推断。

### 2.1 已经基本落地的设计

- 启动入口已经从主窗口迁到 launcher/background runtime：
  - `src/App.tsx` 默认渲染 `LauncherRuntimeApp`。
  - `src/main.tsx` 通过 `?window=launcher|editor|plugin-surface` 路由不同 Window App。
  - `src-tauri/tauri.conf.json` 只声明隐藏的 `launcher` 初始窗口，未声明 `main`。
- Editor 独立窗口已经存在：
  - `src/components/EditorWindow.tsx`
  - `src/workspace/windowManager/editorWindow.ts`
  - Rust command：`show_editor_window` / `close_editor_window`
- Launcher → Editor 已经有显式 bridge：
  - `src/workspace/editorBridge.ts`
  - API 包括 `getEditorContext`、`createEditorPane`、`replaceEditorSelection`、`insertIntoEditor`、`openEditorPanel`。
- Plugin Surface 独立窗口已存在：
  - `src/components/PluginSurfaceWindow.tsx`
  - `src/workspace/pluginSurfaceWindows.ts`
  - `src/workspace/windowManager/pluginSurfaceWindows.ts`
  - Rust command：`show_plugin_surface_window` / `hide_plugin_surface_window`
- SurfaceRegistry 已经 Rust-backed：
  - 前端：`src/surfaces/registry.ts`
  - Rust：`surface_registry_snapshot/upsert/mark_state/remove`
- Global Launcher 和 Editor Command Bar 已经分层：
  - `src/launcher/hosts/GlobalLauncherHost.tsx`
  - `src/launcher/hosts/EditorCommandBarHost.tsx`
  - `src/workspace/launcher/useLauncherSession.ts`
  - `src/workspace/launcher/types.ts` 已定义 `global-launcher` 与 `editor-command-bar` host capability。
- Settings / Plugins / PluginEditor 已经 surface 化：
  - `src/surfaces/SettingsSurface.tsx`
  - `src/surfaces/PluginsSurface.tsx`
  - `src/surfaces/PluginEditorSurface.tsx`
- Object / Action / Output 模型已经有第一版：
  - `src/workflow/workObject.ts`
  - `src/workflow/workAction.ts`
  - `src/workflow/outputTarget.ts`
  - `src/workflow/outputRouter.ts`
  - `src/workflow/workflowRegistry.ts`
  - `src/workflow/workflowLauncherAdapter.ts`
- 自动测试脚本已经非常完整：
  - `npm run test:refactor-suite`
  - `npm run test:refactor-gate`
  - 多个 `test:workflow-*`、`test:editor-*`、`test:plugin-surface-*`、`test:window-*`。

### 2.2 仍需收口的设计缺口

1. `EditorBridge` 冷启动协议仍偏脆弱：默认 1200ms timeout，pending request 可能在调用方 timeout 后才被 editor 执行。
2. `SurfaceRegistry` 虽已 Rust-backed，但 Rust 侧 focus lost / hide / destroy timer 与 registry state 的一致性还需要硬化。
3. `GlobalLauncherHost` 已拆分，但 host UI/kernel 抽象还没完全收口；`EditorCommandBarHost` 仍保留较多重复 frame 渲染逻辑。
4. `hostActions.ts` 仍包含不少 demo / 内置文本动作，长期会成为新的杂物堆。
5. 旧状态兼容层仍在：`store.ts` 的 `editorText`、`editorInstance`、`pluginEditor`；`workspaceStore` 仍持久化 scratch workspace。
6. Settings / Plugins 虽有 `SurfaceShell`，但内部状态仍较依赖旧 store 语义。
7. Object / Action 模型已有骨架，但仍需要补齐 provider/action 治理、ObjectRow/ActionPane 的产品体验，以及更多输出路径的真实验收。
8. 自动测试多，但真实 macOS 桌面 smoke 仍是证据缺口；本计划明确不使用截图工具。
9. 当前分支规模大，合并风险高，需要按模块收敛、拆提交组或拆 PR。

## 3. 方案取舍

### 推荐方案：冻结功能，先做收敛型完成

不继续扩展新功能，按“协议硬化 → 状态一致性 → host 抽象 → 旧状态删除 → 验证证据”的顺序完成。

原因：当前代码已经不是“缺功能”，而是“核心功能基本实现但需要可合并、可验证、可维护”。继续加新动作或新插件会增加风险。

### 不推荐方案 A：先完整重做 Object / Action UI

Object / Action 是最终心智，但窗口边界、bridge、registry 如果还不稳，先重做 UI 会放大跨窗口状态问题。

### 不推荐方案 B：直接 merge 当前大分支

当前分支改动范围过大，且真实桌面 smoke 未完成。直接 merge 后定位 regressions 成本高。

## 4. 精确范围

### 4.1 本轮必须完成

- 完成设计文档 Phase 1~5 的工程闭环。
- 修复跨窗口协议与状态一致性风险。
- 将临时 demo 动作迁出 `hostActions.ts` 或明确归类为 first-party workflow/text actions。
- 清理主窗口遗留模型和可删除兼容层。
- 补齐自动 gate 与无截图人工 smoke checklist。
- 产出可合并证据：命令结果、人工 smoke 记录、剩余已知风险。

### 4.2 本轮不做

- 不引入截图、OCR、视觉 diff 等工具。
- 不新增大型 AI 能力或新插件产品。
- 不把 diff/json/markdown/AST 语义下沉到 framework。
- 不把插件产品 UI 吸收到 framework。
- 不为了清理而重写 Monaco/editor primitive。
- 不做线上发布、签名分发或自动更新策略调整。

## 5. 分阶段小提交计划

每个提交都应保持代码可构建，至少能通过对应模块脚本；进入阶段末尾时跑 `npm run test:refactor-gate`。

### Phase A：建立当前基线与 CI 证据

1. 记录当前分支基线状态与设计完成矩阵。
2. 确认 `npm run test:refactor-gate` 本地可复现；失败则先只修 gate 本身暴露的问题。
3. 新增或修正 CI workflow，执行：
   - `npm run test:refactor-suite`
   - `npx tsc --noEmit --pretty false`
   - `npm run check:architecture`
   - `git diff --check`
   - `cargo check --manifest-path src-tauri/Cargo.toml`
   - `npm run build`
4. 将 `doc/refactor-final-validation.md` 中“已证明”与“待人工 smoke”严格分开，避免文档过度宣称。
5. 如果存在未跟踪构建产物、`.DS_Store`、运行时缓存，先决定清理或补 `.gitignore`，再进入提交。

验收：本地 gate 可复现；CI 有同等 gate；文档不把未手测项目写成已完成。

### Phase B：硬化 EditorBridge 冷启动协议

1. 新增 editor ready 事件，例如 `hiven://editor-ready`，由 `EditorWindow` 在 runtime ready、bridge handlers 注册成功后发布。
2. `sendEditorBridgeRequest` 改为三段协议：
   - show editor window
   - 等待 editor ready 或读取最近 ready heartbeat
   - emit request 并等待 response
3. pending request 增加 request 状态和幂等语义，避免 timeout 后 editor 迟到执行造成重复或调用方误判。
4. 将默认 timeout 按动作拆分：
   - `getEditorContext` 维持短 timeout。
   - `createPane/openPanel/replace/insert` 使用更长 timeout，并依赖 ready ack。
5. 增加失败策略：如果 editor 未 ready，不执行破坏性 replace/insert；`open-in-editor` 可安全重试。
6. 补测试：冷启动慢、ready 前请求、迟到 response、重复 pending request、editor 已打开快路径。

验收：全局 launcher 冷启动打开 editor 并写入 pane 不再依赖 1200ms 猜测；不会在调用方失败后悄悄执行破坏性文本替换。

### Phase C：硬化 SurfaceRegistry 与窗口生命周期一致性

1. 为 plugin surface Rust 窗口生命周期增加 registry 同步事件：show、hide、focus lost hide、destroy timer close。
2. 前端 `PluginSurfaceWindow` 在 mount/unmount 继续发布状态，但 Rust 触发的隐藏也必须能更新 registry。
3. `hide_plugin_surface_window` 与 destroy timer 统一更新 Rust registry，避免前端未卸载时 registry 仍显示 visible。
4. `surface_registry_mark_state` 增加输入校验，拒绝非法 state/kind。
5. `focusSurfaceInstance` 明确处理：
   - editor → `show_editor_window`
   - launcher → `show_launcher_window`
   - plugin-surface → `show_plugin_surface_window`
   - hidden/destroyed instance 的重建策略
6. 补测试：focus lost、Esc hide、destroy timeout、再次快捷键显示/重建、registry snapshot 跨窗口一致。

验收：Global Launcher 搜索 surface 时不会展示错误的 visible/hidden 状态；插件窗口失焦隐藏、超时销毁、重复快捷键行为稳定。

### Phase D：完成 Launcher Kernel / UI Host 抽象

1. 明确 `LauncherHostConfig`：hostId、capabilities、contextProvider、presentation、closeBehavior。
2. 将 `EditorCommandBarHost` 中重复的 result/collect/param frame 渲染迁到共享 `LauncherHostView` 或扩展现有 `LauncherView`。
3. `GlobalLauncherHost` 只保留 global 特有能力：native window lifecycle、plugin/system surface frame、standalone resize、blur close。
4. `EditorCommandBarHost` 只保留 editor 特有能力：overlay positioning、focus restore、local item filtering。
5. 删除重复 SearchStep/CollectInputStep/ResultStep 组合逻辑；保持 IME、参数输入、结果选择行为一致。
6. 补测试：global/editor 两个 host 的 capabilities、候选池、IME enter、参数输入、结果选择一致性。

验收：两个 host 共享同一 kernel 和基础 UI；editor Cmd+K 不显示 app/system/settings 等全局动作；`Search all Hiven…` 是唯一显式逃生口。

### Phase E：治理 `hostActions.ts` 与 first-party workflow actions

1. 给当前内置动作分类：
   - editor pane/window 操作
   - text transform 操作
   - JSON transform 操作
   - global navigation/system 操作
2. 保留在 `hostActions.ts` 的只应是 host/window/pane 级动作。
3. 将文本和 JSON transform 迁到 first-party workflow/text action provider。
4. 插件化或 provider 化这些动作：
   - Rewrite More Politely
   - Compress to Three Sentences
   - Format as Bullet List
   - Quote as Code Block
   - JSON minify
   - JSON to YAML
   - Extract JSON Fields
5. 确保 editor Cmd+K 仍能按当前选区/当前 pane 执行动作。
6. 补测试：动作迁移后 systemKey 稳定或有兼容 alias；旧 pinned action 不丢失或有迁移。

验收：`hostActions.ts` 不再承担产品文本处理杂物堆职责；局部文本动作仍可从 Editor Command Bar 执行。

### Phase F：收敛 Settings / Plugins / PluginEditor surface 状态

1. 将 `pluginEditor` 从全局 app store 状态收敛为 `PluginsSurface` 内部导航状态或 launcher host surface target。
2. `SettingsSurface` / `PluginsSurface` 明确只依赖 surface shell 语义，不再假设旧主窗口 view。
3. 插件设置弹窗入口统一：launcher surface、plugin surface window、editor panel 的 presentation/context 保持一致。
4. PluginEditor 如果仍需复杂工作区，明确它是 launcher surface 还是独立 dev window；不要回到 main view 心智。
5. 补测试：从 Global Launcher 打开 Settings/Plugins/PluginEditor，返回、关闭、重新打开状态符合预期。

验收：Settings/Plugins 不依赖主窗口导航；PluginEditor 的生命周期属于 surface，而不是旧 ViewId。

### Phase G：清理旧主窗口与 scratch editor 兼容层

1. 审计并删除无调用方的 `editorText` / `setEditorText` / `editorInstance` 兼容状态。
2. `EditorView` 改为只依赖 `workspaceStore` / `runtimeRegistry` 获取 editor instance。
3. 重新评估 `workspaceStore` 持久化策略：
   - 如果 editor 是 scratch，默认关闭重开为空。
   - 如果需要短 TTL autosave，必须显式标注为 crash recovery，不自动恢复为长期工作区。
4. 删除或弱化旧 `CommandPalette` wrapper 的依赖；保留兼容导出时只能 thin wrapper 到 `EditorCommandBar`。
5. 清理文案和测试中仍把 editor 称为主窗口 view 的表达。
6. 补迁移测试：老 localStorage 不导致启动异常；关闭 editor 重开为空或按明确 TTL 策略恢复。

验收：代码层面不再存在“主窗口 App + editor view”的核心路径；scratch editor 行为符合设计文档。

### Phase H：补齐 Object / Action / Surface / Output 产品闭环

1. Provider Registry 分层：context provider、clipboard provider、app/window provider、editor document provider、surface provider。
2. Action Registry 分层：text actions、clipboard actions、app/window actions、editor actions、plugin-surface actions。
3. Global Launcher 支持清晰的对象行与动作展开：
   - 当前上下文对象默认置顶。
   - 搜索对象后可 Tab / Enter 展开动作。
   - action list 显示默认 output target。
4. Editor Command Bar 只展示当前 editor object 的动作，避免全局 object 池污染。
5. OutputRouter 收口所有文本输出路径：copy、paste、replace selection、insert editor、open editor、open plugin surface、attach editor panel、save shelf。
6. 补真实故事测试：
   - 外部选区 → 翻译 → attach editor panel
   - 剪贴板 JSON → format → open editor
   - 剪贴板历史 item → paste foreground app
   - editor selection → replace selection
   - plugin result → save shelf

验收：用户不需要理解“launcher/editor/plugin”三个 app，只需要从对象选择动作和输出去向。

### Phase I：无截图人工 macOS smoke

本阶段不使用截图工具，只记录文字证据。

1. 准备 `doc/refactor-manual-smoke-YYYY-MM-DD.md`。
2. 手测并记录：
   - 外部 app 选中文本 → 全局快捷键 → Hiven 展示 Selected Text 对象。
   - 选中文本 → Open in Editor / attach translator panel。
   - 复制 JSON → 全局 launcher → format → open editor。
   - 剪贴板历史快捷键 → 独立窗口 → Enter paste 到真实前台 app。
   - launcher 内打开 translator，同时快捷键打开 clipboard-history，不互相覆盖。
   - Editor Cmd+K 只显示局部动作；Search all Hiven 可跳全局。
   - 关闭 editor/plugin/launcher 后进程与 tray/background 仍存活。
   - 拒绝 Accessibility permission 后 paste fallback 文案清晰。
3. 每项记录：操作、期望、实际、结论、失败日志或复现路径。
4. 失败项不得写成完成；转为修复提交。

验收：最终完成结论有人工桌面 smoke 文字证据，而不是只靠结构测试。

### Phase J：合并收尾与 PR 拆分

1. 如果当前 PR 仍过大，按模块拆成提交组或拆 PR：
   - window runtime / no-main startup
   - plugin surface window
   - editor window / bridge
   - surface registry
   - launcher host split
   - workflow object/action/output
   - settings/plugins surfaces
   - tests / validation docs
2. 每组提供：范围、关键文件、验证命令、风险。
3. 最终执行：

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run test:refactor-gate
```

4. 若执行 `npm run lint`，结论必须区分历史 lint 问题与本次新增问题。
5. 合并前更新 `doc/refactor-final-validation.md`：只写已验证证据，不写推断。

验收：reviewer 可以按模块理解变更；最终 gate 与人工 smoke 均有证据。

## 6. 测试策略

### 6.1 自动验证

每个阶段至少跑相关测试；阶段末尾跑 gate。

核心 gate：

```bash
npm run test:refactor-gate
```

该 gate 当前包含：

```text
npm run test:refactor-suite
npx tsc --noEmit --pretty false
npm run check:architecture
git diff --check
cargo check --manifest-path src-tauri/Cargo.toml
npm run build
```

项目约定中修改 diff、插件系统、workspace renderer 或 UI 后至少执行：

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
```

### 6.2 人工验证

由于当前截图工具有问题，人工 smoke 只做文字记录，不做截图依赖。

人工 smoke 不替代自动测试；自动测试也不替代真实桌面焦点、快捷键、粘贴、权限 fallback。

## 7. 风险与止损点

- 跨窗口事件时序风险：通过 editor ready/ack、长短 timeout 分层、pending request 幂等降低。
- SurfaceRegistry 状态漂移风险：Rust 和前端双向同步，Rust lifecycle 必须成为事实源之一。
- 数据丢失风险：scratch editor 关闭前非空内容需要 copy/save/discard 或明确 TTL autosave。
- PR 体量风险：按提交组拆分，模块级 gate，必要时拆 PR。
- 产品边界风险：framework 不吸收插件产品语义；diff/json/translate/clipboard 等保持插件或 workflow action。

## 8. 完成定义

可以宣布完成时，必须同时满足：

1. 设计文档 Phase 1~5 的代码路径均有实现或明确等价实现。
2. `npm run test:refactor-gate` 通过，或失败项有明确非本次引入证据。
3. 无截图人工 macOS smoke checklist 通过，失败项已修复或明确延期。
4. `doc/refactor-final-validation.md` 更新为真实证据矩阵。
5. `git status --short --ignored` 已检查，未跟踪产物已清理或确认忽略策略。
6. 没有把 diff/json/markdown/AST/code semantic 等产品语义下沉到 framework。
7. Global Launcher、Editor Command Bar、Plugin Surface、OutputRouter 的职责边界与设计一致。

## 9. 建议立即执行的下一步

1. 先跑一次：

```bash
npm run test:refactor-gate
```

2. 如果 gate 通过，优先做 Phase B/C 的硬化，而不是继续加新功能。
3. 如果 gate 失败，先修 gate 暴露的问题，并更新本计划的基线状态。
4. 在 Phase B/C 完成后再做人工 smoke；smoke 失败项直接转为修复提交。
