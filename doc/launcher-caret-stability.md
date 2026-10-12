# Launcher 搜索光标稳定性：原生尺寸更新

## 代码因果证据

用户反馈 macOS 搜索时输入光标消失。本次先只读检查普通搜索链，没有预设 React 重挂载或 IME 是根因：

- `GlobalLauncherSearchFrame.tsx` 的查询输入没有 query/result 动态 key，`onChange` 直接同步更新原始 query。
- `useLauncherSession.ts` 异步结果合并更新候选与列表 selectedIndex；该 index 是结果高亮，不是输入 selection range。普通结果更新未调用输入 focus 或 selectionRange。
- `GlobalLauncherWindowLifecycle.ts` 在可见结果数量变化后计算高度；高度改变会发 `configure_launcher_window`，普通搜索的 `resizable` 始终为 false。
- 修改前 `src-tauri/src/lib.rs` 的该命令无条件调用 `window.set_resizable(request.resizable)`，即使只是高度变化。
- `src-tauri/Cargo.lock` 锁定 **tao 0.35.2**。本地已安装的实际依赖源码 `tao-0.35.2/src/platform_impl/macos/window.rs::set_resizable` 即使布尔值未变，也调用 `set_style_mask_sync`。
- 同版本 `src/platform_impl/macos/util/async.rs::set_style_mask` 明确执行 `ns_window.setStyleMask(mask)`，随后 `ns_window.makeFirstResponder(Some(ns_view))`。因此这个 setter 不是无副作用的幂等赋值。
- Wry 的 `src/wkwebview/mod.rs::new_ns_view` 将 WKWebView 放进原生容器；项目已有 `launcher_first_responder_target` 专门寻找实际 WKWebView，避免父 NSView 取得 responder 后出现 DOM activeElement 仍是输入、但原生光标/键盘不可用的状态。重复样式 setter 会绕过这一选择。

这是与搜索更新直接相连的原生 responder 变更证据；尚未在 macOS 上实测，不把 Linux DOM 焦点验证当成 macOS 修复确认。

## 最小改动

`configure_launcher_window` 先读取实际 `window.is_resizable()`，仅与请求不同才调用 setter；读取失败直接返回原错误，不猜测模式或强制聚焦。高度、最小尺寸、会话/版本过期防护和真正的可调整大小模式切换保持原行为。

该命令没有 always-on-top 或 decorations setter。独立的打开/关闭 reset 路径发生在窗口生命周期边界，未泛改。真正模式切换仍会执行必要的 setter；本次只消除普通搜索异步结果更新导致的重复副作用，不加入每次输入 force-focus、重新设光标末尾、轮询或 IME 特判。

## 验证与边界

`node scripts/test-global-launcher-window-height.mjs` 已通过，现有尺寸/会话契约增加了 fallible 状态读取后才允许 setter 的约束，防止尺寸请求再次无条件重设样式。`git diff --check` 通过。

主集成流程负责原生构建与合成文本交互。仍需 macOS 确认搜索结果数量变化前后实际 firstResponder、输入中间位置继续键入和物理 IME；不声称已完成这些验证。

集成验证：Linux 原生构建通过；真实 X11 桌面连续键入窗口搜索，等待异步结果和尺寸更新，再在中间插入/删除、保留选区后替换、清空并重新输入，均逐步核对 activeElement、selectionStart/End 与完整输入值。没有注入组合事件，也未将该结果称为 macOS IME 验收。独立审查确认锁定 Tao/Wry 的原生 responder 因果与最窄 guard 边界。
