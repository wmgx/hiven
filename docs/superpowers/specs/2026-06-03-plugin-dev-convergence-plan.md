# 插件开发能力收敛实施计划

> **For Claude:** REQUIRED SUB-SKILL: 使用 superpowers:executing-plans 按任务逐步实现本计划。

**目标：** 把 FluxText 从"内置插件 IDE"收敛回"轻量 Action Runtime"。移除应用内的目录编辑器与调试器视图，但保留完整的"外部编辑 + 热重载"开发闭环：脚手架生成 → 用 VS Code（检测不到则系统文件管理器）打开 dev 目录 → 外部编辑 → 保存 → Watch 自动热重载。

**架构：** 应用不再承担"在应用内读写/编辑/调试插件源码"的职责。源码编辑交给外部编辑器；应用只保留侧载、Reload、Watch 热重载、脚手架生成、用外部工具打开目录。

**技术栈：** Tauri v2 命令、React、Zustand、现有 `pluginRuntime`/`pluginStore`/`pluginRegistry`。

---

## 决策（已与用户确认）

1. **砍掉应用内开发 IDE**：移除 `PluginEditorView`（Monaco 目录编辑器）、`DebuggerView`（调试器）、`pluginAuthoringHarness`、`runPluginDebugSource`。
2. **保留 Watch 热重载**：`watchDevPlugin` / `unwatchDevPlugin` / `reloadDevPlugin` 全部保留。它监听磁盘文件变化，外部编辑器保存即可触发，不依赖内置编辑器。
3. **保留脚手架生成**：`createPluginScaffoldFiles` 不动。
4. **生成后用 VS Code 优先打开**：新增 Tauri 命令 `open_plugin_dir`，按"VS Code (`code` CLI) 优先 → 系统文件管理器兜底"顺序打开 dev 目录。

## 不能删 / 必须保留（调查结论）

- `read_plugin_file` / `save_plugin_file`（Tauri 命令）：`configInit.ts` 启动释放脚手架包时仍在用，**保留**。
- `parsePluginDefinitionSource`（`pluginDebugRunner.ts`）：被 `pluginRuntime.loadDevPluginEntry` 用于解析 dev 插件源码，是 dev 加载核心，**保留**。
- `pluginScaffold.ts`、`pluginCommandRunner.ts`：**保留**。

## 要删除的文件

- `src/views/PluginEditorView.tsx`
- `src/views/DebuggerView.tsx`
- `src/workspace/pluginAuthoringHarness.ts`
- 对应测试脚本：`scripts/test-plugin-authoring-e2e-harness.mjs`、`test-plugin-authoring-flow.mjs`、`test-plugin-authoring-ui-contract.mjs`、`test-plugin-editor-debug-runner.mjs`（执行时逐一确认其覆盖内容确为编辑器/调试/authoring 后再删）

---

## Task 1: 移除调试运行入口，保留解析函数

**Files:**
- Modify: `src/workspace/pluginDebugRunner.ts`

- [ ] 删除 `runPluginDebugSource` 及其相关类型 `PluginDebugRunOptions` / `PluginDebugRunResult`。
- [ ] 保留 `parsePluginDefinitionSource` 及其 import（`PluginDefinition`、`pluginHostCore`）。
- [ ] 删除因移除 `runPluginDebugSource` 而变为未使用的 import（`buildTextPluginInputs` 等）——交给 goimports/eslint 处理，不手动猜测。

## Task 2: 删除编辑器与调试器视图

**Files:**
- Delete: `src/views/PluginEditorView.tsx`
- Delete: `src/views/DebuggerView.tsx`
- Modify: `src/App.tsx`

- [ ] 删除两个视图文件。
- [ ] `App.tsx` 移除 `PluginEditorView` / `DebuggerView` 的 import 与 `case 'plugin-editor'` / `case 'debugger'` 路由分支。
- [ ] 移除 `store.ts` 中的 `openPluginEditor` action、`plugin-editor` / `debugger` 视图状态及相关字段（核对引用后再删）。
- [ ] 移除 Sidebar 中指向 debugger/editor 的导航项（若有）。

## Task 3: 删除 authoring harness

**Files:**
- Delete: `src/workspace/pluginAuthoringHarness.ts`

- [ ] 确认无其他生产代码 import 它（当前仅测试脚本引用）后删除。

## Task 4: 新增 open_plugin_dir Tauri 命令（VS Code 优先）

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`（如需 shell/opener 权限）

- [ ] 新增命令 `open_plugin_dir(path: String)`：
  - 先尝试 `code <path>`（探测 `code` CLI；macOS/Linux 直接调用，Windows 用 `code.cmd`）。
  - 失败则降级系统文件管理器：macOS `open`、Windows `explorer`、Linux `xdg-open`。
  - 路径校验：必须位于 `plugins/dev` 根下，拒绝逃逸路径。
- [ ] 在 `invoke_handler` 注册该命令。
- [ ] 删除 `list_plugin_files` 命令及其注册（仅编辑器用；确认 `configInit.ts` 不依赖）。

## Task 5: 改造 ScriptsView 的开发入口

**Files:**
- Modify: `src/views/ScriptsView.tsx`
- Modify: `src/workspace/pluginRuntime.ts`

- [ ] `handleCreatePlugin`：生成 dev 脚手架后，调用新的 `openPluginDir(folderPath)`（包装 `open_plugin_dir`）而非 `openPluginEditor`。
- [ ] 三处 `openPluginEditor`（installed/dev/builtin 的"打开编辑器"按钮）改为：dev 包 → `openPluginDir`；installed/builtin → 移除该按钮或同样改为打开目录（builtin 只读，保留"打开目录"查看即可）。
- [ ] `pluginRuntime.ts`：删除仅编辑器使用的文件读写包装（`list_plugin_files` 包装、纯编辑用的 read/save 包装），保留 dev 加载链路用到的部分；新增 `openPluginDir` 包装。
- [ ] 保留 Reload / Watch / Unwatch 按钮与逻辑。

## Task 6: 文案与文档同步

**Files:**
- Modify: `src/i18n.ts`
- Modify: `doc/plugin-directory-convention.md`

- [ ] i18n 移除/调整 `scripts.actionOpenEditor` 等编辑器相关文案，新增"打开目录"文案。
- [ ] 约定文档第 89-101 行（Listing/Editing、Creating A Plugin）更新为：外部编辑器编辑、应用内不再提供目录编辑器/调试器、New Plugin 生成后用 VS Code/文件管理器打开。

## Task 7: 验证

**Files:** 所有改动文件。

- [ ] `git status --short --ignored` 检查未跟踪/运行时产物。
- [ ] `npm run check:architecture`。
- [ ] `git diff --check`。
- [ ] `npm run build`。
- [ ] 启动应用人工验证：New Plugin 能生成并用 VS Code/文件管理器打开 dev 目录；外部修改源码后 Watch 自动热重载生效；Reload 按钮可用；编辑器/调试器视图与入口已消失。

## 风险

- `open_plugin_dir` 探测 `code` CLI 在不同平台/未加入 PATH 时行为不同，必须有文件管理器兜底且不报错中断。
- 删除视图涉及 `store.ts` 视图状态机，需核对所有 `setView`/路由引用，避免遗留死分支。
- 测试脚本删除前需逐一确认覆盖范围确为待删能力，避免误删通用回归。
