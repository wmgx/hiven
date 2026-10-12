# 原生平台条件编译修正

本次只调整编译边界：删除队列模块未使用的 `Manager` 导入，将剪贴板扩展导入及队列目标常量限定为 Linux；将 X11 搜索请求及其释放实现限定为 Linux。其它平台保留带 launcher 来源检查的无操作释放命令，不再反序列化无用的 X11 token。公共搜索会话返回类型保留。

顺序粘贴仍仅支持 Linux X11。macOS 窗口搜索继续走原平台实现。本次不启用任何新平台能力，也未使用整体 `allow` 或 `cargo fix`。

## 验证

- Linux 原生构建通过；队列与 X11 窗口模块 Rust 测试、History 队列宿主交接测试通过。
- 隔离合成资料的真实桌面验证：窗口搜索退出再搜索；跨搜索选择两条后启动队列；自身窗口拒绝投递且剪贴板不变；取消、重新启动和再次取消。记录设置保持暂停，结束恢复原隔离 profile。
- 独立静态审查未发现平台分支回归。环境没有 Apple SDK，未进行 macOS 原生编译或交互验收。
- 两个未改动的旧 JS 检查存在既有阻塞：`test:linux-window-search` 的面板导入桩缺少 `../../plugin-ui`；`test:desktop-window-process-contract` 仍按旧 `getEmptyQueryTopApps` 名称匹配源码。未为通过断言修改产品代码。

## 队列入口后续建议

当前按钮提示仅支持 Linux X11，点击后才显示平台不支持。原生已有 `get_history_queue_availability`，但插件的受限队列桥接尚未公开平台可用性，`getStatus()` 仅提供运行状态。后续可在该桥接中增加只读能力查询，复用按钮和状态区预先说明不可用；加载失败不得误判为可用，提交时仍需重新检查。不能只按 macOS 判断，因为 Wayland 也不支持。本次未修改 UI 或实现 macOS 队列。

## 开发启动依赖

`colorjs.io` 已在清单声明 `^0.7.1`，锁文件锁定 `0.7.1`。若 Vite 报无法解析，先检查 `git diff -- package.json package-lock.json` 并保留本地修改；清单和锁文件一致时，在仓库根执行 `npm ci` 后重新启动。无需单独添加依赖，也不要重置源码。Rust 已启动不代表前端依赖已齐全。
