# FluxText 下一代 UI 设计方向提案

## 1. 现状问题诊断

基于当前渲染输出的 HTML/CSS 源码（`flux-ui-current-state-board-v2.html`），对当前 UI 的诊断如下：

*   **层级与深度扁平化**：目前几乎所有的容器（应用外壳、面板、头部、编辑器）都过度依赖 `0.5px solid var(--color-border-tertiary)` 的边框，导致视觉层级扁平化。用户很难直观区分顶层工作区和嵌套的内部面板。
*   **节奏与密度不一致**：虽然应用试图保持“桌面实用工具”的紧凑感，但内边距（Padding）的缩放略显随意（例如混合使用 14px、12px、8px、6px），这产生了一种视觉上的局促感，而非流畅易读的节奏。
*   **色彩对比与焦点**：白色背景上的浅灰色框架（`#f8f8fa`）缺乏足够的对比度，无法清晰界定工具栏和文本区域的边界。紫色强调色（`#534ab7`）功能上可用，但与灰色调的融合度不够现代。交互状态（悬停、聚焦、激活）的视觉反馈有时不够明确。
*   **设置页面的卡片过重**：设置网格为较小的分组上下文使用了过于独立的卡片样式，使得页面感觉有些笨重，缺乏原生 macOS/桌面偏好设置视图的轻量感。

## 2. 全新视觉方向

新的设计方向（v3）拥抱了**“结构化深度与纯净实用主义 (Structural Depth & Clean Utility)”**的美学。它不再到处绘制边框，而是使用微妙的背景明暗变化、克制的阴影以及优化的“冷灰色 (Zinc/Slate)”调色板来建立边界。

*   **原生桌面感**：保留 `JetBrains Mono` 作为核心代码字体的属性，以维持文本工具的专业感，但为其包裹了一个更干净的 UI 外壳，使其感觉更接近原生桌面应用（如 Zed 或 Raycast）。
*   **通过明暗建立深度**：App Shell 侧边栏和工具栏现在使用略深且偏冷的灰色（`--color-bg-subtle`），将纯白色（`#ffffff`）专属留给高焦点的核心内容区域（如编辑器和激活的输入框）。
*   **克制的边框**：边框被谨慎使用（1px 的 strong/default/subtle 级别），仅在背景对比度不足以界定边缘时使用，避免了现状中类似“线框图”的视觉疲劳。
*   **现代强调色**：紫色强调色向更具活力的靛蓝色（Indigo, `#6366f1`）偏移，为激活状态和焦点环提供更好的对比度和更锐利的品牌识别度。

## 3. 设计令牌 (Design Tokens)

新 UI 的基础设计令牌如下：

```css
/* 排版 */
--font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
--text-xs: 11px;
--text-sm: 12px;
--text-base: 13px;
--text-md: 14px;
--text-lg: 16px;

/* 间距缩放 */
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;

/* 圆角 */
--radius-sm: 4px;
--radius-md: 6px;
--radius-lg: 8px;
--radius-xl: 12px;

/* 调色板: 冷灰色 (Zinc/Slate) */
--color-bg-app: #f4f4f5;       /* 应用底层背景 (面板外) */
--color-bg-surface: #ffffff;   /* 主面板/编辑器背景 */
--color-bg-subtle: #fafafa;    /* 次级头部/工具栏/侧边栏 */
--color-bg-hover: #f4f4f5;     /* 悬停状态 */
--color-bg-active: #e4e4e7;    /* 激活/选中背景 */

/* 边框 */
--color-border-subtle: #f4f4f5;
--color-border-default: #e4e4e7;
--color-border-strong: #d4d4d8;

/* 文本 */
--color-text-primary: #18181b;
--color-text-secondary: #52525b;
--color-text-tertiary: #a1a1aa;

/* 语义化色彩 */
--color-accent-base: #6366f1;
--color-accent-hover: #4f46e5;
--color-accent-subtle: #e0e7ff;
--color-accent-text: #4338ca;

--color-success-base: #10b981;
--color-success-subtle: #d1fae5;
--color-success-text: #047857;

--color-warning-base: #f59e0b;
--color-warning-subtle: #fef3c7;
--color-warning-text: #b45309;

--color-error-base: #ef4444;
--color-error-subtle: #fee2e2;
--color-error-text: #b91c1c;

/* 阴影与聚焦 */
--shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
--shadow-md: 0 4px 6px -1px rgba(0,0,0,0.08), 0 2px 4px -1px rgba(0,0,0,0.04);
--shadow-float: 0 20px 40px -5px rgba(0,0,0,0.15), 0 8px 16px -4px rgba(0,0,0,0.1);
--focus-ring: 0 0 0 2px rgba(99, 102, 241, 0.25);
```

## 4. 针对现有界面的迁移建议

### App Shell / 侧边栏 / 编辑器框架
*   **侧边栏**：移除右侧的硬边框。使用 `--color-bg-subtle` 背景色来区分侧边栏。侧边栏按钮在未悬停时应隐去明确的边界，悬停时显示 `--color-bg-hover`。
*   **编辑器框架**：四窗格网格布局应采用 `1px` 间隙技巧（容器设置 `gap: 1px` 和 `--color-border-default` 背景），而不是在每个窗格上绘制边框。行号区域（gutter）获得微妙的灰色背景，以在视觉上将行号与代码分离。

### 命令面板 (Command Palette) & 全局启动器 (Global Launcher)
*   **阴影层级**：移除沉重的 0.5px 边框，转而依赖 `--shadow-float` 阴影来赋予面板悬浮的 Z 轴层级感。
*   **列表项**：将内边距增加到 `8px 16px` 以扩大点击区域。激活状态的列表项获得柔和的 `--color-bg-hover` 处理，而图标获得 `--color-accent-base` 背景，以实现锐利的视觉聚焦。

### 插件页面 (Plugins Page)
*   **卡片**：除非悬停，否则移除默认的强边框。将插件元数据更紧凑地分组。错误状态的卡片背景使用微红（`#fffafa`）并带有红色边框（`--color-error-subtle`），而不是纯粹依赖红色文本。
*   **标签页 (Tabs)**：从分段盒子样式转变为干净的下划线标签样式。激活的标签页底部带有 2px 的边框（`--color-accent-base`）。

### 插件源码查看器 (Plugin Source Viewer)
*   **文件树**：为文件树应用 `--color-bg-subtle`，以与 Monaco 编辑器的纯白 `--color-bg-surface` 形成对比。
*   **头部**：标准化顶部 Header，使其与 App Shell 的 topbar 样式对齐。

### 固定运行器 (Pinned Runner)
*   **输入/输出窗格**：与主编辑器窗格一样，使用 1px 间隙的网格布局方法。
*   **控制栏**：为控制栏提供独特的背景（`--color-bg-subtle`），将其与编辑器内容区分开来。

### 设置页面 (Settings)
*   **卡片网格**：柔化卡片边框。将表单元素严格向右对齐。切换开关（Toggle）使用新的 `--color-accent-base` 色彩。

### 文本差异比较 (Text Diff)
*   **差异颜色**：从通用的浅色转变为精确的语义背景色：新增使用 `--color-success-subtle`，变更/删除使用 `--color-warning-subtle`。
*   **工具栏**：将主差异工具栏和数组工具栏合并到一个单一的语义头部区域，使用统一的柔和背景。

## 5. 插件边界说明 (Plugin Boundary Notes)

为了确保我们在实现过程中不破坏框架与插件的边界：

**框架所属 (Framework Owned - 在核心 UI 中实现)**
*   外层的 `App Shell`、`Sidebar` 布局，以及 `Workspace` 窗格网格结构。
*   通用的 `Monaco` 容器样式（行号区域背景、文本颜色）。
*   通用的 `Command Palette` 和 `Global Launcher` 模态框结构、搜索输入和列表渲染。
*   `Plugins Page` 包管理器视图和 Settings 网格结构。

**插件所属 (Plugin Owned - 严禁在核心 UI 中硬编码)**
*   **文本差异 (Text Diff)**：`DiffSurface`、`TextDiffRenderer`、并排布局以及语义化切换按钮（JSON semantic diff, Array compare controls）完全属于插件 UI。框架仅提供挂载此界面的工作区窗格。差异工具栏的样式必须通过插件 UI 组件库或标准 CSS 类暴露给插件使用。
*   **即时建议 (Instant Suggestions)**：计算器的 `1+2*3 = 7` 是一行插件命令。框架仅负责渲染 `item-title`、`item-sub` 和 `item-meta`。
*   **固定运行器控制项 (Pinned Runner Controls)**：固定运行器中具体的控制项（如 checkbox, dropdown）由插件定义。框架仅提供底部的控制栏容器。

## 6. 实施清单 (Implementation Checklist)

- [ ] **令牌更新**：用新的 Zinc/Indigo 令牌集替换主样式表中的所有根 CSS 变量。
- [ ] **App Shell 组件**：更新 `Sidebar.tsx`（移除边框，添加柔和背景）和 `Workspace.tsx`（实现 1px 间隙网格）。
- [ ] **编辑器组件**：更新 `MonacoEditor.tsx` 包装器，以使用新的行号区域背景色和排版比例。
- [ ] **命令面板 / 启动器**：更新 `Palette.tsx`，使用新的 `--shadow-float` 阴影以及悬停/激活的列表项状态。
- [ ] **插件视图**：更新 `PluginsPage.tsx`、`PluginCard.tsx`，并将标签页转换为新的下划线样式。
- [ ] **设置视图**：更新 `Settings.tsx` 卡片边框和 `Toggle.tsx` 组件颜色。
- [ ] **固定运行器**：更新 `PinnedRunner.tsx` 网格布局和头部内边距。
- [ ] **插件源码查看器**：更新 `SourceViewer.tsx`，为文件树侧边栏应用 `--color-bg-subtle`。
- [ ] **插件 UI 库（向插件暴露）**：更新 Text Diff 插件使用的标准类（例如 `.tiny-btn`, `.diff-toolbar`），使其与新令牌系统匹配，而无需在框架中硬编码差异逻辑。

## 7. 验证清单 (Validation Checklist)

- [ ] **浏览器渲染**：在浏览器中打开 `doc/flux-ui-mockup.html`。验证层级结构、排版节奏（JetBrains Mono）和色彩对比度。
- [ ] **插件边界检查**：确保没有任何 Diff API、双窗格逻辑或数组比较控件泄漏到框架组件中。
- [ ] **密度检查**：确认 UI 保持足够的密度，适合作为桌面实用工作台（没有过大的营销页面内边距）。
- [ ] **视觉回归**：验证格式错误的包（malformed package）错误状态是否清晰可见，且只读（read-only）指示器仍然存在。
- [ ] **Monaco 可编辑差异**：验证 Diff 界面是否保留了其可编辑的 Monaco 窗格结构（而不是变成了静态预览图）。