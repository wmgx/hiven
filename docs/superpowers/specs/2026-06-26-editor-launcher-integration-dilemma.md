# 编辑器内 Launcher 的设计困境

## 背景

hiven 正在从"主窗口 + 编辑器为核心"转变为"纯托盘 app + launcher 驱动 + 独立窗口"。

新架构下：
- 无主窗口，app 启动后只有系统托盘
- 全局 launcher 是独立的 Spotlight 风格窗口（NonActivating Panel，全局快捷键触发）
- 编辑器是独立的普通激活窗口（从 launcher 命令或快捷键启动）
- 插件（翻译、剪贴板历史等）也可以有独立窗口

## 现状：两套命令面板

当前系统有两个结构相似但定位不同的组件：

| | CommandPalette | GlobalLauncher |
|---|---|---|
| 代码位置 | `src/components/CommandPalette.tsx` | `src/components/GlobalLauncher.tsx` |
| surfaceId | `command-palette` | `global-launcher` |
| 触发方式 | Cmd+K（编辑器内） | 全局快捷键（独立窗口） |
| 展示方式 | 编辑器内 overlay | 独立 Spotlight 窗口 / 主窗口 overlay |
| 命令来源 | 所有注册的 plugin commands | 所有 + launcher items + dynamic items + app launching |
| 额外能力 | 无 | 打开插件 surface、pinned actions、应用启动 |
| 共享基础设施 | LauncherController、ranking、plugin API、param input | 同左 |

两者的核心执行流程一致：搜索 → 选择 → 参数收集 → 执行。

## 困境本质

编辑器独立窗口后，Cmd+K 的定位需要重新确定。问题不只是"在哪渲染"，而是：

**launcher 应该是一个还是两个？如果是一个，它在不同窗口里表现相同还是不同？**

## 方案空间

### 方案 A：统一 launcher，context-aware ranking

```
编辑器内 Cmd+K → 编辑器窗口内弹出 overlay
其他场景全局快捷键 → 独立 launcher 窗口弹出

两者渲染同一个 GlobalLauncher 组件
命令池相同，区别在于 ranking context：
- 从编辑器窗口触发时，有 input slot 的命令权重更高
- 从其他地方触发时，全局命令正常排序
```

**特征：**
- 一套代码、一个命令池、两种 presentation
- 用户体验：无论在哪里搜索，感觉是同一个工具
- 编辑器相关命令通过 ranking 自然浮上来，不需要 scope 声明
- 编辑器内操作不需要跳出窗口

**需要解决的问题：**
- 两个 GlobalLauncher 实例（编辑器 overlay + 独立窗口）是否共享 state？还是各自独立？
- 编辑器内的 overlay launcher 是否也能打开插件 surface？如果能，surface 在哪渲染？
- 如果将来其他独立窗口（翻译插件等）也想有 Cmd+K，是否每个窗口都嵌一个 launcher overlay？

### 方案 B：视觉统一 + 模式切换

```
编辑器内 Cmd+K → overlay 弹出
默认只显示编辑器相关命令
用户输入特殊 prefix（如 >）或按特定快捷键 → 扩大到全局命令池

或反过来：
默认显示全部，输入 @editor → 过滤为编辑器命令
```

**特征：**
- 一个 UI，通过输入行为切换范围
- 类比：VS Code 的 Cmd+P 系列（文件 / > 命令 / @ 符号 / # 搜索）
- 用户不需要两个快捷键，通过 prefix 决定想找什么

**需要解决的问题：**
- prefix 模式增加学习成本
- "默认显示什么"的选择会影响用户对这个工具的心智模型
- 如果默认全部显示，编辑器命令淹没在里面时体验不好
- 如果默认只显示编辑器命令，用户可能不知道还有全局能力

### 方案 C：完全合并为全局 launcher

```
编辑器内 Cmd+K → 也弹出全局 launcher 独立窗口（NonActivating Panel）
编辑器窗口内不再有 overlay
所有操作都在同一个 launcher 窗口中完成
```

**特征：**
- 最简单：移除 CommandPalette 组件，所有触发都走 GlobalLauncher
- 一个窗口、一套 state、一个入口
- 不需要解决 overlay 和独立窗口的差异

**需要解决的问题：**
- 从编辑器"跳出"到另一个窗口，交互上有断裂感
- 如果 launcher 是 NonActivating Panel，执行"对编辑器当前 pane 的操作"时，目标 pane 的状态（选区、光标）可能丢失
- launcher 窗口大小固定，不适合展示编辑器内特有的参数输入（如大段文本预览）
- 如果 launcher 是普通窗口，弹出时编辑器会失焦

### 方案 D：分离但消除割裂感

```
编辑器内 Cmd+K → 编辑器专属命令面板（只有编辑器 scope 命令）
全局快捷键 → 独立 launcher 窗口

两者代码独立、命令池不同
但通过以下方式消除割裂感：
- 视觉风格完全一致（同样的搜索框、列表、交互模式）
- 编辑器命令面板底部有一行提示："按 XX 打开全局搜索"
- 全局 launcher 中也能搜到编辑器命令（但执行时会先聚焦编辑器窗口）
```

**特征：**
- 两套系统但用户能无缝切换
- 编辑器内的体验足够聚焦
- 全局 launcher 不遗漏任何命令

**需要解决的问题：**
- 插件需要声明 scope（开发者负担）
- "从全局 launcher 执行编辑器命令"时，如果编辑器窗口不存在怎么办？
- 维护两套 UI 组件的成本

## 关联的技术约束

1. **NonActivating Panel vs 普通窗口**：全局 launcher 目前是 NonActivating Panel（不夺取焦点），这使得它能在不打断用户工作的情况下弹出。但也意味着它和编辑器窗口的交互有限制（不能直接操作编辑器的 DOM/selection）。

2. **跨窗口 state**：如果 launcher 需要读取编辑器当前的选区/文本来填充 input slot，而两者在不同窗口，需要跨窗口通信（Tauri event 或 shared state）。

3. **现有 CommandPalette 和 GlobalLauncher 的代码重复度约 70%**：核心逻辑（LauncherController、ranking、param input）完全共享，差异主要在 UI 层（overlay vs 独立窗口、surface 打开能力、pinned actions）。

4. **编辑器内命令的典型操作**：格式化文本、翻译选区、切换语言、分屏、跳转行号。这些命令通常需要读取当前 pane 的 selection 或 text。

5. **全局命令的典型操作**：打开插件窗口、启动应用、打开设置、创建新编辑器窗口。这些不依赖编辑器上下文。
