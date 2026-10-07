# hiven

跨平台 **launcher-only 精确文本工作台**：全局唤起 → 识别当前文本 → 推荐并执行动作 → 结果继续处理或回到前台。

灵感来自 [Boop](https://boop.okat.best/)，交互参考 Raycast / Alfred 一类全局入口，但**不做全能 OS launcher**。

## 产品形态

```text
系统托盘（唯一常驻入口）
  → 全局热键 / 托盘 打开 Global Launcher
  → 搜索 / 参数 / 结果（同一 launcher 会话）
  → host surface 原地展开：快捷编辑器 · 设置 · 插件管理
  → 插件独立 surface 窗口（Diff、剪贴板历史、翻译…）
  → 快捷编辑器可 detach 为独立窗口
```

没有持久主工作台窗口，也没有多 pane IDE 工作区。

## 主要能力

- **文本变换插件** — 编解码、格式化、JSON/CSV/YAML、行工具、Hash 等
- **内容感知** — Object Block + accepts/intent ranking（少搜命令全名）
- **Global Launcher** — 算式/时间/URL 即时结果、App/窗口/进程（macOS）、飞书（可选）
- **Quick Editor** — Monaco 快捷编辑，可与 launcher 协作
- **剪贴板历史** — 历史项可回到 launcher 继续处理
- **text-diff 插件** — 双栏文本/JSON semantic 对比（产品在插件内，不在 framework）
- **中英 i18n** · **Tauri v2** · 插件目录扩展

## 明确不做

- 全能桌面 launcher / 文件全局搜索主路径  
- 截图标注、窗管 Widgets、必选 LLM  
- Raycast 扩展商店兼容 / 云同步账号  
- 把 host 做成 code-review IDE  

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + TypeScript + Tailwind + Zustand |
| 桌面 | Tauri v2 |
| 编辑 | Monaco（Quick Editor） |
| 发布 | GitHub Actions + Tauri Updater |

**发布矩阵：** macOS arm64 / x64、Windows x64。Linux 未进正式发布流水线。

## 开发

```bash
npm install
npm run tauri dev
```

质量门禁（PR / main）：

```bash
npm run test:quality-gate
```

## 构建

先安装前端依赖（`npm ci`）。原生构建还需要 Rust/Cargo 和对应系统的构建依赖，例如 Linux 的 GTK / WebKitGTK 开发库；按 [Tauri v2 环境准备](https://v2.tauri.app/start/prerequisites/) 配置当前平台，不以某次构建环境的版本作为项目最低版本承诺。

### 前端产物

```bash
npm run build
```

仅构建 `dist/` 中的前端资源，不编译 Rust，也不生成桌面可执行文件或安装包。

### 本机原生可执行文件

```bash
npm run build:desktop:native        # release
npm run build:desktop:native:debug  # debug
```

两者均由 Tauri 先执行前端构建，再编译当前主机平台的原生程序；`--no-bundle` 跳过应用包、安装包与更新包生成。不会自动启动应用，也不会替其他操作系统交叉编译。

默认产物为 `src-tauri/target/release/hiven` 或 `src-tauri/target/debug/hiven`（Windows 为 `hiven.exe`）；设置了 `CARGO_TARGET_DIR` 等 Cargo 配置时，以构建日志中的产物路径为准。

### macOS 应用包与发布

```bash
npm run build:desktop
npm run build:desktop:debug
```

这两个原有命令固定生成 macOS `.app` / `.dmg`，沿用现有签名配置，并关闭 updater artifacts；不适用于 Linux / Windows。本机只检查原生构建时，使用上面的 `build:desktop:native` 系列。

正式发布仍由 [Build & Release](.github/workflows/build.yml) 按 macOS arm64 / x64、Windows x64 矩阵生成发布与更新产物。Linux 尚未进入正式发布流水线。

### 验证范围

原生构建通过只说明当前主机的编译与链接成功，不代表 GUI、全局快捷键、系统托盘、前台应用交互或全部平台已经验收。这些运行行为需要在对应桌面系统中另行验证。Linux 当前不支持模拟粘贴回前台应用，不能以构建成功视为该能力可用。

## 文档

- 产品：`PRODUCT.md`
- 设计 token / surfaces：`DESIGN.md`
- 架构冻结与收敛：`doc/2026-08-09-architecture-freeze-and-convergence.md`
- 能力全景：`doc/2026-08-09-system-capability-and-redesign-brief.md`

## 致谢

- [Boop](https://boop.okat.best/) — 文本工作台灵感  
- [Tauri](https://tauri.app/) — 跨平台桌面框架  
