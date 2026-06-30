# 崩溃修复 + 编辑器多实例 设计文档

## 问题一：进程崩溃

### 根因

macOS AppKit/HIToolbox API 必须在主线程调用。当前代码中 `restore_launcher_level` 和 `demote_launcher_level` 直接在 tokio async command 闭包中执行 `objc2::msg_send![setLevel:]`，违反此约束，触发 `EXC_BREAKPOINT`。

崩溃堆栈确认：
- `hide_plugin_surface_window` → `restore_launcher_level` → `setLevel:` (主线程断言失败)
- `prepare_launcher_input_source` → `switch_to_default_english_input_source` → `TISCopyCurrentKeyboardInputSource` (dispatch_assert_queue_fail)

### 修复方案

将所有 NSWindow/HIToolbox 操作统一用 `app.run_on_main_thread()` + `mpsc::channel` 同步包裹。

改动函数：
1. `restore_launcher_level` — 加 run_on_main_thread 包裹
2. `demote_launcher_level` — 加 run_on_main_thread 包裹
3. 抽取 `run_on_main_thread_sync` 辅助函数避免重复代码

---

## 问题二：编辑器多实例

### 当前状态

编辑器窗口标签硬编码为 `"editor"`，Tauri 不允许重复标签，因此只能存在一个编辑器。

### 目标

- 提供 `open_new_editor_window` 创建新编辑器窗口
- 提供 `focus_editor_window(label)` 聚焦已有编辑器
- 提供 `list_editor_windows` 列出所有活跃编辑器
- 无数量限制

### API 设计

| 命令 | 参数 | 返回 |
|------|------|------|
| `open_new_editor_window` | 无 | `{ label: string }` |
| `focus_editor_window` | `label: string` | `()` |
| `close_editor_window` | `label: string` | `()` |
| `list_editor_windows` | 无 | `string[]` |

### 前端适配

- `editorWindow.ts`: 新增 `requestOpenNewEditorWindow()` / `requestFocusEditorWindow(label)` / `requestListEditorWindows()`
- Surface Registry: 已支持多实例，kind=editor 即可
- EditorBridge: 事件增加目标 label，默认发往最近活跃编辑器
- workspaceStore: 按 sessionStorage 天然隔离（每个窗口独立 session）
