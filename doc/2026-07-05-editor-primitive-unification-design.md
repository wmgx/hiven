# Editor Primitive 统一设计（TextEditorCore + EditorSurface）

日期：2026-07-05
状态：已评审通过，待实施

## 背景与问题

项目中存在三处独立手写的 Monaco 装配代码：

| 位置 | 角色 |
|------|------|
| `src/components/workspace/PaneEditor.tsx` | workspace pane 编辑器（EditorWindow 内） |
| `src/components/quickEditor/QuickEditorPanel.tsx` | quick editor（launcher 进入 / detached 窗口） |
| `src/kits/ui/DualEditorView.tsx` | diff 双栏视图（textDiff 插件经 SDK 使用） |

三处重复实现了：Monaco 挂载、flux theme 注册、hover overlay、disposable 管理、
外部文本同步（`isLocalChange` / skip 回声抑制 + `executeEdits('external', fullRange)`）、
光标/选区/滚动追踪、Cmd+F/H find-replace 覆盖、几乎相同的 options 块；
PaneEditor 与 QuickEditorPanel 还各自维护一份几乎相同的状态栏。

### 已否决的方向：QuickEditor 套用 EditorWindow

EditorWindow 是完整的独立窗口 runtime（plugin runtime 启动、editor bridge handlers、
surface instance 注册、active editor snapshot 发布、窗口级快捷键与关闭逻辑），
不是可嵌入的 editor widget。将其嵌入 QuickEditor 会导致 runtime 副作用重复注册、
surface registry 语义混乱、快捷键冲突、状态模型（pane 模型 vs 单文本模型）错配。
本设计不触碰 EditorWindow / EditorView 层。

### 产品心智模型

PaneEditor 与 QuickEditorPanel 本质是**同一个编辑器**的两种展示形态
（一个在 workspace pane 内，一个由 launcher 进入 / 独立窗口展示）；
DualEditorView 是编辑器的**另一种视图形态**（双栏对比）。
缺失的是一个无副作用、可复用的 editor primitive 层。

## 架构决策

### 分层

```text
┌─ kit 层（中立，不依赖 framework）────────────────────────┐
│ src/kits/editor/TextEditorCore.tsx                      │
│ src/kits/editor/types.ts                                │
│   Monaco 装配 primitive：挂载/theme/hover/disposables/   │
│   外部文本同步/光标选区滚动上抛/baseline options/标准快捷键 │
└──────────────┬──────────────────────────┬───────────────┘
               │                          │
┌──────────────┴───────────────┐  ┌───────┴────────────────┐
│ framework：EditorSurface      │  │ kit：DualEditorView     │
│ 产品心智上的"那一个编辑器组件"   │  │ = 2 × TextEditorCore    │
│ = TextEditorCore              │  │ + 滚动同步 + 红绿行高亮   │
│ + EditorStatusBar（内置）      │  │ （diff 语义留在使用侧，   │
│ + 共享行为（find、粘贴语言检测） │  │  不进 framework）        │
│ 接受 binding + 展示配置        │  │                         │
└──────┬────────────────┬──────┘  └─────────────────────────┘
       │                │
┌──────┴──────┐  ┌──────┴──────────┐
│ pane 形态    │  │ quick 形态       │
│ binding =    │  │ binding =        │
│ workspace    │  │ quickEditorStore │
│ pane 模型    │  │（launcher 内嵌与  │
│              │  │ detached 共用）   │
└─────────────┘  └─────────────────┘
```

### 依赖规则维持不变

`kits 不依赖 workspace/framework` 规则**保留**。理由：

1. kits 通过 `pluginHostSdk.ts` 直接注入插件（`kits.DualEditorView`、`kits.diff.*`），
   若 kit 引用 framework 内部实现，插件将间接持有 framework 内部对象，
   插件外部化路线（`core-plugin-externalization-plan`）失效。
2. 规则由 `scripts/check-architecture.mjs` 机器强制，是插件边界的承重墙。
3. 该规则并非本次分层的成因：DualEditorView 需要的是裸编辑器
   （无状态栏、无 binding、无 i18n、双实例 + options 覆盖），
   即使无此规则，TextEditorCore 与 EditorSurface 的拆分依然是产品形态所需，
   规则只决定 TextEditorCore 的文件位置在 `kits/`。
4. 放在 `kits/` 的额外收益：未来可将 `TextEditorCore` 加入 SDK 注入，
   让插件页面挂载标准编辑器。

TextEditorCore 满足 kit 准入三条：不需要 framework 对象；
不持有全局运行时状态（仅组件内 ref）；服务多个宿主。

`EditorStatusBar` 放 framework 侧（使用 `useT` i18n，不进 kit）。

## API 设计

### kit 层 `TextEditorCore`

```ts
// src/kits/editor/types.ts
interface EditorActionSpec {
  id: string
  label: string
  keybindings: number[]
  run: (editor: IStandaloneCodeEditor) => void
}

interface LineDecorationSpec {
  lines: number[]
  className: string
  rulerColor: string
}

interface TextEditorCoreProps {
  value: string                 // 受控文本；外部变更同步（回声抑制）内建
  language: string              // 动态 setModelLanguage 内建
  theme: string
  fontSize: number              // 展示参数由宿主传入，kit 不读 settings
  lineNumbers: boolean
  wordWrap: boolean
  stickyScroll?: boolean
  optionOverrides?: IStandaloneEditorConstructionOptions
  actions?: EditorActionSpec[]
  lineDecorations?: LineDecorationSpec[]   // 声明式行装饰（通用机制，无 diff 语义）
  onChange?: (text: string) => void
  onFocus?: () => void
  onCursorChange?: (pos: { lineNumber: number; column: number }) => void
  onSelectionChange?: (info: { selection: SelectionRange | null; selectedCharCount: number }) => void
  onScrollChange?: (pos: { scrollTop: number; scrollLeft: number }) => void
  onReady?: (editor: IStandaloneCodeEditor) => (() => void) | void  // 逃生舱，可返回 cleanup
}

interface TextEditorCoreHandle {  // forwardRef
  getEditor(): IStandaloneCodeEditor | null
  focus(): void
  setCursorPosition(pos: Position): void
  setScrollPosition(pos: ScrollPosition): void
  openFindReplace(): void
}
```

注意：`Position` / `ScrollPosition` / `SelectionRange` 在 `kits/editor/types.ts` 中
自行定义为普通结构类型（或取自 `monaco-editor` 类型），**禁止**从 workspace/framework
import，否则违反 kit 依赖规则。framework 侧 binding 处做类型对接。

内部固定承担：theme 注册、hover overlay、disposable bucket、
外部文本同步 trick（全项目唯一一份）、folding / lineDecorationsWidth 动态策略、
拉齐后的 baseline options、Cmd+F/H find-replace 覆盖。
`onReady` 返回的 cleanup 保证在 editor dispose 前执行；
行装饰清理保留现有 try/catch 容错语义。

### framework 层 `EditorSurface`

```ts
interface EditorTextBinding {          // 两种形态唯一的本质差异点
  text: string
  language: string
  onTextChange(text: string): void
  onSelectionChange?(sel: SelectionRange | null): void   // pane 形态写 store
  initialCursor?: Position             // quick 形态恢复现场
  initialScroll?: ScrollPosition
  onCursorChange?(pos: Position): void
  onScrollChange?(pos: ScrollPosition): void
}

interface EditorSurfaceProps {
  binding: EditorTextBinding
  statusBar?: { leading?: ReactNode; trailing?: ReactNode; languageStatus?: string }
  actions?: EditorActionSpec[]         // pane: Cmd+W；quick: Cmd+K
  overlay?: ReactNode                  // quick: escape 提示 + command overlay
  bottomPanels?: ReactNode             // pane: PaneBottomPanels
  onFocus?(): void                     // pane: setActivePaneId
  onReady?(editor): (() => void) | void  // pane: runtimeRegistry 注册
}
```

EditorSurface 从 `useAppStore` 取 settings / locale / theme，
内部渲染 `TextEditorCore` + `EditorStatusBar`，
状态栏数据（光标、行数、字数、选中数）自行维护；
粘贴语言检测逻辑收敛于此，对两种形态生效。

### 宿主最终形态

- `PaneEditor` ≈ RendererHost 分支 + workspace binding + 配置（约 345 → ~120 行）
- `QuickEditorPanel` ≈ quickStore binding + overlay 配置（约 242 → ~80 行）
- `DualEditorView` = 2 × TextEditorCore + 滚动同步（handle.setScrollPosition）
  + lineDecorations 声明式传入，删除全部手写装配

## 行为拉齐清单

### A 组：装配层拉齐（进 TextEditorCore baseline）

| # | 项 | 现状 | 拉齐后 |
|---|-----|------|--------|
| 1 | tabSize | Pane=4(默认)，Quick=2 | 统一 2 |
| 2 | padding | 三处各不同 | 统一 `{top:12, bottom:12, left:8}` |
| 3 | automaticLayout | 仅 Quick 显式 true | 统一显式 true |
| 4 | folding 策略 | Pane/Dual 动态，Quick 固定 true | 统一动态（plaintext 关闭） |
| 5 | lineDecorationsWidth | Pane 动态 8/24，Quick/Dual 固定 8 | 统一动态（plaintext 24） |
| 6 | Cmd+F/H → find-replace | Dual 为 Monaco 默认 find | 统一覆盖，Dual 也获得 find-replace |
| 7 | 状态栏响应式收缩 | 仅 Pane 有宽度阈值渐隐 | EditorStatusBar 统一响应式 |

### B 组：产品行为拉齐（已拍板）

粘贴语言检测拉齐到 Quick 形态：

- `quickEditorStore` 增加 `languageSource: 'manual' | 'auto'` 字段，
  持久化数据兼容默认 `auto`
- 检测逻辑抽到 EditorSurface 共享，两形态行为一致

### C 组：明确保留的形态差异

- stickyScroll：pane 有 per-pane 开关，quick 固定关闭
- Cmd+W（关 pane）/ Cmd+K（quick overlay）/ Escape：各形态专属，走 `actions` / `overlay` 注入
- Dual 的 `renderLineHighlight:'none'`、`overviewRulerLanes:3`：走 `optionOverrides`

## 数据流

```text
用户输入 → Monaco → TextEditorCore.onChange → EditorSurface → binding.onTextChange → store
store 外部变更（命令/插件写入）→ value prop → TextEditorCore 同步（回声抑制，光标不动）
光标/选区/滚动 → TextEditorCore 回调 → EditorSurface（状态栏自用 + binding 透传持久化）
```

## 迁移顺序（每步独立可验证、可提交）

1. 新建 `kits/editor/TextEditorCore` + `types`（纯新增，不接线）
2. `DualEditorView` 切到 2 × TextEditorCore
   （使用方唯一、行为最易黑盒验证：滚动同步、红绿高亮、双向编辑）
3. framework 侧新建 `EditorSurface` + `EditorStatusBar`
4. `QuickEditorPanel` 切到 EditorSurface
   （含 quickEditorStore 加 `languageSource`、粘贴检测拉齐）
5. `PaneEditor` 切到 EditorSurface（RendererHost 分支保留在外层）
6. 删除三处旧装配代码，收尾

## 连带影响（必须处理）

- `scripts/test-monaco-disposable-lifecycle.mjs`、`scripts/test-sticky-scroll-toggle.mjs`、
  `scripts/test-spatial-ui-contract.mjs` 直接 grep DualEditorView 源码文本做契约断言，
  重构后必须同步更新锚点（断言语义不变）
- `check-architecture.mjs` 已覆盖 `src/kits`，新目录 `kits/editor` 自动纳入检查
- i18n：状态栏复用现有 `editor` namespace key，无新增文案、无硬编码

## 验证标准

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
node scripts/test-monaco-disposable-lifecycle.mjs   # 及其他受影响契约测试
```

浏览器手动验证四场景：

1. pane 编辑：多 pane、粘贴语言检测、Cmd+W、状态栏响应式
2. quick 从 launcher 进入：编辑、Cmd+K、find/replace
3. quick detached 窗口：Escape、现场恢复（光标/滚动）、粘贴检测
4. diff 双栏：滚动同步、红绿高亮、双侧编辑、Cmd+F find-replace

## 范围外（明确不做）

- EditorWindow / EditorView / plugin runtime / editor bridge 层不动
- 不将 TextEditorCore 加入 SDK 注入（留作后续独立迭代）
- 不改变 launcher 与 quick editor 的进入/退出交互
