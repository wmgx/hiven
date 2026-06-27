# Hiven 命令工作台重构 Spec

## Why
当前 Hiven 同时存在主窗口、全局 Launcher、编辑器 CommandPalette 与插件 Surface slot，用户心智容易变成多个小 app 的拼接。需要按 `docs/superpowers/specs/hiven_refactor_design_2026-06-26.md` 将 Hiven 重构为“本地个人命令工作台”：一个全局入口，多个清晰 Surface，统一对象、动作和输出去向。

## What Changes
- 将 App 级入口收敛为全局 Launcher，编辑器从主窗口 view 重构为独立系统 Surface。
- 插件 Surface 支持独立窗口，快捷键打开的插件不再覆盖 GlobalLauncher 内 transient surface。
- 将 GlobalLauncher 与 Editor Command Bar 的候选范围、能力边界和命名分离，并逐步共享 Launcher kernel/session/view。
- 引入窗口管理模块、Surface Registry、Context Broker、WorkObject/WorkAction/OutputTarget/OutputRouter 基础模型。
- 去除主窗口 / Sidebar / ViewId 常驻导航模型，启动后默认 tray/background + launcher，不自动显示 main window。
- 保留现有 Glass Morphism 视觉语言，窗口、Launcher、插件 Surface、编辑器面板继续使用高质感、稳定布局与清晰状态反馈。

## Impact
- Affected specs: Hiven runtime, Launcher, Editor workspace, Plugin Surface, Output routing, Context snapshot, Tauri window lifecycle.
- Affected code: `src/App.tsx`, `src/main.tsx`, `src/components/GlobalLauncher.tsx`, `src/components/CommandPalette.tsx`, `src/views/EditorView.tsx`, `src/store.ts`, `src/workspace/*`, `src/hotkeys/*`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `scripts/*`.

## ADDED Requirements

### Requirement: 插件 Surface 独立窗口
The system SHALL open shortcut-invoked plugin surfaces in independent plugin-surface windows when the surface declares `entry.shortcutPresentation: 'window'`.

#### Scenario: 快捷键打开剪贴板历史
- **WHEN** GlobalLauncher 内正在显示 translator transient surface，用户通过插件快捷键打开 clipboard-history
- **THEN** 系统创建或聚焦 `plugin-surface:builtin:clipboard-history:main` 窗口
- **AND** GlobalLauncher 内的 translator transient surface 不被覆盖

#### Scenario: 插件窗口生命周期
- **WHEN** 用户在插件 Surface 窗口按 Esc
- **THEN** 窗口隐藏但不立即销毁
- **AND** `destroyTimeout` 到期后窗口销毁
- **AND** 再次快捷键可显示原窗口或重建窗口

### Requirement: 编辑器独立窗口
The system SHALL provide a singleton Editor Window created through `showEditorWindow()`.

#### Scenario: 从全局 Launcher 打开编辑器
- **WHEN** 用户在 GlobalLauncher 执行 Open Editor
- **THEN** 系统创建或聚焦 `editor` 窗口
- **AND** Editor Window 保留多 pane、PanelHostV2、plugin toolbar 与 Cmd+K 局部动作能力

#### Scenario: 关闭后重新打开
- **WHEN** 用户关闭 Editor Window 后再次打开
- **THEN** 默认出现空 Scratch Pad
- **AND** 不自动恢复旧主工作区内容

### Requirement: 无常驻主窗口启动
The system SHALL start as tray/background plus hidden launcher without showing the legacy main window.

#### Scenario: 应用启动
- **WHEN** 用户启动 Hiven
- **THEN** 不出现主窗口
- **AND** 全局快捷键可以唤起 Spotlight 风格 Launcher
- **AND** 关闭所有窗口后 tray/background 仍运行

### Requirement: Launcher Host 能力边界
The system SHALL separate GlobalLauncher and EditorCommandBar by host id, capability, scope, copywriting and context.

#### Scenario: 编辑器 Cmd+K
- **WHEN** 用户在 Editor Window 中打开 Cmd+K
- **THEN** 候选项默认只包含当前选区、当前文档、pane、renderer、panel 和可附着编辑器的插件动作
- **AND** 不显示 Safari、Terminal、系统关机/重启等全局入口

#### Scenario: 跳到全局搜索
- **WHEN** 用户在 Editor Command Bar 选择 Search all Hiven
- **THEN** 系统打开 GlobalLauncher

### Requirement: 共享 Launcher Kernel 与 UI 基础件
The system SHALL use a shared LauncherSession and shared LauncherView for GlobalLauncherHost and EditorCommandBarHost.

#### Scenario: 参数输入与结果选择
- **WHEN** 两个 host 执行 collect-input、param step、result-choice
- **THEN** 行为由同一套 controller/session/view 支撑
- **AND** IME、Enter、Escape、Back 行为保持一致

### Requirement: 插件可附着到编辑器
The system SHALL keep PanelHostV2 as editor attachment host and allow attachable plugin surfaces/panels to open left/right/bottom.

#### Scenario: 编辑器打开翻译预览
- **WHEN** 用户在 Editor Command Bar 选择 Translate with Preview
- **THEN** translator panel 附着到 Editor PanelHostV2 的 right placement
- **AND** 结果可回填当前 pane

### Requirement: 对象-动作-输出模型
The system SHALL introduce WorkObject, WorkAction, OutputTarget and OutputRouter as the long-term model while keeping LauncherItem compatibility during migration.

#### Scenario: 剪贴板对象动作
- **WHEN** 用户在 GlobalLauncher 搜索到剪贴板 JSON 记录
- **THEN** 可以对该对象执行 format、paste、copy、open in editor 等动作

#### Scenario: 文本输出路由
- **WHEN** 文本插件产生结果
- **THEN** OutputRouter 可将结果复制、粘贴到前台 app、替换编辑器选区、插入编辑器、打开编辑器、附着 panel 或保存到 shelf

## MODIFIED Requirements

### Requirement: GlobalLauncher transient surface
GlobalLauncher MAY still render launcher-invoked transient plugin surfaces in its own frame, but it SHALL NOT be the long-lived workspace for shortcut-invoked plugin tools.

### Requirement: CommandPalette 命名
The legacy `CommandPalette` component SHALL remain as a compatibility wrapper during migration, but internally it SHALL map to `EditorCommandBarHost`.

### Requirement: Launcher surface usage
The system SHALL migrate legacy `command-palette` usage bucket to `editor-command-bar` while preserving existing user ranking data.

## REMOVED Requirements

### Requirement: 主窗口作为默认应用中心
**Reason**: 与“一个全局入口 + 多 Surface”的产品层级冲突。
**Migration**: Settings、插件管理、脚本页、插件编辑器迁移为 Launcher surface 或独立窗口；Editor 迁移为 singleton Editor Window。

### Requirement: 插件快捷键复用 GlobalLauncher surfaceFrame
**Reason**: 会覆盖已有 transient surface，丢失工作现场。
**Migration**: 通过 `shortcutPresentation` 分流到 independent PluginSurfaceWindow。
