# 编辑器轻量化 + 去主窗口设计

> hiven 从"主窗口 + 编辑器为核心"转变为"纯托盘 app + launcher 驱动 + 独立窗口"

## 目标形态

```
hiven 运行时架构：
├─ 系统托盘图标
├─ 全局快捷键注册
├─ 插件后台任务
├─ Launcher 窗口（NonActivating Panel，Spotlight 风格）
│    ├─ 搜索 / 命令 / 启动
│    ├─ 系统页面 surface（settings、scripts 等）
│    └─ transient 插件 surface
└─ 独立窗口（按需创建，普通激活窗口）
     ├─ 编辑器窗口（系统组件）
     └─ 插件窗口（plugin surface window）
```

## 核心决策

| 决策点 | 结论 |
|--------|------|
| 应用形态 | 纯托盘 app，无常驻主窗口 |
| 启动行为 | 启动时弹出 launcher 窗口 |
| 编辑器身份 | 系统组件（非插件），通过 launcher 命令或快捷键启动 |
| 编辑器承载 | 独立窗口（普通激活窗口） |
| 编辑器窗口样式 | 无系统标题栏 + 自定义 chrome（拖拽区 + 关闭按钮）+ 可调大小 |
| 编辑器能力 | 完整保留（多 pane、分屏、插件 renderer/panel/toolbar） |
| 编辑器生命周期 | 普通窗口，手动关闭后销毁 |
| 编辑器状态持久化 | 不持久化，每次打开全新（Scratch Pad 模式） |
| 其他视图 | settings/scripts/plugin-editor 变成 launcher 内 surface，通过命令进入 |
| 编辑器窗口实例 | singleton（同时只有一个编辑器窗口） |

## 架构变化

### 之前

```
App 启动 → 主窗口（Sidebar + EditorView + GlobalLauncher overlay）
          → Launcher 独立窗口（全局快捷键触发）
```

### 之后

```
App 启动 → 系统托盘 + 注册快捷键 + 启动后台
          → 弹出 Launcher 窗口
          → 用户通过 launcher 命令/快捷键创建编辑器窗口
          → 用户通过快捷键创建插件窗口
```

## 编辑器窗口设计

### 启动方式

1. Launcher 中输入 "editor" / "编辑器" / 对应命令 → 创建编辑器窗口
2. 全局快捷键（可绑定）→ 创建或聚焦编辑器窗口

### 窗口行为

- 无系统标题栏，自定义 chrome（拖拽区域 + 窗口控制按钮）
- 可调整大小，可自由拖拽位置
- 不失焦隐藏，不超时销毁
- 关闭按钮 / Cmd+W → 销毁窗口
- 再次通过 launcher/快捷键打开 → 全新空编辑器

### 窗口内容

编辑器窗口渲染现有的 EditorView 完整结构：

```
EditorWindow
├─ 自定义 chrome（拖拽区 + 窗口控制）
├─ Editor Topbar（word wrap、查找替换、分割面板等）
├─ WorkspaceShell（Monaco pane(s) + 分屏）
├─ PanelHostV2（插件 panels：left/right/bottom）
├─ CommandPalette（Cmd+K）
└─ StatusBar
```

### 与插件系统的关系

编辑器虽然不是插件，但仍是插件的宿主：
- 插件可以注册 renderer 到 pane
- 插件可以注册 panel 到 editor window
- 插件可以注册 toolbar 按钮
- 插件 commands 可以操作 editor pane 内容
- 这些能力在独立窗口内完整保留

## Launcher 窗口的变化

### 新增的系统命令

| 命令 | 行为 |
|------|------|
| Open Editor / 打开编辑器 | 创建或聚焦编辑器窗口 |
| Settings / 设置 | 在 launcher 内打开 settings surface |
| Plugins / 插件管理 | 在 launcher 内打开 scripts surface |

### Launcher 成为唯一入口

所有功能通过 launcher 命令触发：
- 编辑器 → 独立窗口
- 插件 surface（翻译、剪贴板历史等）→ 独立窗口或 launcher 内
- 系统页面（settings、scripts）→ launcher 内 surface
- 一次性动作（格式化、复制等）→ 直接执行

## 去主窗口的技术要点

### Tauri 配置变更

- 移除 `main` 窗口配置
- `launcher` 窗口成为 app 的唯一初始窗口（或 app 启动后程序化创建）
- 需要确保 app 在没有可见窗口时不退出（macOS: `NSApplicationActivationPolicy.accessory`）

### 入口文件变更

```ts
// main.tsx 简化
const params = new URLSearchParams(window.location.search)
const windowType = params.get('window')

if (windowType === 'plugin-surface') {
  root.render(<PluginSurfaceWindow />)
} else if (windowType === 'editor') {
  root.render(<EditorWindow />)
} else {
  // launcher 窗口（默认）
  root.render(<LauncherApp />)
}
```

### 需要保留的 Rust 侧能力

- 系统托盘创建和菜单
- 全局快捷键注册
- `show_launcher_window` / `hide_launcher_window`
- 新增 `show_editor_window` / `close_editor_window`
- 新增 `show_plugin_surface_window`（Phase 0 已设计）
- 插件后台任务管理
- 插件存储（SQLite + blob）
- HTTP 代理
- 应用发现

### 需要处理的迁移项

| 现有模块 | 迁移方式 |
|----------|----------|
| App.tsx | 移除 MainApp 分支，只保留窗口类型路由 |
| Sidebar.tsx | 移除（launcher 命令取代导航） |
| ViewContent / ViewId 系统 | 移除（各视图各自成为独立 surface） |
| EditorView.tsx | 改为 EditorWindow 的内容组件 |
| GlobalLauncher.tsx（主窗口 overlay 模式）| 移除 overlay 相关逻辑 |
| workspaceStore 持久化 | 移除 persist 配置 |
| CommandPalette | 移入 EditorWindow 内 |
| PluginSettingsDialog | 移入 launcher 窗口 |

## 与 Phase 0（插件独立窗口）的关系

两个方案共享大量基础设施：
- Rust 侧独立窗口创建/管理
- 前端窗口类型路由（URL 参数）
- 普通激活窗口模式
- 窗口居中/定位逻辑

先后顺序由用户安排。两者可以独立实施，也可以一起做。

## 范围限定（本设计不涉及）

- 多编辑器窗口（始终 singleton）
- 编辑器状态持久化/恢复
- workspace 概念（多项目切换）
- 编辑器与插件窗口的 split/tab 布局
