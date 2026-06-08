# 全局固定命令启动器设计

## 背景

FluxText 已有应用内 `GlobalLauncher`，当前由窗口内 `Cmd/Ctrl+Shift+K` 触发，展示固定命令、最近命令和视图入口。这个能力不能在应用失焦时收到按键，也不满足“只显示被 pin 的命令”的新需求。

本设计新增一个可配置的系统级快捷键入口，用于在应用不在前台时唤起窗口，并打开只包含固定命令的启动器。选择固定命令后，应用自动切换到对应的 pinned runner 界面。

## 目标

- 设置页可以配置全局唤起快捷键。
- 快捷键支持普通组合键，也支持 `Double Cmd`。
- 应用不在前台时，命中快捷键可以唤起窗口。
- 唤起后打开命令面板样式一致的 pinned-only 启动器。
- pinned-only 启动器只显示被 pin 的命令，不显示 recent commands 和 workspace views。
- 选中固定命令后调用现有 `openPinnedAction(pinnedId)`，切换到对应 pinned runner。

## 非目标

- 不改变普通 `Cmd+K` 命令面板。
- 不改变 pinned runner 的运行模型，不在选择后自动运行命令。
- 首版只保证当前 macOS 开发环境下的 `Double Cmd` 系统监听。
- 不为 Windows/Linux 实现双击修饰键监听；这些平台可继续使用普通组合键。

## 交互设计

`GlobalLauncher` 复用现有视觉和键盘交互，但增加模式：

```ts
type GlobalLauncherMode = 'full' | 'pinned-only'
```

应用内入口可以继续打开 `full` 模式；系统级快捷键入口打开 `pinned-only` 模式。`pinned-only` 模式只构造 `pinnedActions` 列表，保留搜索、上下键、回车、点击选择和 Escape 关闭。选择项后关闭启动器并调用 `openPinnedAction`。

如果没有固定命令，面板显示空状态，引导用户先在普通命令面板里 pin 命令。

## 配置模型

快捷键配置放入现有 Zustand persist 的 `settings`：

```ts
type GlobalPinnedLauncherShortcut =
  | { enabled: true; type: 'accelerator'; accelerator: string }
  | { enabled: true; type: 'double-modifier'; modifier: 'Meta'; thresholdMs: number }
  | { enabled: false; type: 'disabled' }
```

首版使用单一快捷键模型：同一时间只启用一种触发方式。设置页新增 Hotkeys 卡片，提供录制普通组合键、选择 `Double Cmd`、禁用快捷键和显示注册状态。

配置变化后，前端调用 Tauri command 重新注册监听，不要求用户重启应用。

## 系统监听

普通组合键使用 Tauri global shortcut 插件注册。命中后后端或插件事件转发给前端，统一打开 pinned-only 启动器。

`Double Cmd` 在 macOS 当前系统上由 Rust 侧监听系统键盘事件实现。监听器记录 Command 键单独按下/释放的时间，两次有效点击落在阈值内时触发。以下情况不触发：

- 两次点击间隔超过阈值。
- 点击过程中夹杂其他非 Command 按键。
- Command 与其他修饰键或字符键组合使用。

命中后，后端先让主窗口 show、unminimize、focus，再向前端 emit 打开 pinned-only 启动器的事件。

## 错误处理

系统监听可能因为权限或系统 API 失败而不可用。注册失败时：

- 保存的配置不丢失。
- 设置页展示明确错误状态。
- 不静默降级为应用内快捷键。
- 如果普通组合键仍可注册，用户可以在设置页切换到普通组合键。

macOS double Cmd 如需要辅助功能权限，设置页应提示用户授权后重试。

## 验证

前端验证：

- pinned-only 模式只显示 `pinnedActions`。
- 搜索、键盘选择和点击选择都能打开对应 pinned runner。
- pinned-only 模式不显示 recent commands 和 workspace views。
- full 模式保持现有行为。

配置验证：

- 快捷键配置可保存并在刷新后恢复。
- 切换普通组合键、Double Cmd、禁用三种状态会触发重新注册。
- 注册错误会展示在设置页。

Tauri 验证：

- 普通组合键在应用失焦时可以唤起窗口。
- double Cmd 在阈值内触发，超时和夹杂其他按键不触发。
- 后端触发事件后，前端打开 pinned-only 启动器。

## 风险

- macOS 底层键盘事件监听可能需要辅助功能权限，开发和分发环境的权限表现可能不同。
- Tauri global shortcut 插件和自定义监听都可能竞争同一快捷键，需要配置变更时先注销旧监听。
- 系统级监听要避免重复触发，尤其是窗口 focus 之后前端 keydown 监听再次响应。
