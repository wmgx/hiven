# 云环境官方 AppImage 验证

本次仅修任务级依赖与打包配置，没有改产品源码、官方 AppRun/WebKit 或安全设置。Tauri CLI 为 2.11.1，使用其官方 linuxdeploy 与 GTK 插件。

## 单一库路径

CLI 的 `src/interface/rust.rs::pkgconfig_utils::get_library_path` 强制 `PKG_CONFIG_ALLOW_SYSTEM_LIBS=1`，调用 `pkg-config --libs-only-L`，再将输出去掉开头 `-L` 后整体作为目录。混用 workspace 与系统 prefix 会返回两个 `-L` 项，进而拼成不存在的 appindicator 路径；仅取消外部变量不能修复。[对应官方源码](https://docs.rs/crate/tauri-cli/2.11.1/source/src/interface/rust.rs)

本次工作目录为 `/workspace/hiven-native`：APT 使用独立 state/cache/source 目录和系统 Debian archive keyring，下载官方签名源的软件包，只做 `dpkg-deb --extract`，不执行维护脚本。Rust 也安装在此目录。编译依赖和已存在系统运行库在用户目录形成正常布局。

打包用的 `.pc` 元数据统一指向 `/workspace/hiven-native/root/usr/lib/x86_64-linux-gnu`；该目录补齐已有系统 GTK、GDK Pixbuf、GIRepository、GIO 模块及所需运行库。`LD_GTK_LIBRARY_PATH` 也设为这个单目录。确认强制 system-libs 模式下 appindicator 的 `--libs-only-L` 只返回一个路径后才打包。

Tauri bundler 默认只从系统目录寻找 WebKit 子进程，所以使用支持的 `bundle.linux.appimage.files`，将用户目录的 `webkit2gtk-4.1` 目录收集到包内标准 `/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1`。没有修改 WebKit 的编译路径或二进制。

```bash
. /workspace/hiven-native/env.sh
export PKG_CONFIG_PATH=/workspace/hiven-native/unified-pkgconfig
export LD_GTK_LIBRARY_PATH=/workspace/hiven-native/root/usr/lib/x86_64-linux-gnu
export XDG_CACHE_HOME=/workspace/hiven-native/cache
export APPIMAGE_EXTRACT_AND_RUN=1
node_modules/.bin/tauri bundle --debug --ci --bundles appimage --no-sign \
  --config /workspace/hiven-native/bundle-config.json --verbose
```

此命令复用已有 native/dist，不触发前端重建。关闭 updater artifact 是本地验证配置，不用于发布。

## 隔离与原生自动化

产物旁建立同名 `.AppImage.home` 和 `.AppImage.config`，由官方 AppImage 便携模式设置应用 profile；没有自行改 HOME 或包装 AppRun。[官方便携模式](https://docs.appimage.org/user-guide/portable-mode.html)

`APPIMAGE_EXTRACT_AND_RUN=1` 使用 AppImage 支持的提取执行模式。Xvfb 提供 X11 显示，官方 tauri-driver 调用 WebKitWebDriver，`tauri:options.application` 直接指向 AppImage。未关闭 WebKit 沙箱，未使用挂载隔离、二进制补丁或 mock native provider。

实际启动成功后，完整原生验证与范围记录在 [History 两条全文对比](history-two-text-compare.md#原生补验2026-10-11)。该环境的工具、任务配置和证据留在 `/workspace/hiven-native/`；它们不是仓库构建依赖，不要求其他开发者采用此目录。
