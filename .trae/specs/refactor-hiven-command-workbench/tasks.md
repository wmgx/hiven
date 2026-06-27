# Tasks

- [x] Task 1: 建立独立分支与重构边界
  - [x] SubTask 1.1: 从当前工作区切换到独立分支 `ralph-hiven-refactor-20260626`
  - [x] SubTask 1.2: 记录现有未提交变更，不回滚用户已有改动
  - [x] SubTask 1.3: 识别现有 Launcher、Editor、Plugin Surface、Tauri window 相关入口

- [x] Task 2: Phase 0 - Launcher 命名与 host 边界整理
  - [x] SubTask 2.1: 新增 `LauncherHostId`、host capability 与 legacy surface id normalize
  - [x] SubTask 2.2: 将 `CommandPalette` 兼容包装到 `EditorCommandBarHost`
  - [x] SubTask 2.3: 编辑器 Cmd+K 默认过滤 app launch、system power、settings 等全局能力
  - [x] SubTask 2.4: 增加 `Search all Hiven...` 从 Editor Command Bar 跳转 GlobalLauncher
  - [x] SubTask 2.5: 迁移 launcher usage bucket，兼容 `command-palette` 与 `editor-command-bar`
  - [x] SubTask 2.6: 增加或更新 launcher scope、usage、ranking 脚本测试

- [x] Task 3: Phase 1 - Plugin Surface 独立窗口
  - [x] SubTask 3.1: 扩展 `PluginUiSurfaceContribution`，支持 `instancePolicy`、`shell`、`entry.shortcutPresentation`
  - [x] SubTask 3.2: Rust 新增 `show_plugin_surface_window` 与 `hide_plugin_surface_window`
  - [x] SubTask 3.3: 新增 `src/workspace/windowManager/pluginSurfaceWindows.ts`
  - [x] SubTask 3.4: 新增 `PluginSurfaceWindowApp` 与窗口路由
  - [x] SubTask 3.5: 从 GlobalLauncher 抽出 `PluginSurfaceRenderer`、permission gate、host api 与 error boundary
  - [x] SubTask 3.6: `pluginSurfaceShortcuts` 按 `shortcutPresentation` 分流到 launcher 或独立窗口
  - [x] SubTask 3.7: 修复 GlobalLauncher transient surface 对 `surface.shell.closeOnBlur` 的尊重
  - [x] SubTask 3.8: clipboard-history 声明快捷键窗口打开策略
  - [x] SubTask 3.9: 新增 `scripts/test-plugin-surface-window.mjs` 与相关生命周期测试

- [x] Task 4: Phase 2 - Editor 独立窗口
  - [x] SubTask 4.1: Rust 新增 `show_editor_window` 与 `close_editor_window`
  - [x] SubTask 4.2: 新增 `src/windows/EditorWindowApp.tsx` 与窗口 chrome
  - [x] SubTask 4.3: `src/main.tsx` 或 `src/App.tsx` 支持 `?window=editor`
  - [x] SubTask 4.4: 将 `EditorView` 适配独立窗口，去除主窗口 view 假设
  - [x] SubTask 4.5: 将 Editor Command Bar 放入 Editor Window 内部
  - [x] SubTask 4.6: GlobalLauncher 新增或调整 Open Editor 命令
  - [x] SubTask 4.7: 将 `ctx.api.showMainPanel()` 语义迁移为 `showEditorWindow()`
  - [x] SubTask 4.8: 支持从 GlobalLauncher 将 selection 或 clipboard 打开进 Editor
  - [x] SubTask 4.9: 新增 `scripts/test-editor-window-launch.mjs` 与 Open Editor 验证

- [x] Task 5: Phase 3 - 去主窗口
  - [x] SubTask 5.1: `tauri.conf.json` 移除或延迟创建 `main` 初始窗口
  - [x] SubTask 5.2: 启动生命周期调整为 tray/background + hidden launcher
  - [x] SubTask 5.3: Settings 迁移为 launcher surface
  - [x] SubTask 5.4: Plugins/Scripts 管理迁移为 launcher surface
  - [x] SubTask 5.5: Plugin editor 迁移为 launcher surface 或独立 dev window
  - [x] SubTask 5.6: 移除 `Sidebar`、`ViewContent`、`ViewId` 的运行时依赖
  - [x] SubTask 5.7: 调整 app 退出策略，确保关闭所有窗口后 background 仍运行
  - [x] SubTask 5.8: 新增 `scripts/test-no-main-window-startup.mjs`

- [x] Task 6: Phase 4 - Launcher Kernel / UI Host 抽象
  - [x] SubTask 6.1: 新增 `useLauncherSession`
  - [x] SubTask 6.2: 抽出共享 `LauncherShell`、SearchStep、List、CollectInputStep、ResultStep、ParamStep、Footer
  - [x] SubTask 6.3: 新增 `LauncherHostConfig`，描述 hostId、capabilities、contextProvider、presentation、close behavior
  - [x] SubTask 6.4: GlobalLauncherHost 仅保留 global host 组装职责
  - [x] SubTask 6.5: EditorCommandBarHost 仅保留 editor host 组装职责
  - [x] SubTask 6.6: 删除两个 host 中重复的 query、selectedIndex、dynamicItems、IME 与 result UI 逻辑
  - [x] SubTask 6.7: 更新 launcher controller、IME、back focus、UI 高度相关测试

- [x] Task 7: Phase 5 - 对象、动作、上下文和输出路由
  - [x] SubTask 7.1: 新增 `WorkObject`、`WorkAction`、`OutputTarget` 类型
  - [x] SubTask 7.2: 新增 Provider Registry，先接入 clipboard、app、window、editor document/context
  - [x] SubTask 7.3: 新增 WorkAction Registry，按对象类型生成动作
  - [x] SubTask 7.4: Launcher 支持 object-backed item 与对象动作展开
  - [x] SubTask 7.5: 新增 Context Broker 与 Editor context snapshot
  - [x] SubTask 7.6: 新增 OutputRouter，支持 copy、paste foreground app、replace editor selection、insert/open editor、attach panel、save shelf
  - [x] SubTask 7.7: 文本插件结果逐步迁移到 OutputRouter
  - [x] SubTask 7.8: 新增 `scripts/test-output-router-text-targets.mjs` 与 `scripts/test-context-snapshot-editor.mjs`

- [x] Task 8: 最终清理与验证
  - [x] SubTask 8.1: 删除或弱化旧 MainApp、Sidebar、GlobalLauncher overlay、重复 SearchStep/ResultStep 逻辑
  - [x] SubTask 8.2: 确认现有插件设置、内置插件释放、PanelHostV2、EffectRunner 不被破坏
  - [x] SubTask 8.3: 运行 `npm run build`
  - [x] SubTask 8.4: 运行相关 `node scripts/test-*.mjs` 验证脚本
  - [x] SubTask 8.5: 更新 `tasks.md` 与 `checklist.md` 所有完成项

- [x] Task 9: 修复最终验收发现的 Launcher 共享实现缺口
  - [x] SubTask 9.1: 让 GlobalLauncherHost 复用 `useLauncherSession`
  - [x] SubTask 9.2: 让 GlobalLauncherHost 复用共享 Launcher UI 基础件
  - [x] SubTask 9.3: 移除 GlobalLauncher 中重复的 query、selectedIndex、dynamicItems、IME 与 result UI 主路径
  - [x] SubTask 9.4: 保持 GlobalLauncher transient plugin surface 行为不回退
  - [x] SubTask 9.5: 重新运行 Launcher 与最终验证脚本

- [x] Task 10: 修复本轮新增/重构模块的 ESLint 违规: `npx eslint src/launcher src/windows src/workflow src/workspace/windowManager src/components/pluginSurface src/components/GlobalLauncher.tsx src/components/CommandPalette.tsx src/workspace/launcher/types.ts src/workspace/launcher/registry.ts src/workspace/launcher/usage.ts src/workspace/launcher/identity.ts src/workspace/launcher/hostActions.ts src/workspace/launcher/pluginApi.ts src/workspace/launcher/toolAdapter.ts src/hotkeys/pluginSurfaceShortcuts.ts src/App.tsx src/main.tsx` 当前失败，需修复直接相关文件中的 refs during render、set-state-in-effect、purity、fast-refresh-only-export-components、unused MainApp 等问题，并保持现有契约测试与 build 通过。

- [x] Task 11: 最终验证并提交本轮 Ralph Loop 改动
  - [x] SubTask 11.1: 复核 `git status --short`，确认待提交内容属于本轮 Hiven 命令工作台重构或对应规格/验证文档
  - [x] SubTask 11.2: 运行最终验证命令：targeted ESLint、核心契约测试、`npm run build`、`cargo check --manifest-path src-tauri/Cargo.toml`、`npm run check:architecture`
  - [x] SubTask 11.3: 复核 `tasks.md` 与 `checklist.md` 的完成状态
  - [x] SubTask 11.4: 提交所有本轮改动，提交信息说明 Hiven command workbench refactor
# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 1
- Task 4 depends on Task 1 and should reuse Task 3 window manager patterns when available
- Task 5 depends on Task 4
- Task 6 depends on Task 2 and Task 3
- Task 7 depends on Task 2, Task 4 and Task 6
- Task 8 depends on Task 2 through Task 7
- Task 11 depends on Task 1 through Task 10

# Parallelizable Work
- Task 2 and Task 3 may proceed in parallel after Task 1.
- Task 4 may proceed in parallel with Task 6 after the required window routing and host boundary context is understood.
- Test script work inside each phase may be delegated separately from implementation.
