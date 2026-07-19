# hiven 项目指令

本文件补充全局 AGENTS.md，适用于 `/Users/bytedance/flux_text`。

## 语言与产物

- 默认使用中文回复和写文档。
- 文档放在 `doc/`。
- 临时文件放在 `temp/`，任务结束后删除无保留价值的中间文件。

## 插件系统边界

hiven framework 是 plugin host，不是具体工具能力集合。

Framework 只负责：

```text
plugin registry / command / renderer / panel
renderer lifecycle
workspace / pane 状态
pane 文本读写、聚焦、选择
editor primitive、Monaco instance lifecycle、decorations bridge
settings / context
effect runner / surface occupancy
```

Framework 不应包含：

```text
diff API
compare API
DiffSurface
CompareRenderer
TextDiffRenderer
JSON / Markdown / AST / code semantic 逻辑
line diff / semantic diff 算法
dual-pane diff layout
具体插件的 toolbar、fallback、展示文案或产品策略
```

判断口径：

```text
如果一个概念带有 diff、compare、JSON、Markdown、AST、code semantic 等产品语义，
默认不属于 framework。
```

## Diff 能力原则

Diff 是插件产品，不是 framework 能力。

- `text-diff`、`json-diff`、`markdown-diff` 等都应作为 first-party plugins。
- `core.diff` 不应变成 JSON-aware 默认入口。
- JSON parse、semantic diff、array compare mode、key order 策略、invalid JSON fallback、JSON toolbar 和展示文案属于 `json-diff` 插件。
- 插件之间不运行时依赖；例如 `json-diff` 不依赖 `text-diff`。
- 多个插件共享的纯算法可以下沉到 kit，例如 `diff-kit`，但 kit 不是插件，也不是 framework API。

Kit 准入规则：

```text
1. 需要 framework 对象 -> 不进 kit。
2. 持有运行时状态或副作用 -> 不进 kit。
3. 只服务一个插件的一种产品策略 -> 不进 kit，留在插件内部。
```

允许的依赖方向：

```text
plugins -> workspace public API
plugins -> kits
workspace/framework -> 不依赖 plugins
kits -> 不依赖 workspace/framework，也不依赖 plugins
```

相关决策文档：

```text
doc/diff-plugin-boundary-decision.md
```

## 插件目录与协议

- 插件以目录包为基本单位，目录约定优先于冗余 manifest 配置。
- 插件入口使用固定入口文件约定，例如 `index.tsx`、`index.ts`、`index.jsx`、`index.js`、`index.mjs`；不要让 manifest 承担过多 entry/source/migration 逻辑。
- 旧脚本迁移应释放为普通 installed plugin directory，不保留用户可见的 legacy/migration 特殊语义。
- 不要长期依赖旧 command adapter；first-party 插件应显式迁移到当前 launcher/tool 协议。
- first-party 插件也要按外部插件约束实现：通过 host API / SDK 使用能力，不允许直接跨目录 import workspace/framework 内部实现。
- 如果插件缺少能力，应扩展公共 SDK/API，而不是让插件共享或引用 host 私有代码。
- 插件行为、命令、参数或 UI 发生变化时，必须同步更新版本并确保实际释放目录加载到新版本。

## 多语言与用户可见文案

- 所有用户可见文案必须走系统 i18n / locale 能力，不允许 hardcode。
- command title、description、参数 label/hint、参数选项、choice 文案、插件卡片标题、空状态、错误提示、toolbar 文案都必须支持中英文。
- Global Launcher、App 内命令入口、插件页面、Pinned Runner、设置页必须使用同一套多语言管线。
- 新增或修改 first-party 插件时，必须同时补齐对应 locale key，并验证当前 locale 下展示正确。
- 禁止在插件或 framework 中直接写死中文/英文作为最终 UI 文案；临时调试文案不得进入提交。
- 原生托盘菜单文案（`src-tauri/src/lib.rs` 的 `desktop_tray_text()`）因 webview 未加载时读不到应用内 locale，允许按系统环境变量硬编码中英文双语，是唯一被认可的原生层文案例外；新增其它原生 UI 文案不得援引此例外。

## Launcher / Command 交互

- Global Launcher 与 App 内命令入口共享 launcher item / controller 语义，但 I/O 路径必须分离。
- Global Launcher 不应自动展示、激活、隐藏或恢复主窗口；打开/关闭都不应改变原前台应用状态。
- App 编辑器页面在前台时快捷键唤起端内命令入口，否则唤起 Global Launcher。
- App 内命令入口只允许在主编辑器页面打开；插件页面、Pinned Runner 页面不应打开端内命令面板。
- Global Launcher 默认是搜索与输入入口；剪贴板只能通过 Object Block / 推荐动作进入，不应直接当普通输入。
- 参数、choices、动态输出必须由统一 launcher controller 承载；禁止回退到旧表单、native select 或额外弹窗。
- 命令必须声明是否支持 quick run；Base64、Set Language、Diff panel 选择等关键分支命令必须让用户明确选择。
- App 内输出默认写当前 editor/pane，Global 输出默认展示在 launcher 或写剪贴板，二者不能串路。
- IME composition 必须全局处理，中文输入法 Enter 上屏不能触发命令确认。

## hiven Diff/UI 历史偏好

- Diff 在产品上首先是文本工具，不是代码审查工具，也不是 code diff。
- 如果需要自建 UI，可以由插件自建；不要因此把双栏 diff 体验吸收到 framework。
- 不要把 Monaco/code editor 的实现细节泄漏成 `CodeDiff`、`CompareRenderer` 等框架概念。
- 如果视觉体验继续迭代，先明确插件边界，再改 UI。

## 验证要求

修改 diff、插件系统、workspace renderer 或 UI 后，至少执行：

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
```

如果执行 `npm run lint`，需注意当前仓库可能存在历史 lint 问题或 ignored worktree 干扰；最终结论要区分历史问题和本次新增问题。

涉及可视化 diff/UI 的改动，尽量补浏览器验证，重点看真实 DOM/画面效果，而不是只看构建通过。
