# GPT-5.5 Spatial 统一 UI 规范

## 1. 设计哲学

FluxText 是一个命令驱动的文本处理工作台。Spatial 设计语言融合了「结构化工作台」的功能密度与「空间深度」的视觉质感。

核心原则：
- **空间深度 (Spatial Depth)**：通过环境光辉(ambient glow)、玻璃拟态(glassmorphism)和多层阴影建立 Z 轴层级
- **功能密度 (Functional Density)**：保持桌面工具的紧凑感，每一像素服务于编辑、执行、检视
- **双氛围 (Dual Ambience)**：暗色/亮色主题共享结构与密度，仅适配对比度
- **克制的高级感 (Premium Restraint)**：高工艺来自对齐、节奏、状态清晰与材质品质，而非装饰噪音

## 2. 设计令牌 (Design Tokens)

### 2.1 字体

```css
--font-ui: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif;
--font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
```

### 2.2 排版比例

| 令牌 | 值 | 用途 |
|------|------|------|
| `--text-xs` | `10px` | 徽章、状态栏辅助、快捷键提示 |
| `--text-sm` | `11px` | 侧边栏标签、文件树节点、行号 |
| `--text-md` | `12px` | 正文、列表项、命令面板条目 |
| `--text-lg` | `14px` | 面板标题、Tab 标签、设置项标签 |
| `--text-xl` | `16px` | 页面标题、Section 标题 |

字重：400（正文）、500（中等强调）、600（标签/按钮）、700（标题）

### 2.3 间距

| 令牌 | 值 |
|------|------|
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `20px` |
| `--space-6` | `24px` |
| `--space-8` | `32px` |

### 2.4 圆角

| 令牌 | 值 | 用途 |
|------|------|------|
| `--radius-sm` | `6px` | 按钮、输入框、徽章 |
| `--radius-md` | `10px` | 卡片、下拉菜单、弹出框 |
| `--radius-lg` | `16px` | 面板、对话框 |
| `--radius-xl` | `20px` | 顶级容器、App Shell |
| `--radius-full` | `999px` | 胶囊按钮、切换器、搜索栏 |

### 2.5 色彩系统

#### 暗色主题 (`data-theme="dark"`)

**环境与表面**

| 令牌 | 值 | 语义 |
|------|------|------|
| `--page` | `#070a14` | 最底层页面背景 |
| `--page-glow-a` | `rgba(113,96,255,.38)` | 左上紫色环境光 |
| `--page-glow-b` | `rgba(40,190,255,.24)` | 右上青色环境光 |
| `--page-glow-c` | `rgba(182,74,255,.12)` | 右下紫色环境光 |
| `--surface` | `rgba(22,24,36,.58)` | 面板/卡片背景 |
| `--surface-2` | `rgba(18,22,36,.68)` | 次级面板（侧边栏、工具栏） |
| `--surface-3` | `rgba(255,255,255,.06)` | 微亮表面（hover 底色） |
| `--canvas` | `rgba(10,13,24,.82)` | 编辑器/核心内容区 |
| `--canvas-2` | `rgba(16,20,34,.72)` | 次级内容区（gutter） |
| `--canvas-3` | `rgba(255,255,255,.07)` | 内容区边线 |

**文字**

| 令牌 | 值 | 用途 |
|------|------|------|
| `--ink` | `#f7f8ff` | 主文字 |
| `--muted` | `#b4bad0` | 次要文字/描述 |
| `--faint` | `#79829d` | 占位符/禁用文字 |

**边线**

| 令牌 | 值 |
|------|------|
| `--line` | `rgba(255,255,255,.075)` |
| `--line-strong` | `rgba(255,255,255,.13)` |

**语义色**

| 令牌 | 值 | 用途 |
|------|------|------|
| `--accent` | `#8c7cff` | 主色/焦点/激活态 |
| `--accent-2` | `#39d8e8` | 辅助色/类型标签 |
| `--accent-soft` | `rgba(140,124,255,.18)` | accent 淡色背景 |
| `--ok` | `#3fe0a5` | 成功/已加载 |
| `--warn` | `#f0b65f` | 警告/运行中 |
| `--err` | `#ff6f83` | 错误/失败 |

**材质**

| 令牌 | 值 |
|------|------|
| `--material` | `linear-gradient(145deg, rgba(34,37,54,.62), rgba(10,13,24,.54))` |
| `--shine` | `inset 0 1px 0 rgba(255,255,255,.16), inset 0 -1px 0 rgba(255,255,255,.035)` |

**阴影**

| 令牌 | 值 |
|------|------|
| `--shadow` | `0 34px 76px -24px rgba(0,0,0,.76), 0 18px 34px -18px rgba(0,0,0,.62), 0 0 0 1px rgba(255,255,255,.045)` |
| `--shadow-soft` | `0 18px 42px -22px rgba(0,0,0,.72), 0 0 0 1px rgba(255,255,255,.035)` |
| `--shadow-float` | `0 40px 80px -20px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.06)` |

#### 亮色主题 (`data-theme="light"`)

**环境与表面**

| 令牌 | 暗色 → 亮色 |
|------|------|
| `--page` | `#070a14` → `#e7edf8` |
| `--page-glow-a` | → `rgba(126,103,255,.24)` |
| `--page-glow-b` | → `rgba(42,193,211,.18)` |
| `--page-glow-c` | → `rgba(255,255,255,.62)` |
| `--surface` | → `rgba(255,255,255,.66)` |
| `--surface-2` | → `rgba(248,251,255,.72)` |
| `--surface-3` | → `rgba(255,255,255,.68)` |
| `--canvas` | → `#ffffff` |
| `--canvas-2` | → `rgba(247,249,253,.9)` |
| `--canvas-3` | → `rgba(51,64,95,.10)` |

**文字**

| 令牌 | 暗色 → 亮色 |
|------|------|
| `--ink` | → `#161b29` |
| `--muted` | → `#596478` |
| `--faint` | → `#8893a7` |

**边线**

| 令牌 | 暗色 → 亮色 |
|------|------|
| `--line` | → `rgba(22,27,41,.095)` |
| `--line-strong` | → `rgba(255,255,255,.78)` |

**语义色**

| 令牌 | 暗色 → 亮色 |
|------|------|
| `--accent` | `#8c7cff` → `#5f55df` |
| `--accent-2` | `#39d8e8` → `#119ca8` |
| `--accent-soft` | → `rgba(95,85,223,.12)` |
| `--ok` | `#3fe0a5` → `#128568` |
| `--warn` | `#f0b65f` → `#a56b18` |
| `--err` | `#ff6f83` → `#c8445a` |

**材质**

| 令牌 | 暗色 → 亮色 |
|------|------|
| `--material` | → `linear-gradient(145deg, rgba(255,255,255,.78), rgba(244,248,255,.54))` |
| `--shine` | → `inset 0 1px 0 rgba(255,255,255,.86), inset 0 -1px 0 rgba(255,255,255,.48)` |
| `--shadow` | → `0 30px 70px -30px rgba(36,47,77,.36), 0 14px 28px -18px rgba(36,47,77,.22), 0 0 0 1px rgba(255,255,255,.68)` |
| `--shadow-soft` | → `0 18px 38px -24px rgba(36,47,77,.26), 0 0 0 1px rgba(255,255,255,.62)` |

### 2.6 动效

```css
--ease: cubic-bezier(.16, 1, .3, 1);     /* 弹性缓出，用于面板展开/收起 */
--ease-micro: cubic-bezier(.2, 0, 0, 1); /* 微交互，用于 hover/press */
--duration-fast: 120ms;                   /* hover 状态变化 */
--duration-normal: 220ms;                 /* 主题切换、面板过渡 */
--duration-slow: 400ms;                   /* 模态框入场 */
```

所有动效遵守 `prefers-reduced-motion: reduce` 媒体查询，降至 0.01ms。

### 2.7 玻璃拟态参数

| 场景 | blur | saturate |
|------|------|----------|
| 面板/卡片 | `26px` | `132%` |
| 命令面板/对话框 | `34px` | `140%` |
| 顶栏/状态栏 | `20px` | `120%` |
| 小型弹出（Tooltip/Menu） | `16px` | `120%` |

## 3. 组件规格

### 3.1 按钮 (Button)

**变体**

| 变体 | 背景 | 文字色 | 高度 | 用途 |
|------|------|--------|------|------|
| Primary | `linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent), #fff 22%))` | `white` | `34px` | 主要操作（Run, Save, Import） |
| Secondary | `var(--surface-3)` | `var(--ink)` | `34px` | 次要操作 |
| Ghost | `transparent` | `var(--muted)` | `28px` | 工具栏内行动 |
| Tiny | `transparent` | `var(--muted)` | `24px` | 差异工具栏/紧凑控件 |
| Icon | `transparent` | `var(--muted)` | `32×32` | 侧边栏/工具栏图标按钮 |
| Danger | `rgba(var(--err-rgb),.15)` | `var(--err)` | `34px` | 删除/破坏性操作 |

**交互态**
- Hover: 背景亮度 +10%, translateY(-1px)
- Active/Pressed: translateY(0), 亮度恢复
- Focus: `0 0 0 2px var(--accent-soft)` 外圈
- Disabled: opacity 0.4, pointer-events: none

**通用样式**
```css
border: 1px solid var(--line);
border-radius: var(--radius-sm);
font-family: var(--font-ui);
font-size: var(--text-md);
font-weight: 600;
cursor: pointer;
transition: all var(--duration-fast) var(--ease-micro);
```

### 3.2 输入框 (Input)

| 属性 | 值 |
|------|------|
| 高度 | `36px`（标准）、`44px`（搜索栏） |
| 背景 | `var(--canvas)` |
| 边框 | `1px solid var(--line)` |
| 圆角 | `var(--radius-sm)` / `var(--radius-full)`（搜索栏） |
| 字体 | `var(--font-ui)` / `var(--font-mono)`（代码输入） |
| 占位符色 | `var(--faint)` |
| Focus 态 | 边框变为 `var(--accent)`, 外圈 `0 0 0 3px var(--accent-soft)` |
| Error 态 | 边框变为 `var(--err)`, 背景带微红 |

### 3.3 切换开关 (Toggle)

```
宽度: 36px  高度: 20px  圆角: 999px
滑块: 14×14 白色圆形
关闭态: 背景 var(--surface-3), 滑块 left: 3px
开启态: 背景 var(--accent), 滑块 left: 19px
过渡: var(--duration-fast) var(--ease)
```

### 3.4 下拉选择 (Select)

```
高度: 34px  最小宽度: 120px
背景: var(--canvas)  边框: 1px solid var(--line)
圆角: var(--radius-sm)
右侧箭头: ▾ (faint 色)
展开时: 底部弹出下拉列表, 使用 --shadow-float 阴影
选项 hover: 背景 var(--surface-3)
选项 selected: 背景 var(--accent-soft), 文字 var(--accent)
```

### 3.5 标签页 (Tabs)

```
高度: 36px  下边框: 1px solid var(--line)
Tab 项: padding 0 16px, font-weight 500
默认态: 文字 var(--muted)
Hover: 文字 var(--ink)
Active: 文字 var(--ink), 底部 2px var(--accent) 指示线,
        指示线带发光 box-shadow: 0 2px 8px var(--accent-soft)
```

### 3.6 徽章 (Badge)

| 变体 | 背景 | 文字 | 用途 |
|------|------|------|------|
| default | `var(--surface-3)` | `var(--muted)` | built-in, 类型标签 |
| accent | `var(--accent-soft)` | `var(--accent)` | 选中/激活 |
| success | `rgba(--ok-rgb, .15)` | `var(--ok)` | loaded, 通过 |
| warning | `rgba(--warn-rgb, .15)` | `var(--warn)` | running, 变更 |
| error | `rgba(--err-rgb, .15)` | `var(--err)` | error, 失败 |

```
高度: 20px  padding: 0 8px  圆角: var(--radius-sm)
字号: var(--text-xs)  字重: 600  行高: 20px
```

### 3.7 卡片 (Card)

```
背景: var(--surface)
边框: 1px solid var(--line)
圆角: var(--radius-md)
backdrop-filter: blur(26px) saturate(132%)
box-shadow: var(--shine)
内边距: var(--space-4)
Hover: translateY(-2px), --shadow-soft
Error 态: 边框 var(--err), 背景叠加 rgba(--err-rgb, .06)
```

### 3.8 命令面板 (Command Palette)

```
宽度: 520px  最大高度: 480px
背景: var(--surface), backdrop-filter: blur(34px) saturate(140%)
圆角: var(--radius-lg)
box-shadow: var(--shadow-float)
入场动画: floatIn 400ms var(--ease)
  from: translateY(16px) scale(0.98) opacity(0)
  to: translateY(0) scale(1) opacity(1)

搜索栏: 高度 48px, 底部 1px var(--line) 分隔
命令项: Grid 三列 [32px icon, 1fr content, auto shortcut]
  高度: 40px, padding: 0 16px
  Hover: 背景 var(--surface-3)
  Selected: 背景 var(--accent-soft), 内边框 1px var(--accent) 30%
  图标: 32×32 圆角 6px, selected 时为 accent 渐变
Section 标签: 大写, letter-spacing 0.1em, 文字 var(--faint)
底部栏: 键盘快捷键提示, 24px 高
```

### 3.9 对话框 (Dialog / Modal)

```
宽度: 400-520px
背景: var(--surface)
圆角: var(--radius-lg)
backdrop-filter: blur(34px) saturate(140%)
box-shadow: var(--shadow-float)
遮罩层: rgba(0,0,0,.5) (暗色) / rgba(0,0,0,.25) (亮色)
  backdrop-filter: blur(4px)
结构:
  - Header: 标题(--text-lg, 700) + 关闭按钮(Icon Button)
  - Body: padding var(--space-5), 文字 var(--muted)
  - Footer: 右对齐按钮组, gap var(--space-2)
入场动画: 与 Command Palette 相同的 floatIn
```

### 3.10 Toast 通知

```
宽度: 320px  最小高度: 44px
位置: 右下角, 距边 var(--space-4)
背景: var(--surface)
圆角: var(--radius-md)
backdrop-filter: blur(26px) saturate(132%)
box-shadow: var(--shadow-soft)
结构: Grid [20px icon, 1fr text, 20px close]
  成功: 左侧 3px var(--ok) 条
  错误: 左侧 3px var(--err) 条
  警告: 左侧 3px var(--warn) 条
  信息: 左侧 3px var(--accent) 条
入场动画: slideIn 300ms var(--ease)
  from: translateX(100%) opacity(0)
  to: translateX(0) opacity(1)
自动消失: 4秒后 fadeOut
```

### 3.11 上下文菜单 (Context Menu)

```
最小宽度: 180px
背景: var(--surface)
圆角: var(--radius-md)
backdrop-filter: blur(26px) saturate(132%)
box-shadow: var(--shadow-float)
菜单项: 高度 32px, padding 0 12px
  Hover: 背景 var(--accent-soft), 文字 var(--ink)
  Disabled: 文字 var(--faint), pointer-events: none
分隔线: 1px solid var(--line), margin 4px 0
快捷键提示: 右对齐, var(--faint), var(--font-mono)
```

### 3.12 空状态 (Empty State)

```
居中显示, max-width 300px
图标: 48×48, var(--faint) 色
标题: var(--text-lg), var(--muted)
描述: var(--text-md), var(--faint)
操作按钮: Primary 或 Secondary
间距: 图标与标题 var(--space-3), 标题与描述 var(--space-2), 描述与按钮 var(--space-4)
```

### 3.13 侧边栏导航 (Sidebar / Rail)

```
宽度: 50px
背景: var(--surface-2)
导航按钮: 32×32, 圆角 var(--radius-sm)
  默认: 文字 var(--faint)
  Hover: 背景 var(--surface-3), 文字 var(--muted)
  Active: 背景 linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent), #fff 22%)),
          文字 white, box-shadow: 0 4px 12px var(--accent-soft)
Logo: 30×30, accent 渐变, 位于顶部
分隔线: 1px solid var(--line), 水平, margin 8px 12px
底部区域: 设置按钮
```

### 3.14 状态栏 (Status Bar)

```
高度: 30px
背景: var(--surface-2)
边框上方: 1px solid var(--line)
字号: var(--text-xs)
文字: var(--faint)
内边距: 0 var(--space-3)
状态点:
  Ready: 8×8 圆形 var(--ok), 带微弱发光
  Running: 8×8 var(--warn), 带脉冲动画
  Error: 8×8 var(--err)
Pill 标签: 与 Badge default 相同
```

### 3.15 文件树 (File Tree)

```
节点高度: 28px
缩进: 每级 16px
字号: var(--text-sm)
字体: var(--font-mono) (文件名) + var(--font-ui) (目录名)
默认: 文字 var(--muted)
Hover: 背景 var(--surface-3)
Selected: 背景 var(--accent-soft), 文字 var(--accent)
文件图标: 14×14, 根据文件类型着色
目录箭头: ▸/▾, var(--faint)
```

### 3.16 编辑器窗格 (Editor Pane)

```
结构: Grid 三行 [30px tab-bar, 1fr editor, 25px footer]
Tab Bar: 与 Tabs 组件一致, 额外增加 .kind 标签 (accent-2 色, mono 9px)
编辑器: Grid 两列 [42px gutter, 1fr code]
  Gutter 背景: var(--canvas-2)
  行号: var(--faint), var(--font-mono), 右对齐
  代码: var(--font-mono), 12px, 行高 1.75
Focus 态: outline 1px solid var(--accent),
  box-shadow: inset 0 0 0 1px var(--accent-soft),
              0 0 20px var(--accent-soft)
语法高亮:
  关键字(.kw): var(--accent)
  字符串(.str): var(--accent-2)
  注释(.mut): var(--faint)
  错误(.err): var(--err)
  成功(.ok): var(--ok)
```

### 3.17 Diff 视图 (Diff View)

```
结构: Grid 三行 [36px toolbar, 32px array-toolbar, 1fr panes]
双栏: Grid 两列 1fr 1fr
高亮:
  新增(.hl-add): 背景 rgba(--ok-rgb, .12), 左侧 2px var(--ok)
  变更(.hl-change): 背景 rgba(--warn-rgb, .12), 左侧 2px var(--warn)
  删除(.hl-del): 背景 rgba(--err-rgb, .12), 左侧 2px var(--err)
工具栏按钮: Tiny Button 变体
```

### 3.18 Pinned Runner (固定运行器)

```
结构: Grid 三行 [48px header, 1fr body, 44px controls]
Header: 标题 + Run 按钮(Primary) + 状态 Badge
Body: Grid 两列 (Input + Output), 各为 mini-panel
  Mini Panel: Grid 两行 [28px head, 1fr content]
Controls: 参数控件行 (Toggle, Select 组件)
```

## 4. 场景覆盖清单

| 场景 | 状态 | 组件组成 |
|------|------|----------|
| 主编辑器 (4 Pane Grid) | ✅ 已覆盖 | Sidebar + Topbar + 4×EditorPane + StatusBar |
| 命令面板 | ✅ 已覆盖 | CommandPalette + 即时建议(Calculator) |
| 全局启动器 | ✅ 已覆盖 | CommandPalette 变体 (居中大尺寸) |
| 插件管理 | ✅ 已覆盖 | Tabs + Card(Plugin) + Badge + SearchBar |
| 插件源码查看器 | ✅ 已覆盖 | FileTree + EditorPane(只读) |
| 设置页面 | ✅ 已覆盖 | Card(Setting) + Toggle + Select + Input |
| 文本差异 | ✅ 已覆盖 | DiffView + TinyButton + Badge |
| Pinned Runner | ✅ 已覆盖 | PinnedRunner + Toggle + Select |
| Toast 通知 | 🆕 新增 | Toast 组件 |
| 确认对话框 | 🆕 新增 | Dialog + Button |
| 上下文菜单 | 🆕 新增 | ContextMenu |
| 参数编辑面板 | 🆕 新增 | Input + Toggle + Select + NumberInput |
| 空状态 | 🆕 新增 | EmptyState |
| 错误状态面板 | 🆕 新增 | Card(Error) + Badge(Error) |
| JS Filter Bar | 🆕 新增 | Input(代码) + TinyButton |

## 5. 主题切换机制

```html
<body data-theme="dark">
```

通过 JS 切换 `data-theme` 属性：
```javascript
document.body.dataset.theme = 'dark' | 'light';
```

所有颜色令牌通过 CSS 变量在 `body[data-theme="dark"]` 和 `body[data-theme="light"]` 中定义，组件层不写死颜色值。

过渡动画：
```css
body {
  transition: background var(--duration-normal) var(--ease),
              color var(--duration-normal) var(--ease);
}
```

## 6. 无障碍要求

- 所有文字与背景对比度达到 WCAG AA (4.5:1)
- 焦点环使用 accent-soft 色, 可见度 ≥ 3:1
- 键盘导航: 所有交互元素可 Tab 聚焦
- `prefers-reduced-motion: reduce` 时禁用所有动画
- 状态不仅依赖颜色：配合图标、文字、边框
- 所有交互元素最小点击区域 32×32px
