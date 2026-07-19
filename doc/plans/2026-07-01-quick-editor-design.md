# Quick Editor 设计文档

> **日期**: 2026-07-01
> **状态**: 设计确认

## 产品定位

Quick Editor 是绑定在 Global Launcher 浮窗内的全功能编辑器模式。随叫随到，关掉内容保留。

核心理念：一个浮窗，两种形态，零切换成本。

## 核心形态

### 与 Global Launcher 的关系

- 共享同一个 Tauri 浮窗，通过 toggle 切换 Launcher / Editor 两种模式
- 两种模式各有独立的全局快捷键
- 与 Editor Window 平级存在，互不干扰

### 与 Editor Window 的关系

- 平级入口，各有独立快捷键
- Quick Editor 有自己的持久内容（单页），和 Editor Window 的 workspace pane 完全独立
- Editor Window 定位为"多 pane、大面积、长时间工作"场景

### 内容特征

- 单页，无 tab
- 关闭浮窗内容自动保留（持久化到本地）
- 混合用途：临时草稿 + 片段暂存

## 交互设计

### 唤出逻辑

| 操作 | 效果 |
|------|------|
| `全局热键 A`（现有） | 唤出/关闭 Launcher 模式（搜索条形态） |
| `全局热键 B`（新增） | 唤出/关闭 Editor 模式（编辑面板形态） |
| 浮窗在 Launcher 模式时按 `热键 B` | 动画放大切换到 Editor 模式 |
| 浮窗在 Editor 模式时按 `热键 A` | 动画缩回切换到 Launcher 模式 |
| 任一模式下再按自己的热键 | 关闭浮窗（toggle） |

### 模式切换动画

- Launcher → Editor：窗口从中心向外扩展（约 680×60 → 720×480）
- Editor → Launcher：反向收缩
- 内容区域交叉淡入淡出（编辑器 ↔ 搜索框）
- 动画时长 200-250ms，easing: ease-out

### Editor 模式交互

| 操作 | 效果 |
|------|------|
| 打开 | 聚焦编辑区，直接打字 |
| `⌘K` | 浮出命令搜索覆盖层，可对当前文本/选中文本执行命令 |
| `Esc` | 有覆盖层→关闭覆盖层；无覆盖层→关闭浮窗 |
| 点击浮窗外（blur） | 关闭浮窗 |
| 关闭 | 内容自动持久化，无需手动保存 |

### Detach 为独立窗口

- Editor 模式下提供操作（快捷键或按钮）可 detach 成独立窗口
- Detach 后浮窗回到 Launcher 模式
- 独立窗口关闭后内容回归浮窗 Editor（同一份持久数据）

## 技术方案

### 编辑器能力

- 完整 Monaco 编辑器，与 Editor Window 的 pane 能力一致
- 语法高亮、行号、多光标、查找替换、代码折叠
- 语言模式可切换（通过 `⌘K` 命令）
- 不启用 minimap（浮窗面积有限）

### Monaco 实例管理

```
首次切换到 Editor 模式 → 懒加载创建 Monaco 实例
后续 toggle            → show/hide + resize（不销毁不重建）
浮窗关闭              → 实例保留在内存（Tauri 窗口 hide 而非 close）
```

### 持久化

- 独立的 Zustand store，与 workspace pane store 分离
- 存储层复用现有 localStorage / 文件持久化方案
- 保存内容：文本、光标位置、语言模式、滚动位置

### `⌘K` 命令集成

- 复用现有 launcher controller
- 新增 host: `quick-editor-command`
- 能力范围：text input 类命令（与 `editor-command-bar` 能力对齐）
- 执行结果（text.replace effect）作用于 Quick Editor 内容

### 窗口尺寸管理

```
Launcher 模式: ~680 × 动态高度（搜索条 + 列表）
Editor 模式:   ~720 × 480（可拖拽调整）
Detach 窗口:   独立尺寸，可自由调整
```

## 插件边界

- Quick Editor 是 **framework 能力**（workspace 层），不是插件
- 它是 Global Launcher 浮窗的内置模式
- 插件通过 `⌘K` 命令对 Quick Editor 内容执行操作
- 对插件透明——插件不感知"当前在 Quick Editor 还是 pane"

## 明确不做

- ❌ 多 tab / 多页管理
- ❌ 与 Editor Window workspace pane 共享状态
- ❌ 文件系统关联（不绑定文件路径）
- ❌ 协同 / 同步 / 云端
- ❌ 富文本
- ❌ 分屏

## 未来可能扩展（现在不做）

- 多页 / 片段收藏夹
- 内容同步到 Editor Window pane
- 历史版本 / undo 跨会话保留
- 固定在屏幕边缘（slide-over 模式）
