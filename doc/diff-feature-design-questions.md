# FluxText Diff 功能设计讨论

## 项目背景

FluxText 是一个**命令驱动的文本处理工作台**（Tauri v2 + React + Monaco Editor）。

核心模型：
```
文本输入 → Action（⌘K 唤起命令面板选择） → 输出结果（替换编辑器内容）
```

当前 UI 结构：
```
┌──┬───────────────────────────────────┐
│S │  Status bar                        │
│i │───────────────────────────────────│
│d │                                   │
│e │     Monaco Editor（单编辑器）      │
│b │                                   │
│a │───────────────────────────────────│
│r │  Bottom bar（输出状态）            │
└──┴───────────────────────────────────┘
```

Sidebar 当前有 4 个视图：Editor / Scripts / Debugger / Settings

技术栈：React + TypeScript + Monaco Editor + Zustand + TailwindCSS

---

## 需求

增加一个 **Diff 对比工具**（类似 git diff / diffchecker），支持用户粘贴两段文本进行逐行差异对比。

**同时要求**：API 设计要有扩展性，让其他 Action 也能程序化地调用 diff 展示能力。

---

## 已确定的点

1. 使用 Monaco 内置的 DiffEditor 组件（零成本，支持 side-by-side 和 inline 两种模式）
2. 先做独立的文本对比工具（不是 Action 前后对比）
3. API 上留扩展口子，未来 Action 可以通过 `ctx.diff.open()` 之类的方式调用

---

## 需要讨论的设计问题

### 问题 1：入口与导航

Diff 工具应该以什么形式融入 FluxText 的导航体系？

| 选项 | 描述 | 权衡 |
|------|------|------|
| A. Sidebar 新增图标 | 与 Editor/Scripts/Debugger/Settings 同级，新增第 5 个视图 | 一级入口，重要性够吗？Sidebar 会不会太多图标？ |
| B. Editor 内的模式切换 | 编辑器顶部加 tab/toggle：`Editor | Diff`，在同一个 view 内切换 | 不增加 sidebar 复杂度，但 EditorView 职责变重 |
| C. Command Palette 入口 | 用户 ⌘K 搜索 "diff" 打开，作为一个特殊的系统 Action | 符合"命令驱动"理念，但第一次使用可能不知道这个能力存在 |

### 问题 2：与现有编辑器的关系

打开 Diff 工具时，当前编辑器里的文本怎么处理？

| 选项 | 描述 |
|------|------|
| A. 完全独立 | DiffView 是全新的两个编辑器，跟主编辑器无关 |
| B. 预填左侧 | 自动把当前编辑器内容填入 diff 的 Original（左侧），用户只需粘贴 Modified |
| C. 可选关联 | 默认空白，但提供一个 "Import from Editor" 按钮 |

### 问题 3：Action 如何调用 diff 能力

当一个 Action 想把结果以 diff 形式展示时，交互应该是什么？

| 选项 | 描述 | 权衡 |
|------|------|------|
| A. 导航跳转 | Action 调用 `ctx.diff.open(original, modified)`，自动跳转到 DiffView | 离开了当前 EditorView，流程被打断 |
| B. 覆盖当前视图 | EditorView 临时切换为 DiffEditor 模式，展示差异，提供"Accept/Dismiss"按钮 | 不离开当前页面，但 EditorView 状态变复杂 |
| C. Action 只返回数据，不控制视图 | Action 返回 `{ text, meta: { diff: true } }` 之类的标记，由系统决定是否展示 diff | 最解耦，但 Action 对展示无控制力 |

### 问题 4：产品定位权衡

FluxText 的原则是"轻、快、简单、即开即用"。Diff 功能是否需要克制？

- 是做一个"最小化但够用"的 diff 工具（只有文本对比 + 差异高亮）？
- 还是做一个功能丰富的 diff 工具（语法高亮、忽略空白、正则过滤、导出 patch）？

---

## 补充上下文

- Monaco Editor 的 `DiffEditor` 组件原生支持：side-by-side / inline 两种展示模式、差异高亮、滚动同步
- 当前 FluxText 的 Action API：`run(ctx) → { text: string }`
- 状态管理用 zustand，视图切换通过 `store.activeView` 控制
- 产品强调"不要做成 IDE"，保持轻量

---

## 期望产出

请针对以上 4 个问题给出推荐方案，以及具体的交互流程描述。重点是：**如何让 diff 功能自然地融入 FluxText 现有的"命令驱动"体验中，而不是强行塞入一个不协调的功能**。
