# hiven 项目分析报告

## 一句话定位

**hiven** 是一款跨平台桌面文本处理工具（类似 macOS 上的 Boop），基于插件架构构建，提供格式化、编解码、Diff、剪贴板历史、翻译等文本操作能力，目标是成为开发者的"精确文本工作台"。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Tauri v2 (Rust backend) |
| 前端 | React 19 + TypeScript + Vite |
| 样式 | Tailwind CSS + CSS Variables |
| 状态管理 | Zustand (persist middleware) |
| 编辑器 | Monaco Editor |
| 构建/发布 | GitHub Actions + Tauri Updater |
| 平台 | macOS (arm64/x86_64)、Windows、Linux |

---

## 核心架构

### 双窗口结构

1. **Main Window** — 主编辑器，含侧边栏导航、Monaco 编辑面板、Command Palette
2. **Launcher Window** — 全局浮动 Launcher（类似 Raycast/Alfred），透明无边框，始终置顶

### 视图层次（Main Window）

| 视图 | 功能 |
|------|------|
| EditorView | 主编辑区域 (Monaco)，支持多 Pane 分割 |
| ScriptsView | 已安装插件/脚本列表 |
| PluginEditorView | 用户自定义脚本编辑器 |
| PinnedRunnerView | 固定到侧边的常驻命令（Live Runner） |
| SettingsView | 设置页面 |

### 三层边界设计

```
┌─────────────────────────────────────────┐
│  Framework (workspace/)                  │
│  - plugin registry / command / renderer  │
│  - pane 状态、editor bridge             │
│  - effect runner / surface coordinator   │
│  - settings / i18n / hotkeys            │
├─────────────────────────────────────────┤
│  Kits (kits/)                           │
│  - diff-kit: 纯算法，无状态，无副作用     │
│  - ui-kit: 插件 UI 基础组件             │
├─────────────────────────────────────────┤
│  Plugins (plugins/)                      │
│  - 30+ first-party 插件                 │
│  - 通过 plugin SDK 与 host 通信         │
│  - 独立目录包，无跨插件依赖              │
└─────────────────────────────────────────┘
```

---

## 插件系统

### 内置插件列表（30+）

| 类别 | 插件 |
|------|------|
| 编解码 | base64, url, html, jwt, queryString |
| 格式化 | json, xml, yaml, sql, css |
| 文本处理 | case, count, lineTools, lineAffix, slashes, mdquote |
| 数据转换 | csv, hash, sortJson, sqlin |
| 差异对比 | textDiff (含 JSON semantic diff) |
| 工具 | calculator, date-time-assistant, regex-tester, translate, web-open |
| 剪贴板 | clipboard-history (带 background service) |
| 开发者 | jsFilter |

### 插件协议

- 固定入口文件约定 (`index.tsx` / `index.ts`)
- `manifest.json` 声明 metadata、commands、settings
- 通过 `plugin-sdk` API 与 host 通信
- 支持 i18n (`locales/` 目录)
- 支持 settings schema（runtime 设置面板）
- 支持 background service（如剪贴板监听）

---

## 当前开发重点（从近 50 次提交推断）

1. **Global Launcher 优化** — 搜索排序性能、Object Block 机制、剪贴板内容推荐
2. **插件目录合并** — 从 28 个合并为 16 个更合理的包
3. **web-open 增强** — 正则匹配直开、URL 一步打开、favicon 缓存
4. **插件 Surface Window** — Rust payload store 传参
5. **Diff 插件边界强化** — 移除 framework 中的 diff 语义，下沉到插件
6. **剪贴板历史** — 性能优化、Surface paste 交互

---

## 项目当前版本

`v0.2.57`

---

## 关键设计原则

1. **Framework ≠ 工具能力**：host 只提供容器/调度，具体产品逻辑在插件中
2. **插件独立性**：插件间无运行时依赖，通过 SDK 与 host 通信
3. **Diff 是插件**：text-diff、json-diff 等不是框架能力
4. **Kit 纯算法**：kits 不持有状态、不依赖 framework
5. **多语言强制**：所有 UI 文案走 i18n，禁止 hardcode
6. **Launcher 分离**：Global Launcher 与 App 内 Command Palette 共享语义但 I/O 路径分离

---

## 目录结构概要

```
flux_text/
├── src/
│   ├── App.tsx              # 入口，视图路由
│   ├── store.ts             # Zustand 全局状态
│   ├── workspace/           # Framework 核心（60+ 文件）
│   ├── plugins/             # 30+ first-party 插件
│   ├── kits/                # 共享纯算法 kit
│   ├── components/          # 公共 UI 组件
│   ├── views/               # 5 个主视图
│   ├── hotkeys/             # 快捷键系统
│   ├── i18n/                # 国际化
│   ├── panels/              # Panel 注册
│   └── utils/               # 工具函数
├── src-tauri/               # Rust/Tauri backend
├── scripts/                 # 130+ 测试/验证脚本
├── doc/                     # 设计文档
└── dist/                    # 构建产物
```
