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
