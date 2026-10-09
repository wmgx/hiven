# 全局快捷键注册占用边界

## 修复的问题

应用快捷键、Quick Editor 和插件 surface 使用同一个原生快捷键注册表。过去 Quick Editor / surface 发现目标键已注册，会先注销它再注册自己，导致应用设置仍显示启用，实际按键却进入另一入口；原应用随后删除绑定时，还会注销新入口。

现在 Quick Editor / surface 仅清理本模块记录的成功注册。`isRegistered` 只能证明已占用，不能证明归自己所有：

- Quick Editor 遇占用返回 `Registration failed`，Settings 使用双语占用提示。
- Surface 遇占用返回 `conflict`，插件详情中的快捷键旁显示双语提示；原生注册异步失败也显示本地化失败提示。
- 两者都不再注销非本模块持有的占用键，原 owner 的回调和注册继续有效。
- 保留自有键替换 / 重同步、Global Launcher 保护和过期 generation 的成功注册清理。异步检查过期后不再注册，surface 的过期失败也不会覆写新状态。

## 验证

`npm run test:shortcut-ownership-runtime` 已接入 quality gate。测试加载实际三个 registrar、Zustand store、插件 registry 和 i18n；仅快捷键 native API、窗口路由等外部边界使用 stub。所有 registrar 共享同一个 native owner 表，覆盖：

- 已有应用键拒绝 Quick Editor / surface 接管，应用配置及持久化不变，原回调仍打开应用。
- Quick Editor 与 surface 互相拒绝，应用快捷键也无法接管其占用；被拒方卸载不会删除原 owner。
- 独立键分别进入应用、Quick Editor、surface 独立窗口；移除应用键不影响其他入口。
- 自有键仍可替换 / 重注册，已注册的 Global Launcher 键继续受保护。
- 原生注册在检查后输掉竞争时，不会清理胜出方；过期占用检查不注册旧键；卸载后的晚成功仅清理自己刚取得的键。
- 占用与原生失败提示的中英文映射。

本次还运行了现有应用运行时、Quick Editor、surface、Global Launcher 设置及录制器回归，并各运行一次 typecheck、architecture 和 build。

## 范围

此保证针对正常启动的应用生命周期及协作 registrar 的所有权边界，不是恶意插件 JavaScript 沙箱，也不保证所有操作系统 / 第三方应用的冲突都能提前检测。外部注册竞争仍可能由 native `register` 以失败返回。

未扩大 Quick Editor / surface 的配置事务：编辑到冲突键时，旧自有键仍可能已被释放，恢复旧配置需重新录制。未重构既有的卸载后排队回调、跨生命周期所有权或注销失败重试机制。

测试未注册真实 OS 快捷键，未读写用户数据，未运行 GUI / headless / local URL。浏览器和桌面实际注册与可见布局未验证。

## 切换语言时的受控重载

原生快捷键注册表属于应用进程，刷新 webview 不会清理旧 JS Channel。原先设置页先保存语言、再直接 reload，四个 registrar 的内存 owner 记录会丢失，下一页无法重新注册相同键。

语言切换现在先暂停这四个 registrar 的订阅和回调，等待各自排队中的注册完成，再只清理该页明确持有的键。全部成功后才保存语言并 reload；不使用 `unregisterAll`，也不以 `isRegistered` 作为其他键的清理授权。保留重载是为了重新初始化 Monaco NLS 和插件启动 context。

清理失败时保留当前页面及语言，并恢复所有 registrar。原生持续拒绝注销的自有键保留 owner/token，只重新激活原回调；已清理的键正常重新注册。持久化或 reload 抛错时，仅回滚本次语言值，不覆盖准备期间出现的新语言值。界面显示中英文失败提示，可以重试。普通 React cleanup 仍同步返回，受控 reload 单独等待异步清理；并发 reload 请求不能绕过正在进行的清理。

`test:shortcut-ownership-runtime` 复用真实 registrar 和 store，扩展覆盖三次新页面模块重建、在途注册/注销、四种 owner 分别持续注销失败及恢复、其他 owner 不受影响、语言提交时机与较新值保护。普通应用快捷键保存事务仍由 `test:app-hotkeys-runtime` 回归。

范围仅包括应用设置触发的受控语言重载；DevTools 强制刷新、崩溃或任意外部导航不在本次修复范围。Linux 的 `Cmd`/`Command` accelerator 显示为 `Super`，Windows 显示为 `Win`；`Ctrl` 仍显示 `Ctrl`，双击 `Command` 的既有非 macOS `Ctrl` 含义保持不变。

## 本轮 Linux 桌面复验

官方构建的真实界面已验证：同一进程内中文切英文后，使用 Esc 隐藏，再用原 Shift+Super+Space 连续两次唤起；英文切回中文后再次成功。设置中显示 Super 与已注册状态。该结果覆盖设置页主动切语言，不推断任意强制刷新或其他平台。

同批修复了两处已在真实界面复现的键盘状态问题：材料移除按钮获焦后 Enter/Space 只移除材料，搜索中的 Enter 仍正常选择工具；清理行列表在预览确认去重后返回参数页，会选中本次确认值，再次 Enter 保持结果。最终桌面包对这两条路径复验通过。参数页状态和过期回调另由真实 controller 合成回归覆盖。

代表性合成材料流程还覆盖 JSON 改参取消/确认、保存操作处理新材料、设置往返保留材料、链接提取以及 X11 自动上屏。未验证实际账号登录、模型生成、Wayland、中文拼音组合或全部无障碍要求；界面小号辅助文字的可读性仍有改进空间。
