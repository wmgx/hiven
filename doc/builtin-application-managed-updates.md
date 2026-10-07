# 内置功能随应用升级

内置插件通过 `bundledPluginLoader` 的编译期模块注册并执行。`plugins/builtin` 中释放的源码用于查看和开发；单独下载新源码不会替换当前应用中的实现。

本次以真实 Vite 模块、注册表和 JSON 格式化 runner，配合受控原生 I/O 复现了旧行为：远端包声明 `json-tools` 99.0.0、`shell.exec`，旧检查入口进行了 4 次抓取和 1 次目录替换并返回 `updated: true, version: 999`。但实际执行仍为编译版本 2.5.5、`clipboard.write`，注册对象和格式化输出没有变化。

修复后的边界：

- 旧公开入口 `checkBuiltinPluginsUpdate()` 返回 `{ status: 'application-managed', updated: false }`，不进行原生、网络或文件操作。
- 设置页 compact/full 都仅调用应用 updater，并始终显示中英文“内置功能随应用升级”。应用检查、下载、安装、失败后重试和重启路径继续使用原 updater；compact/full 均显示实际检查结果、错误摘要和错误复制。
- 内置列表的版本、权限、名称、能力和入口来自编译 metadata；桌面模式保留规范释放目录路径。内置磁盘 manifest 不再参与运行版本展示。
- 原有源码释放流程和外部插件更新实现保持不变。

## 验证

`npm run test:builtin-application-updates` 已接入 quality gate，执行实际内置加载器、注册表、旧更新入口及外部插件检查，验证 native/browser 中重复检查无 I/O、较新磁盘 metadata 不覆盖执行信息、全部 18 个内置 summary 与注册权限一致，以及外部 GitHub 插件仍能发现更新。`npm run test:builtin-plugin-release` 继续覆盖首次释放、版本变化、失败重试和并发写入。

本轮另以一次性受控 hooks harness 执行真实 Settings TSX 的回调和返回元素树，检查中英 compact/full 的 idle、checking、no-update、check error/retry、download error/retry、ready/restart 及常驻说明。该检查不作为永久 UI 单测，也不等同于真实 GUI 验证；本环境没有执行真实 GUI 或 headless 浏览器路线。

`check:typecheck`、`check:architecture`、`build` 和 `git diff --check` 通过。旧 `test:plugin-package-lifecycle` 仍在不相关的卸载刷新源码断言处失败；以基线原始文件受控执行确认同样失败，本次未扩展修改该历史检查。
