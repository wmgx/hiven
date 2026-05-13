# FluxText — 产品设计与架构文档（MVP）

# 1. 项目定位

FluxText 是一个：

```text
命令驱动的文本处理工作台
```

面向：

- 非程序员
- 办公用户
- 内容编辑人员
- 开发者
- 高频文本处理用户

核心模型：

```text
文本输入
→ Action
→ 输出结果
```

FluxText 的目标：

- 拥有命令行级别的效率
- 保持 GUI 工具的易用性
- 提供极快的文本处理反馈
- 构建可扩展的 Action 生态

FluxText 不是：

- IDE
- 自动化平台
- 低代码系统
- ETL 工具

它本质上是：

```text
一个轻量级文本 Action Runtime
```

---

# 2. 核心用户体验

典型流程：

```text
粘贴文本
→ 打开命令面板
→ 搜索 Action
→ 配置参数
→ 执行
→ 立即得到结果
```

示例：

```text
dedup
json formatter
extract urls
case convert
```

---

# 3. 产品理念

## 3.1 Action First

FluxText 的核心是：

```text
Action
```

而不是：

```text
Command
```

Command 只是 Action 的一种调用方式。

未来 Action 可以被：

- Command Palette
- Toolbar
- Hotkey
- Workflow
- AI
- Quick Action

等方式触发。

---

## 3.2 参数化 Action

每个 Action 都应该支持结构化参数。

例如：

```text
dedup
  └─ ignore case
  └─ sort result

json formatter
  └─ pretty
  └─ compact
```

---

## 3.3 GUI 优先

FluxText 应优先服务非程序员。

推荐交互：

```text
搜索
→ 配置参数
→ 执行
```

而不是：

```text
输入完整 CLI 命令
```

CLI 风格可以作为高级模式存在。

---

## 3.4 实时反馈

目标体验：

```text
选择 Action
→ 修改参数
→ 输出实时变化
```

而不是：

```text
点击执行
→ 等待
→ 出结果
```

---

# 4. MVP 功能范围

## 包含

- 文本编辑器
- Command Palette
- Action Registry
- Action Runtime
- 参数 UI 自动生成
- Script Import
- Script Editor
- Script Debugger
- Clipboard Support

---

## 不包含

- 云同步
- 用户账号
- 插件市场
- Workflow 编排
- 多标签系统
- AI Agent
- 协作系统
- 数据库

---

# 5. 技术栈

## Runtime

```text
Tauri (v2)
```

原因：

- 跨平台（macOS / Windows / Linux）
- 包体小（~5-10MB），内存占用低，启动快
- Rust 后端处理文件系统、剪贴板、快捷键注册
- 前端 WebView 渲染 UI，复用 Web 生态

---

## Frontend

```text
React
TypeScript
```

---

## UI

```text
TailwindCSS
shadcn/ui
```

---

## Editor

```text
Monaco Editor
```

---

## Command Palette

```text
cmdk
```

---

## State Management

```text
zustand
```

---

## Action Runtime

```text
WebView 内 JS 执行（new Function / eval）
```

- 用户脚本在前端 JS 环境中直接运行
- 不需要沙箱，不依赖 Node.js
- Action 为纯函数：ctx.input.text → { text: result }

---

## 架构分层

```text
┌─────────────────────────────────────┐
│ Frontend (WebView)                  │
│ React + TypeScript + TailwindCSS    │
│ Monaco Editor + zustand + cmdk      │
│ ┌─────────────────────────────────┐ │
│ │ Action Runtime                  │ │
│ │ - 解析 defineAction()           │ │
│ │ - 执行 run(ctx)                 │ │
│ │ - WebView 内直接执行            │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ Rust Backend (Tauri Core)           │
│ - 文件系统（读写脚本、watch 目录）  │
│ - 剪贴板读写                        │
│ - 全局快捷键注册                    │
│ - 窗口管理                          │
└─────────────────────────────────────┘
```

---

# 6. UI 结构

## 主布局

```text
┌────────────────────────────────────────────────┐
│ Titlebar  [FluxText]               [⌘K]       │
├──┬─────────────────────────────────────────────┤
│  │  Status bar: Ready · 12 lines · 243 chars   │
│S │─────────────────────────────────────────────│
│i │                                             │
│d │           Active View Content               │
│e │         (Editor / Scripts /                 │
│b │          Debugger / Settings)               │
│a │                                             │
│r │─────────────────────────────────────────────│
│  │  Bottom bar: output status                  │
└──┴─────────────────────────────────────────────┘
```

## 导航结构

App 采用 Sidebar + View 模式，左侧为窄侧栏（44px），右侧为主视图区域。

### Sidebar 按钮

| 图标 | 视图     | 说明                  |
| ---- | -------- | --------------------- |
| 布局 | Editor   | 文本编辑器 + 主工作区 |
| 拼图 | Scripts  | 脚本管理列表          |
| 终端 | Debugger | 脚本编辑器与调试器    |
| 设置 | Settings | 应用配置              |

### 视图切换行为

- 同一时间只有一个 View 处于激活状态
- Sidebar 按钮高亮当前激活 View
- 切换 View 时保留各 View 的内部状态

## Editor View

主工作区，用户在此粘贴文本并执行 Action。

组成部分：

```text
┌───────────────────────────────┐
│ Status bar (行数 · 字符数)     │
├───────────────────────────────┤
│ Line numbers │  Monaco Editor │
├───────────────────────────────┤
│ Bottom bar (output 状态)       │
└───────────────────────────────┘
```

- Status bar 显示：Ready 状态灯、行数、字符数、⌘K 提示
- Bottom bar 显示：最近一次 Action 的输出摘要

## Command Palette Overlay

在 Editor View 上以模态浮层形式展示：

```text
┌─────────────────────────┐
│ 🔍 [搜索框]             │
├─────────────────────────┤
│ best match              │
│  [D] dedup              │
│      Remove dup lines   │
│ also matches            │
│  [S] sort               │
│  [T] trim               │
├─────────────────────────┤
│ ↑↓ navigate  ⌘↵ run    │
│ esc close               │
└─────────────────────────┘
```

交互细节：

- ⌘K 唤起，esc 关闭
- 输入即搜索，按 name / title / aliases / tags 匹配
- 结果分组：best match / also matches
- 每项显示：首字母图标、name、description
- ↑↓ 选择，↵ 进入参数面板，⌘↵ 直接以默认参数运行
- 点击外部区域关闭

---

# 7. Action System

## 核心流程

```text
Editor Text
→ Action Invocation
→ Parameter Resolution
→ Runtime Execution
→ Output Rendering
```

---

# 8. Action 定义 API

示例：

```ts
export default defineAction({
  name: 'dedup',

  title: 'Remove Duplicate Lines',

  aliases: ['unique', 'distinct'],

  description: 'Remove duplicate lines from text',

  tags: ['text', 'cleanup'],

  params: [
    {
      key: 'ignoreCase',

      label: 'Ignore Case',

      type: 'boolean',

      default: false,
    },

    {
      key: 'sort',

      label: 'Sort Result',

      type: 'single-select',

      options: [
        {
          label: 'None',
          value: 'none',
        },
        {
          label: 'Ascending',
          value: 'asc',
        },
        {
          label: 'Descending',
          value: 'desc',
        },
      ],

      default: 'none',
    },
  ],

  run(ctx) {
    return {
      text: result,
    };
  },
});
```

---

# 9. Action Metadata

## 必填字段

| 字段  | 说明           |
| ----- | -------------- |
| name  | Action 唯一 ID |
| title | 显示名称       |
| run   | 执行函数       |

---

## 可选字段

| 字段        | 说明     |
| ----------- | -------- |
| aliases     | 搜索别名 |
| description | 描述     |
| tags        | 分类标签 |
| params      | 参数定义 |

---

# 10. 参数系统

参数系统必须：

```text
Schema Driven
```

即：

```text
Action 声明参数
→ 系统自动渲染 UI
```

不能：

```text
插件自己写参数 UI
```

否则生态会迅速失控。

---

# 11. 支持的参数类型

## text

单行输入。

示例：

```text
Regex Pattern
Replace Text
```

---

## textarea

多行输入。

示例：

```text
Prompt Template
Large Replace Text
```

---

## boolean

布尔开关。

示例：

```text
Ignore Case
Pretty Print
```

---

## number

数字输入。

示例：

```text
Indent Size
Limit Count
```

---

## single-select

单选。

示例：

```text
Sort Mode
- Ascending
- Descending
```

---

## multi-select

多选。

示例：

```text
Extract:
[x] URL
[x] Email
[ ] Phone
```

---

# 12. 参数 Schema 示例

```ts
params: [
  {
    key: 'mode',

    label: 'Sort Mode',

    type: 'single-select',

    options: [
      {
        label: 'Ascending',
        value: 'asc',
      },
      {
        label: 'Descending',
        value: 'desc',
      },
    ],
  },

  {
    key: 'extract',

    label: 'Extract Types',

    type: 'multi-select',

    options: [
      {
        label: 'URL',
        value: 'url',
      },
      {
        label: 'Email',
        value: 'email',
      },
      {
        label: 'Phone',
        value: 'phone',
      },
    ],
  },
];
```

---

# 13. 参数高级能力

## 条件显示

示例：

```text
启用 Regex
→ 才显示 Regex Pattern
```

Schema：

```ts
{
  key: "regexPattern",

  visibleWhen: {
    regex: true
  }
}
```

---

## 参数持久化

用户再次打开 Action 时：

```text
保留上次使用参数
```

例如：

```text
json formatter
→ pretty = true
→ indent = 2
```

---

# 14. Command Palette 设计

Command Palette 的本质：

```text
Action Searcher
```

不是：

```text
CLI Terminal
```

推荐交互：

```text
Ctrl + K
→ 搜索 Action
→ 进入参数面板
→ 执行
```

---

# 15. Script Manager

## 视图位置

Scripts View，通过 Sidebar 第二个按钮进入。

## 页面结构

```text
┌──────────────────────────────────────────┐
│ Scripts                [Import] [+ New]   │
├──────────────────────────────────────────┤
│ BUILT-IN ACTIONS                         │
│ ┌──────────────────────────────────────┐ │
│ │ [icon] dedup                 built-in│ │
│ │ [icon] sort                  built-in│ │
│ │ [icon] json formatter        built-in│ │
│ └──────────────────────────────────────┘ │
│                                          │
│ CUSTOM SCRIPTS                           │
│ ┌──────────────────────────────────────┐ │
│ │ [icon] extract-emails  loaded [✎][🗑]│ │
│ │ [icon] my-broken-action error [✎][🗑]│ │
│ └──────────────────────────────────────┘ │
│                                          │
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐ │
│ │ 📁 Watch: ~/FluxText/actions        │ │
│ │    auto-reload on save     [Change] │ │
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘ │
└──────────────────────────────────────────┘
```

## 分组逻辑

| 分组             | 说明                               |
| ---------------- | ---------------------------------- |
| Built-in actions | 系统内置 Action，不可删除/编辑源码 |
| Custom scripts   | 用户导入或创建的脚本               |

## Script 卡片

每张卡片显示：

- 图标（根据 Action 类型或首字母）
- 脚本名称（name 字段）
- 描述信息 / 文件路径 / 修改时间
- 状态 Badge
- 操作按钮（仅 Custom）

## 状态 Badge

| Badge    | 含义                         |
| -------- | ---------------------------- |
| built-in | 内置 Action，灰色            |
| loaded   | 自定义脚本已加载成功，绿色   |
| error    | 加载失败（语法错误等），红色 |

## 操作

- **Import .js / .ts** — 从文件系统选择脚本文件导入到 watch 目录
- **New script** — 跳转 Debugger View 创建新脚本
- **Edit** — 跳转 Debugger View 编辑该脚本
- **Delete** — 删除自定义脚本（需确认）

## 插件目录热加载

推荐目录：

```text
~/FluxText/actions
```

行为：

- 应用启动时自动扫描该目录
- 监听文件变化，保存即自动重新加载
- 加载失败时在卡片上标记 error 状态并提示错误信息（如 SyntaxError line 12）
- 底部展示当前 watch 目录路径，支持点击 Change 修改

---

# 16. Script Editor

推荐：

```text
Monaco Editor
```

支持：

- TypeScript
- 自动补全
- 类型提示
- Run
- Save
- Reload

---

# 17. Script Debugger

## 视图位置

Debugger View，通过 Sidebar 第三个按钮进入，或从 Scripts View 点击 Edit / New script 跳转。

## 整体布局

```text
┌──────────────────────────────────┬───────────────┐
│ [ts icon] extract-emails.ts      │               │
│ [Save] [Run]                     │               │
├──────────────────────────────────┤  PARAMS       │
│                                  │  ─────────    │
│   Code Editor (Monaco)           │  deduplicate  │
│   - 行号                         │  [toggle: on] │
│   - 语法高亮                     │               │
│   - 错误行高亮                   │  output format│
│                                  │  [select: ▾]  │
│                                  │               │
│                                  │  ctx.params:  │
│                                  │  { ... }      │
├──────────────────────────────────┼───────────────┤
│                                  │               │
│   Console                        │  INPUT        │
│   - ready / running / results    │  [textarea]   │
│                                  │               │
│                                  ├───────────────┤
│                                  │  OUTPUT       │
│                                  │  [result]     │
└──────────────────────────────────┴───────────────┘
```

## Params 面板

### 核心机制

Params 面板从脚本的 `params` 声明中自动解析，实时渲染为可编辑控件。

```text
代码中声明 params schema
→ 系统解析 params 数组
→ 自动渲染对应控件
→ 用户修改参数
→ 实时更新 ctx.params snapshot
```

### 控件映射规则

| 参数类型      | 渲染控件       |
| ------------- | -------------- |
| boolean       | Toggle 开关    |
| text          | 单行文本输入框 |
| textarea      | 多行文本输入框 |
| number        | 数字输入框     |
| single-select | 下拉选择器     |
| multi-select  | 多选复选框组   |

### 面板元素

每个参数行包含：

- **参数名**（label 字段）
- **控件**（根据 type 渲染）
- **类型 Badge**（如 `boolean`、`single-select`）
- **required Badge**（如参数标记为必填）

### ctx.params Snapshot

面板底部实时显示当前参数快照：

```text
ctx.params snapshot
{ unique: true, format: "one per line" }
```

- 参数变化时立即更新
- 帮助开发者确认传入 `run(ctx)` 的实际参数值
- 格式为 JSON-like 简写

### 交互行为

- 切换 Toggle → 立即更新 snapshot
- 修改 Select → 立即更新 snapshot
- 参数修改后文件标记为 dirty（标题栏显示 ● 标记）
- Run 时使用面板中的当前参数值

## Run Preview

```text
Input (textarea)
→ 点击 Run 按钮 / ⌘↵
→ 脚本以当前 Params + Input 执行
→ Output 面板显示结果
```

### 执行流程

1. 按下 Run，按钮变为 "Running…" 状态（橙色）
2. Console 显示执行日志：参数、输入行数
3. 脚本在 Sandbox 中执行
4. 输出写入 Output 面板
5. Console 显示结果摘要（匹配数、耗时等）
6. 恢复 Run 按钮

---

## Console Panel

支持：

```ts
console.log();
```

输出：

```text
[Console]
> run extract-emails
  params: { unique: true, format: "one per line" }
  input: 5 lines
✓ regex matched 4 addresses
✓ deduplicated → removed 1 duplicate
✓ output: 3 addresses
  done in 2ms
```

### Console 状态 Badge

| 状态      | 含义                 |
| --------- | -------------------- |
| idle      | 就绪，未执行         |
| running   | 脚本正在执行，橙色   |
| N results | 执行完成，显示结果数 |

---

## Error Boundary

脚本错误：

```text
Regex syntax error
```

不能导致 App 崩溃。

错误时：

- 代码面板对应行高亮（红色背景）
- Console 输出错误信息（红色文字）
- Code 状态 Badge 显示 "error"

---

# 18. Action Context

推荐：

```ts
ctx.input.text;

ctx.params;

ctx.editor.replace();

ctx.clipboard.read();

ctx.clipboard.write();
```

---

# 19. MVP 内置 Actions

建议内置：

| Action  | 功能         |
| ------- | ------------ |
| dedup   | 去重         |
| sort    | 排序         |
| trim    | 清理空白     |
| json    | JSON 格式化  |
| replace | 替换         |
| extract | 提取         |
| case    | 大小写转换   |
| base64  | 编码解码     |
| url     | URL 编码解码 |
| count   | 文本统计     |

---

# 20. Settings

## 视图位置

Settings View，通过 Sidebar 底部设置按钮进入。

## 页面布局

以 2 列网格卡片展示配置分组。

## 配置分组

### Scripts 配置

| 配置项              | 类型     | 默认值             | 说明                       |
| ------------------- | -------- | ------------------ | -------------------------- |
| Watch directory     | 路径输入 | ~/FluxText/actions | 脚本监听目录               |
| Auto-reload on save | 开关     | 开                 | 文件保存时自动重新加载脚本 |

### Editor 配置

| 配置项       | 类型 | 默认值 | 说明         |
| ------------ | ---- | ------ | ------------ |
| Font size    | 数字 | 13px   | 编辑器字号   |
| Word wrap    | 开关 | 关     | 是否自动换行 |
| Line numbers | 开关 | 开     | 是否显示行号 |

### Behavior 配置

| 配置项            | 类型 | 默认值 | 说明                                   |
| ----------------- | ---- | ------ | -------------------------------------- |
| Persist params    | 开关 | 开     | 记住每个 Action 上次使用的参数         |
| Auto-copy output  | 开关 | 关     | 执行完成后自动复制输出到剪贴板         |
| Real-time preview | 开关 | 开     | 参数变化时实时预览输出（不需要点 Run） |

---

# 21. 快捷键映射

## 全局快捷键

| 快捷键 | 动作                 |
| ------ | -------------------- |
| ⌘K     | 打开 Command Palette |
| ⌘⇧R    | 重新执行上次 Action  |
| ⌘⇧C    | 复制输出             |

## Script Editor 快捷键

| 快捷键 | 动作            |
| ------ | --------------- |
| ⌘S     | 保存脚本        |
| ⌘↵     | 执行脚本（Run） |

---

# 22. 后续方向（非 MVP）

## V1.1

Quick Actions：

```text
Ctrl+Shift+D
= dedup
```

---

## V1.2

AI Actions：

```text
AI Summarize
AI Clean CSV
AI Fix JSON
```

---

## V1.3

Action Marketplace：

```text
Markdown Tools
Regex Tools
CSV Tools
```

---

# 23. 核心产品原则

## 原则 1

```text
Action 必须足够小
```

一个 Action：

```text
只做一件事
```

---

## 原则 2

```text
命令优于按钮
```

---

## 原则 3

```text
实时反馈优先
```

---

## 原则 4

```text
不要做成 IDE
```

FluxText 应该：

- 轻
- 快
- 简单
- 临时
- 即开即用

---

# 24. 最终目标

FluxText 的目标不是：

```text
替代 VSCode
```

而是：

```text
替代人们：
- 打开浏览器搜索在线工具
- 复制粘贴网站
- 写一次性脚本
- 临时处理文本
```

核心价值：

```text
把临时文本处理，
统一成一个快速、可组合、可扩展的体验。
```
