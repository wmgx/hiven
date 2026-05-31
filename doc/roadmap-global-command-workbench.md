# FluxText 全局命令工作台 Roadmap

## 1. 结论

FluxText 可以从当前的文本处理工具，演进为一个面向开发者和重度文本处理用户的本地命令工作台。

短期目标不是复制 Alfred、Raycast 或 uTools 的完整能力，而是让 FluxText 已有的文本 Action 能通过全局入口随时可用。第一阶段的成功标准是：

```text
任意 App 复制文本
-> 全局快捷键呼出 FluxText
-> 自动进入 Quick Tab
-> 默认打开 Command Palette
-> 选择现有 Action
-> 结果自动复制到剪贴板
-> 可选隐藏窗口
```

这个阶段不引入完整插件平台，不引入自定义 UI View，不引入本地 shell 命令执行，也不把 `ActionDef` 立即重构为 `CommandDef`。

## 2. 产品定位

### 2.1 当前定位

当前 FluxText 是命令驱动的文本处理工作台，核心模型是：

```text
文本输入 -> Action -> 文本输出
```

现有能力包括：

- Monaco 编辑器。
- Command Palette。
- 内置文本处理 Action。
- 自定义 JavaScript / TypeScript 脚本。
- 参数化 Action。
- 脚本调试器。
- 远程内置脚本更新。
- Tauri 桌面分发。

### 2.2 目标定位

目标定位建议收敛为：

```text
全局可唤起的开发者文本与命令工作台
```

差异化边界：

- 相比 Alfred / Raycast：FluxText 不是通用 App 启动器优先，而是文本、结构化数据和开发者工作流优先。
- 相比 uTools：FluxText 不先做大而全插件平台，而是先强化本地 Action Runtime 和脚本体验。
- 相比 Boop：FluxText 有脚本扩展、参数系统、Debugger、跨平台和远程脚本更新能力。

## 3. 当前架构基础

### 3.1 关键代码位置

- `src/store.ts`：`ActionDef`、`ActionContext`、Zustand 状态和脚本解析。
- `src/components/CommandPalette.tsx`：Action 搜索、参数采集和执行管线。
- `src/views/EditorView.tsx`：Monaco 主编辑器。
- `src/App.tsx`：启动脚本加载、应用内 `Cmd/Ctrl+K` 快捷键。
- `src/configInit.ts`：配置目录初始化和内置脚本三层管理。
- `src/fluxtext.d.ts`：脚本 SDK 类型声明。
- `src-tauri/src/lib.rs`：Tauri 后端命令。
- `src-tauri/capabilities/default.json`：Tauri 权限声明。
- `src-tauri/tauri.conf.json`：窗口、更新和打包配置。

### 3.2 当前执行模型

当前 Command Palette 的执行流程是：

```text
搜索 Action
-> 采集参数
-> 读取 Monaco 选区或全文
-> 加载 @deps 依赖
-> 构造 ActionContext
-> 调用 action.run(ctx)
-> 用返回的 { text } 替换选区或全文
-> 更新 lastResult / lastActionName
```

这个模型适合保留。第一阶段只需要拓展入口、输入来源、结果处理方式和编辑会话模型。

## 4. 第一阶段：全局呼出的文本增强工具

### 4.1 阶段目标

让现有 26+ 内置 Action 和用户自定义 Action 具备 Raycast 式入口体验。

第一阶段不追求“工具平台完整性”，只追求把现有能力变成全局可用。

### 4.2 MVP 范围

P0 必须包含：

- 全局快捷键呼出 / 隐藏窗口。
- 应用后台常驻，窗口采用 `hide/show`，不销毁 WebView。
- 呼出后默认聚焦 Command Palette。
- 呼出时读取剪贴板文本。
- 将剪贴板内容写入 Quick Tab，不覆盖主编辑器内容。
- 执行 Action 后自动复制结果到剪贴板。
- 保持现有 `{ text: string }` 返回值兼容。

P1 可以包含：

- 系统托盘。
- 快速模式 / 完整模式切换。
- 设置项：
  - 呼出后是否读取剪贴板。
  - 执行后是否自动复制。
  - 执行后是否自动隐藏窗口。
  - 全局快捷键配置。
- `ActionResult` 支持 `openUrl` 和 `notification`。
- Quick Tab 转为普通 Tab。

明确暂缓：

- `CommandDef` / `kind: text | command | view | workflow`。
- Workflow 编排。
- 插件市场。
- 插件权限系统。
- 自定义 UI View。
- 本地 shell 命令执行。
- 剪贴板历史。
- 文件系统大范围集成。

### 4.3 用户体验

全局呼出时进入 Quick Mode：

```text
Global Shortcut
-> show window
-> activate window
-> read clipboard
-> create or update Quick Tab
-> switch active input to Quick Tab
-> open Command Palette
-> focus search input
```

正常启动或 Dock 点击时进入 Full Mode：

```text
show main window
-> keep previous normal tab/editor state
-> do not overwrite content from clipboard
```

Quick Tab 需要和普通编辑器内容隔离。全局呼出的剪贴板内容不应直接覆盖 `editorText`，否则会污染用户正在编辑的内容。

## 5. Quick Tab 设计

### 5.1 最小模型

第一阶段可以先做单个 Quick Tab，不必完整暴露多标签 UI。

建议在 `store.ts` 中增加：

```ts
export interface EditorTab {
  id: string
  title: string
  text: string
  kind: 'normal' | 'quick'
  dirty: boolean
  createdAt: number
  updatedAt: number
}

export type LaunchMode = 'full' | 'quick'
```

推荐状态：

```ts
interface AppState {
  tabs: EditorTab[]
  activeTabId: string
  launchMode: LaunchMode
  setActiveTab: (id: string) => void
  updateActiveTabText: (text: string) => void
  openQuickTabFromClipboard: (text: string) => void
  keepQuickTab: () => void
}
```

### 5.2 兼容迁移

当前代码大量依赖 `editorText` / `setEditorText`。为降低迁移成本，可以分两步走。

第一步保留兼容选择器：

```ts
editorText: string
setEditorText: (text: string) => void
```

内部实现改为读写 active tab。这样 `EditorView.tsx`、`CommandPalette.tsx` 和现有 Action 执行管线可以少改。

第二步再逐步把调用方迁移到：

```ts
activeTab.text
updateActiveTabText(text)
```

### 5.3 Quick Tab 行为

P0 行为：

- 只有一个 `kind: 'quick'` 的 tab。
- 每次全局呼出时复用该 tab，并用剪贴板文本覆盖。
- Quick Tab 不影响普通 tab。
- Action 执行结果写回 Quick Tab。
- 若开启自动复制，则将结果写入系统剪贴板。

P1 行为：

- Quick Tab 可点击“保留”，转换为 `kind: 'normal'`。
- 执行后可自动关闭或保留。
- 可保留最近 quick sessions，但不默认做剪贴板历史。

## 6. ActionResult 扩展

### 6.1 当前问题

当前 `ActionDef.run` 只支持：

```ts
{ text: string } | Promise<{ text: string }> | void
```

这限制了 Action 的结果类型。第一阶段需要自动复制、打开 URL、通知等轻量副作用，但不应破坏现有脚本。

### 6.2 推荐类型

在 `store.ts` 和 `src/fluxtext.d.ts` 中扩展为：

```ts
export interface ActionResult {
  text?: string
  copyToClipboard?: boolean
  openUrl?: string
  notification?: string
}

export interface ActionDef {
  run: (ctx: ActionContext) => ActionResult | Promise<ActionResult> | void
}
```

兼容性：

- 现有 `{ text: string }` 仍然有效。
- 未返回内容的 Action 仍然允许。
- 第一阶段不支持任意 shell 命令副作用。

### 6.3 执行管线调整

`CommandPalette.tsx` 中的 `applyResult` 应拆成：

```text
normalize result
-> if result.text exists, write to active tab or selection
-> if autoCopyOutput or result.copyToClipboard, write clipboard
-> if result.openUrl exists, call shell open
-> if notification exists, show app notification/toast
-> if quick mode and autoHideAfterRun, hide window
```

注意：`openUrl` 应只允许 http、https、mailto 等安全 scheme。不要在阶段 1 支持 `file://` 或 shell-like scheme。

## 7. Tauri 技术改造

### 7.1 全局快捷键

需要引入 Tauri v2 全局快捷键插件：

```bash
npm install @tauri-apps/plugin-global-shortcut
cargo add tauri-plugin-global-shortcut
```

Rust 侧注册全局快捷键，触发时执行：

```text
show window
unminimize window
set focus
emit frontend event: fluxtext://global-launch
```

前端监听该事件后：

```text
read clipboard
open quick tab
set activeView = editor
set commandPaletteOpen = true
focus command input
```

### 7.2 窗口管理

推荐将窗口管理调整为后台常驻：

- 启动时创建主 WebView。
- 用户关闭窗口时默认隐藏，而不是退出应用。
- 全局快捷键使用 `show()` / `hide()` 切换窗口。
- 不销毁 WebView，降低呼出延迟。

可选配置：

- macOS 上 Dock 点击显示完整模式。
- 托盘点击显示完整模式。
- 全局快捷键显示快速模式。

### 7.3 权限配置

`src-tauri/capabilities/default.json` 当前已有剪贴板、文件、dialog、shell open 等权限。

第一阶段可能新增：

- global shortcut 权限。
- notification 权限，若使用系统通知。

仍需避免新增：

- shell execute 权限。
- 过宽文件系统权限。

### 7.4 跨平台风险

需要明确记录平台差异：

- macOS：全局快捷键和聚焦通常可行，但可能受到系统辅助功能和焦点策略影响。
- Windows：快捷键冲突概率更高，需要失败提示和重新绑定能力。
- Linux X11：通常可行。
- Linux Wayland：全局快捷键支持不稳定，应标记为已知限制。

第一阶段验收可以优先 macOS，Windows 作为第二验收平台，Linux 标记兼容性风险。

## 8. 状态与设置设计

建议新增设置项：

```ts
settings: {
  globalShortcut: string
  openCommandPaletteOnGlobalLaunch: boolean
  useClipboardOnGlobalLaunch: boolean
  autoCopyOutput: boolean
  hideAfterQuickAction: boolean
  quickTabBehavior: 'reuse' | 'new'
}
```

第一阶段建议默认值：

```ts
globalShortcut = 'CommandOrControl+Shift+Space'
openCommandPaletteOnGlobalLaunch = true
useClipboardOnGlobalLaunch = true
autoCopyOutput = true
hideAfterQuickAction = false
quickTabBehavior = 'reuse'
```

`hideAfterQuickAction` 不建议默认开启。第一次版本先让用户看见结果，避免“执行了但不知道发生了什么”。

## 9. Roadmap

### 9.1 阶段 1：全局呼出的文本增强工具

目标：

```text
让当前所有文本 Action 通过全局入口随时可用。
```

验收标准：

- 应用后台常驻。
- 全局快捷键可以显示 / 隐藏窗口。
- 呼出后 Command Palette 自动打开并聚焦。
- 剪贴板文本进入 Quick Tab。
- 现有内置 Action 在 Quick Tab 中可正常执行。
- 执行结果可自动复制到剪贴板。
- 主编辑器内容不会被 Quick Tab 覆盖。

### 9.2 阶段 1.5：安全与可靠性补强

目标：

```text
在引入更多副作用前，建立最低限度的脚本安全边界。
```

候选能力：

- Action 来源标识。
- 远程脚本首次执行信任提示。
- URL 打开 scheme 白名单。
- 脚本执行超时保护。
- 运行错误结构化展示。
- 记录 Action 运行耗时。
- 为未来权限声明预留字段。

### 9.3 阶段 2：开发者命令工作台

目标：

```text
从文本 Action 扩展到开发者命令和轻量工作流。
```

候选能力：

- 引入 `CommandDef` 或在 `ActionDef` 上增加 `kind`。
- 支持 `text`、`command`、`workflow` 等类型。
- 支持最近使用、收藏、别名、自定义快捷键。
- 支持 JSONPath / jq 类查询。
- 支持 API 请求工具。
- 支持 Git、日志解析、JWT、SQL、时间戳等开发者命令包。
- 支持 Action 串联编排。

阶段 2 才考虑改变核心抽象，因为这时会有足够真实场景验证分类是否必要。

### 9.4 阶段 3：插件生态

目标：

```text
形成可扩展生态，但仍然围绕开发者、文本和本地效率场景。
```

候选能力：

- 插件仓库或市场。
- 插件 manifest。
- 插件签名和来源校验。
- 插件权限模型。
- 插件本地存储 API。
- 插件 UI SDK。
- 后台任务。
- 更深系统集成。

阶段 3 的前置条件：

- 阶段 1 的全局入口体验稳定。
- 阶段 2 的命令抽象已经被真实命令验证。
- 脚本安全模型已经有基础。

## 10. 第一阶段实施拆分

建议按以下顺序实施：

1. 引入 global shortcut 插件，并完成 Rust 侧注册。
2. 将窗口行为调整为后台常驻和 `hide/show`。
3. 前端监听全局呼出事件。
4. 增加 `launchMode` 和 Quick Tab 状态。
5. 将 `editorText` 兼容迁移到 active tab。
6. 呼出时读取剪贴板并写入 Quick Tab。
7. 呼出后自动打开 Command Palette。
8. 扩展 `ActionResult`，保持 `{ text }` 兼容。
9. 执行结果支持自动复制到剪贴板。
10. 增加设置项和基础 UI。
11. 验证 macOS 和至少一个非 macOS 平台。

## 11. 主要风险

### 11.1 全局快捷键体验

风险：

- 快捷键被其他应用占用。
- Wayland 支持不稳定。
- macOS 焦点策略导致窗口显示后输入框未聚焦。

缓解：

- 提供快捷键注册失败提示。
- 支持用户重新绑定。
- 前端收到 launch event 后延迟一次 focus。
- Rust 侧先 `show`、`unminimize`、`set_focus`，再 emit 事件。

### 11.2 Quick Tab 迁移风险

风险：

- 当前 `editorText` 是单值状态，多处代码直接依赖。
- 一次性迁移完整多 tab 容易扩大改动面。

缓解：

- 第一阶段只做单 Quick Tab。
- 保留 `editorText` / `setEditorText` 兼容接口。
- 内部改为 active tab，外部逐步迁移。

### 11.3 脚本安全风险

风险：

- 当前脚本通过 `new Function()` 执行。
- 远程脚本和 CDN 依赖具备供应链风险。
- 一旦开放更多副作用，风险会放大。

缓解：

- 第一阶段只开放自动复制、打开白名单 URL、通知。
- 暂缓 shell 执行。
- 阶段 1.5 补信任提示、权限声明和执行保护。

## 12. 非目标

第一阶段明确不做：

- 完整多窗口系统。
- 完整多标签 UI。
- 通用 App 启动器。
- 插件市场。
- Shell 命令运行器。
- 剪贴板历史管理器。
- 自动化平台。
- 账号、云同步和协作能力。

## 13. 决策记录

- 全局呼出前置到第一阶段，因为它决定工具平台体验。
- 剪贴板内容进入 Quick Tab，而不是覆盖主编辑器。
- 第一阶段继续使用 `ActionDef`，不引入 `CommandDef`。
- 只扩展兼容型 `ActionResult`，不破坏现有脚本。
- 第一阶段默认打开 Command Palette，但保留完整编辑器。
- 本地 shell 命令执行暂缓，等待安全模型明确。

