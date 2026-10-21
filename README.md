# hiven

**更懂你的 macOS 全能 launcher。** 一个热键唤起，搜应用、切窗口、算一下、查一下、处理手上的内容；AI 负责听懂你想做什么，把你带到对的能力上。

交互参考 Raycast / Alfred，不同在于：hiven 先看你**当下手上是什么、正在做什么**，再决定给你什么。

## 「懂你」从哪里来

| 来源 | 含义 |
|------|------|
| 当下上下文 | 前台应用、选中文本、剪贴板、浏览器当前页 |
| 内容识别 | JSON、URL、时间戳、JWT、Base64… 识别出来就直接给出可用动作 |
| 意图理解（AI） | 自然语言或模糊输入，由 AI 映射到已有能力并带上参数 |
| 你明确设定的偏好 | 收藏、别名、默认参数、快捷键 |

## AI 融合原则

1. **本地确定性优先**：能本地算出来的（计算、换算、格式化、应用搜索）不走 AI。
2. **AI 做理解和兜底，不做主路径**：本地无结果或输入是自然语言时才调用，且不阻塞首帧和本地结果。
3. **AI 是可选的**：不配置任何 AI，hiven 仍是完整可用的 launcher。
4. **发出去的内容可见**：哪些内容会发给 AI，在调用前就清楚。
5. **不替你执行有副作用的操作**：AI 只推荐，粘贴、删除、打开外部应用由你确认触发。

## 产品形态

```text
系统托盘（唯一常驻入口）
  → 全局热键打开 Global Launcher
  → 搜索 / 参数 / 结果（同一 launcher 会话）
  → host surface 原地展开：快捷编辑器 · 设置 · 插件管理
  → 插件独立 surface 窗口（Diff、剪贴板历史、翻译…）
```

没有持久主窗口。唤起和关闭不改变原前台应用状态。

## 主要能力

- **启动与切换** — 应用（含别名）、窗口、进程、系统命令
- **即时结果** — 算式、单位换算、时间与时区、URL
- **内容处理** — 编解码、格式化、JSON/CSV/YAML、行工具、Hash、文本对比
- **剪贴板历史** — 历史项可回到 launcher 继续处理
- **浏览器** — 打开网址、站点搜索、浏览器标签
- **AI** — 翻译、写作、意图理解；支持 Codex、xAI、Ollama
- **快捷编辑器** — Monaco 单编辑器，可 detach
- **插件** — 能力以插件目录交付；中英 i18n

## 明确不做

- 工作流 / 自动化编排
- 文件全局搜索
- 第三方插件分发与市场（插件能力保留，暂不开放）
- Windows / Linux 正式支持（当前只面向 macOS）
- 截图标注、窗口布局管理、云同步账号
- 把 host 做成 code-review IDE

## 性能底线

launcher 是高频入口：唤起首帧 p90 < 120ms；本地结果不等待任何网络或 AI 请求。埋点见 `doc/launcher-perf-telemetry.md`。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + TypeScript + Tailwind + Zustand |
| 桌面 | Tauri v2 |
| 编辑 | Monaco（Quick Editor） |
| 发布 | GitHub Actions + Tauri Updater |

**目标平台：** macOS（arm64 / x64）。发布流水线仍会产出 Windows x64，但不做产品验收；Linux 未进流水线。

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

- [Boop](https://boop.okat.best/) — 最初的文本工具灵感  
- [Tauri](https://tauri.app/) — 跨平台桌面框架  
