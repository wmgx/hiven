# 应用快捷键设置失败恢复

## 问题与处理

原设置回调先写入 Zustand/persist，registrar 再注销旧快捷键，然后尝试新键。若新键被 Launcher 等占用，注册流程静默跳过，导致列表显示新键、旧键也失效。

设置现经 `saveAppHotkey`：先确认原生注册，再提交实际 `setAppHotkey`，提交成功后释放旧键。占用、原生拒绝或保存异常会返回明确失败，设置页显示系统 i18n 的中英文 Toast，保留录入草稿以供修改和重试。只有成功提交才清空草稿。

同一应用修改快捷键不提前销毁旧键；将已有应用键转给另一个应用时复用该原生注册并更新路由，保留现有 upsert 的转移语义。正常化的 accelerator 别名在 persistence 与 registrar 使用同一规则。

Zustand persist 先发布内存、再写 storage。`setAppHotkey` 同步捕获本次 next 数组；storage 抛错时，仅在当前数组仍严格等于本次 next 时还原之前的应用快捷键数组，因此能恢复转移时被移除的另一行，同时保留其它设置。若同步订阅已经产生更新的数组，旧失败不会回滚它。原生路由只在保存成功后切换。

## 并发与生命周期

- 保存捕获当前列表引用、保存序号、安装生命周期以及设置页编辑版本。等待 native 期间的新编辑、删除或关闭使旧请求过期；新注册会释放，不会写入旧配置或清掉新草稿。
- 安装、同步、保存和卸载共用顺序队列。卸载的清理在进行中的 native 请求之后、下一次安装之前执行，迟到注册也会清理。
- 快捷键回调核对安装生命周期、注册对象、当前路由与应用是否仍启用；删除或旧生命周期的回调不能打开应用。动态 import 完成后再次核对，防止等待加载期间发生删除。
- 注销异常会禁用该路由并保留 ownership 供后续同步/生命周期清理重试，不会将失败清理误认为成功。

## 范围与边界

生产 AppHotkeysSettings 与 installAppHotkeys 均在 launcher App 窗口，复用已有 Toast。没有新增跨窗口状态总线或重写全局快捷键系统。

本次事务入口是设置 UI。其它调用方直接写 `appHotkeys` 或 hydration 时，registrar 注册失败也会反馈并保留原来的可用原生绑定，但不会擅自重写这些调用方已提交的配置。启动时没有旧绑定的失效配置只报告错误，不会虚构已注册状态。没有更改 Launcher/Quick Editor 自身的注册策略，也不保证第三方进程随后抢占快捷键后的持续有效性。

## 验证

`npm run test:app-hotkeys-runtime` 合成真实 registrar、Zustand store、persist、中英文 locale 和 Toast，仅 native I/O 使用 stub。覆盖冲突、注册拒绝与重试、应用间转移、storage 写失败及同步订阅重入、较新编辑/删除、迟到注册、卸载重装和过期 callback。该测试接入 quality gate 和 refactor suite。

AppHotkeysSettings 的真实 TSX 回调另外通过临时受控 hook harness 检查草稿保留、成功清空、编辑中的迟到完成和卸载。此证据不作为永久 UI 单元测试。

没有使用 GUI、headless 浏览器、localhost 页面或真实 native 注册；以上检查不替代操作系统快捷键集成验证。
