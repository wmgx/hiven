# Editor Primitive 统一 实施计划

> **For agentic workers:** 本计划面向零上下文执行者（外部 Codex）。按 Task 顺序执行，
> 每个 Task 独立可验证、独立提交。步骤使用 checkbox（`- [ ]`）跟踪。
> 依据设计文档：`doc/2026-07-05-editor-primitive-unification-design.md`（先通读一遍）。
>
> 职责说明：经用户决定，本计划由外部单执行者实施，放弃多 agent TDD 职责隔离；
> 最终验收由用户在主会话复核（浏览器手动验证清单见 Task 7）。

**目标：** 抽出无副作用的 Monaco 装配 primitive（`TextEditorCore`），
让 PaneEditor / QuickEditorPanel 统一为同一个 `EditorSurface` 组件的两种形态，
DualEditorView 重建为 2 × TextEditorCore，删除三处重复装配代码。

**架构：** kit 层 `src/kits/editor/TextEditorCore.tsx`（纯装配，不依赖 framework）；
framework 层 `src/components/editor/EditorSurface.tsx`（= core + 状态栏 + 共享行为，
接受 binding）+ `EditorStatusBar.tsx`。宿主只提供 binding 与形态配置。

**技术栈：** React 18 函数组件、zustand、`@monaco-editor/react`、`monaco-editor`、
契约测试为 `scripts/test-*.mjs`（node 直接运行、grep 源码断言）。

---

## 全局规则（每个 Task 都适用）

1. **禁止 `git add -A` / `git add .`**。工作区有与本计划无关的未提交改动
   （`src-tauri/src/lib.rs`、`src/workspace/launcher/*` 等），只 `git add` 各 Task 明确列出的文件。
2. 先创建分支：`git checkout -b refactor/editor-primitive-unification`（基于当前分支 `refactor/workbench-window-architecture`）。
3. 所有用户可见文案走 i18n（本计划复用现有 `editor` / `quickEditor` namespace key，**不新增 key，不写死文案**）。
4. 不修改 `src/components/EditorWindow.tsx`、`src/views/EditorView.tsx`、plugin runtime、editor bridge 相关文件。
5. 契约测试更新只允许改锚点位置/文件路径，**不允许削弱断言语义**。

## 基线（2026-07-05 实测，执行前先复核一遍）

`npm run build` 通过（仅 chunk size 警告）。`npm run check:architecture` 需在 Task 0 实测记录。

以下契约测试**在重构前就已失败**（历史遗留，与本计划无关，不要试图修复其失败原因）：

| 脚本 | 既有失败原因 |
|------|-------------|
| `test-monaco-disposable-lifecycle.mjs` | `jsFilter panel should dispose editor subscriptions on unmount` |
| `test-sticky-scroll-toggle.mjs` | ENOENT：`src/plugins/textDiff/TextDiffRenderer.tsx` 已不存在 |
| `test-spatial-ui-contract.mjs` | `Scripts view should use segmented controls for plugin tabs` |
| `test-quick-editor-launcher-behavior.mjs` | `Quick Editor mode should preserve the design-required blur-to-close behavior` |
| `test-refactor-final-acceptance.mjs` | launcher lifecycle 相关断言 |
| `test-window-architecture-phases.mjs` | `editor window opener must delegate lifecycle to the native window manager` |

**验收口径：这些脚本重构后的失败原因必须与上表一致（不新增失败点）；
当前通过的脚本必须保持通过。**

---

### Task 0: 建分支、记录基线

**Files:** 无代码改动

- [ ] **Step 1: 建分支**

```bash
git checkout -b refactor/editor-primitive-unification
```

- [ ] **Step 2: 记录基线**

```bash
npm run check:architecture
for s in scripts/test-*.mjs; do node "$s" >/dev/null 2>&1 && echo "PASS $s" || echo "FAIL $s"; done
```

把输出保存到 `temp/editor-primitive-baseline.txt`（temp 目录若不存在则创建）。
预期 FAIL 集合与上文基线表一致；如有出入，停下来向用户确认后再继续。

---

### Task 1: 边界契约测试（先写，先失败）

**Files:**
- Create: `scripts/test-editor-primitive-boundary.mjs`
- Modify: `package.json`（scripts 增加一行）

- [ ] **Step 1: 写契约测试**

创建 `scripts/test-editor-primitive-boundary.mjs`，内容如下：

```js
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  const absolute = join(root, path)
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : ''
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const coreTypes = read('src/kits/editor/types.ts')
const core = read('src/kits/editor/TextEditorCore.tsx')
const surface = read('src/components/editor/EditorSurface.tsx')
const statusBar = read('src/components/editor/EditorStatusBar.tsx')
const paneEditor = read('src/components/workspace/PaneEditor.tsx')
const quickPanel = read('src/components/quickEditor/QuickEditorPanel.tsx')
const dualEditor = read('src/kits/ui/DualEditorView.tsx')

// 1. kit primitive 存在且不依赖 framework
assert(coreTypes.length > 0, 'kits/editor/types.ts should exist')
assert(core.length > 0, 'kits/editor/TextEditorCore.tsx should exist')
for (const [label, text] of [['types', coreTypes], ['TextEditorCore', core]]) {
  assert(!/from '.*\/(workspace|components|store|i18n|plugins)\//.test(text) &&
    !/from '\.\.\/\.\.\/(workspace|components|store|i18n|plugins)'/.test(text),
    `kits/editor ${label} must not import framework modules`)
}

// 2. core 承载统一 baseline（行为拉齐锚点）
assert(/tabSize:\s*2/.test(core), 'TextEditorCore should own the unified tabSize baseline')
assert(/automaticLayout:\s*true/.test(core), 'TextEditorCore should own automaticLayout baseline')
assert(/padding:\s*\{\s*top:\s*12,\s*bottom:\s*12,\s*left:\s*8\s*\}/.test(core),
  'TextEditorCore should own the unified padding baseline')
assert(/executeEdits\('external'/.test(core), 'TextEditorCore should own the external value sync')
assert(/startFindReplaceAction/.test(core), 'TextEditorCore should own the find-replace override')

// 3. EditorSurface = core + 状态栏 + 共享行为
assert(/<TextEditorCore/.test(surface), 'EditorSurface should render TextEditorCore')
assert(/<EditorStatusBar/.test(surface), 'EditorSurface should render EditorStatusBar')
assert(/detectEditorLanguage/.test(surface), 'EditorSurface should own shared paste language detection')
assert(/useT\('editor'\)/.test(statusBar), 'EditorStatusBar should use editor i18n namespace')

// 4. 宿主收敛：不再各自装配 Monaco
for (const [label, text] of [
  ['PaneEditor', paneEditor],
  ['QuickEditorPanel', quickPanel],
  ['DualEditorView', dualEditor],
]) {
  assert(!text.includes('@monaco-editor/react'),
    `${label} must not mount @monaco-editor/react directly anymore`)
  assert(!/executeEdits\('external'/.test(text),
    `${label} must not re-implement external text sync`)
}
assert(/<EditorSurface/.test(paneEditor), 'PaneEditor should render EditorSurface')
assert(/<EditorSurface/.test(quickPanel), 'QuickEditorPanel should render EditorSurface')
assert(/<TextEditorCore/.test(dualEditor), 'DualEditorView should compose TextEditorCore')

console.log('editor primitive boundary checks passed')
```

- [ ] **Step 2: package.json 注册**

在 `package.json` 的 `scripts` 中（`"check:architecture"` 一行之后）加入：

```json
"test:editor-primitive-boundary": "node scripts/test-editor-primitive-boundary.mjs",
```

- [ ] **Step 3: 运行确认失败**

```bash
node scripts/test-editor-primitive-boundary.mjs
```

预期：FAIL，错误为 `kits/editor/types.ts should exist`。

- [ ] **Step 4: 提交**

```bash
git add scripts/test-editor-primitive-boundary.mjs package.json
git commit -m "test: add editor primitive boundary contract"
```

---

### Task 2: kit 层 TextEditorCore

**Files:**
- Create: `src/kits/editor/types.ts`
- Create: `src/kits/editor/TextEditorCore.tsx`

- [ ] **Step 1: 创建 `src/kits/editor/types.ts`**

```ts
import type { editor as MonacoEditor } from 'monaco-editor'

export interface EditorPosition {
  lineNumber: number
  column: number
}

export interface EditorScrollPosition {
  scrollTop: number
  scrollLeft: number
}

export interface EditorSelectionRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export interface EditorSelectionInfo {
  selection: EditorSelectionRange | null
  selectedCharCount: number
}

export interface EditorActionSpec {
  id: string
  label: string
  keybindings: number[]
  run: (editor: MonacoEditor.IStandaloneCodeEditor) => void
}

export interface LineDecorationSpec {
  lines: number[]
  className: string
  rulerColor: string
}

export interface TextEditorCoreHandle {
  getEditor(): MonacoEditor.IStandaloneCodeEditor | null
  focus(): void
  setCursorPosition(position: EditorPosition): void
  setScrollPosition(position: EditorScrollPosition): void
  openFindReplace(): void
}

export interface TextEditorCoreProps {
  value: string
  language: string
  theme: string
  fontSize: number
  lineNumbers: boolean
  wordWrap: boolean
  stickyScroll?: boolean
  optionOverrides?: MonacoEditor.IStandaloneEditorConstructionOptions
  actions?: EditorActionSpec[]
  lineDecorations?: LineDecorationSpec[]
  onChange?: (text: string) => void
  onFocus?: () => void
  onCursorChange?: (position: EditorPosition) => void
  onSelectionChange?: (info: EditorSelectionInfo) => void
  onScrollChange?: (position: EditorScrollPosition) => void
  onReady?: (editor: MonacoEditor.IStandaloneCodeEditor) => (() => void) | void
}
```

**约束**：此目录禁止 import `workspace` / `components` / `store` / `i18n` / `plugins`
（`check:architecture` 会强制其中两项；Task 1 的契约测试盯全部五项）。

- [ ] **Step 2: 创建 `src/kits/editor/TextEditorCore.tsx`**

```tsx
/**
 * Monaco assembly primitive. Owns editor mounting, theme registration, hover
 * overlay, disposable lifecycle, external value sync, and the harmonized
 * baseline options. Pure UI kit: no framework imports, no global state.
 * Hosts own all product semantics (stores, hotkey products, status bars).
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Editor from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type { editor as MonacoEditor } from 'monaco-editor'
import { createMonacoDisposableBucket } from '../../utils/monacoDisposables'
import { registerFluxMonacoThemes } from '../../utils/monacoTheme'
import { installMonacoHoverOverlay } from '../../utils/monacoHoverOverlay'
import type { TextEditorCoreHandle, TextEditorCoreProps } from './types'

export const TextEditorCore = forwardRef<TextEditorCoreHandle, TextEditorCoreProps>(
  function TextEditorCore(props, ref) {
    const {
      value,
      language,
      theme,
      fontSize,
      lineNumbers,
      wordWrap,
      stickyScroll = false,
      optionOverrides,
      lineDecorations,
    } = props

    const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
    const disposablesRef = useRef<ReturnType<typeof createMonacoDisposableBucket> | null>(null)
    const onReadyCleanupRef = useRef<(() => void) | null>(null)
    const decorationIdsRef = useRef<string[]>([])
    const isLocalChange = useRef(false)
    const propsRef = useRef(props)
    propsRef.current = props

    const foldingEnabled = language !== 'plaintext'
    // Monaco adds 16px for folding controls, so plaintext editors reserve it manually.
    const lineDecorationsWidth = foldingEnabled ? 8 : 24

    useImperativeHandle(ref, () => ({
      getEditor: () => editorRef.current,
      focus: () => editorRef.current?.focus(),
      setCursorPosition: (position) => editorRef.current?.setPosition(position),
      setScrollPosition: (position) => editorRef.current?.setScrollPosition(position),
      openFindReplace: () => {
        editorRef.current?.getAction('editor.action.startFindReplaceAction')?.run()
      },
    }), [])

    const applyDecorationsTo = (editor: MonacoEditor.IStandaloneCodeEditor) => {
      const specs = propsRef.current.lineDecorations
      const decorations = (specs ?? []).flatMap((spec) => spec.lines.map((line) => ({
        range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
        options: {
          isWholeLine: true,
          className: spec.className,
          overviewRuler: { color: spec.rulerColor, position: 7 },
        },
      })))
      decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, decorations)
    }

    // Sync external value changes without resetting cursor. Local edits are
    // only swallowed when the model already matches the incoming value.
    useEffect(() => {
      const editor = editorRef.current
      if (!editor) return
      const model = editor.getModel()
      if (isLocalChange.current) {
        isLocalChange.current = false
        if (model?.getValue() === value) return
      }
      if (model && model.getValue() !== value) {
        const fullRange = model.getFullModelRange()
        editor.executeEdits('external', [{
          range: fullRange,
          text: value,
          forceMoveMarkers: false,
        }])
      }
    }, [value])

    useEffect(() => {
      const editor = editorRef.current
      const model = editor?.getModel()
      if (!editor || !model) return
      if (model.getLanguageId() !== language) {
        monaco.editor.setModelLanguage(model, language)
      }
      editor.updateOptions({
        folding: foldingEnabled,
        lineDecorationsWidth,
        stickyScroll: { enabled: stickyScroll },
      })
    }, [language, foldingEnabled, lineDecorationsWidth, stickyScroll])

    useEffect(() => {
      const editor = editorRef.current
      if (!editor) return
      applyDecorationsTo(editor)
    }, [lineDecorations])

    useEffect(() => {
      return () => {
        const editor = editorRef.current
        if (editor && decorationIdsRef.current.length > 0) {
          try {
            editor.deltaDecorations(decorationIdsRef.current, [])
          } catch {
            // Editor may already be disposed during teardown.
          }
        }
        decorationIdsRef.current = []
        onReadyCleanupRef.current?.()
        onReadyCleanupRef.current = null
        disposablesRef.current?.dispose()
        disposablesRef.current = null
        editorRef.current = null
      }
    }, [])

    return (
      <Editor
        height="100%"
        defaultValue={value}
        defaultLanguage={language}
        beforeMount={registerFluxMonacoThemes}
        onChange={(v) => {
          isLocalChange.current = true
          propsRef.current.onChange?.(v ?? '')
        }}
        onMount={(editor) => {
          registerFluxMonacoThemes(monaco)
          onReadyCleanupRef.current?.()
          onReadyCleanupRef.current = null
          disposablesRef.current?.dispose()
          const disposables = createMonacoDisposableBucket()
          disposablesRef.current = disposables
          installMonacoHoverOverlay(editor)
          editorRef.current = editor
          decorationIdsRef.current = []

          disposables.add(editor.onDidFocusEditorText(() => {
            propsRef.current.onFocus?.()
          }))
          disposables.add(editor.onDidChangeCursorPosition((e) => {
            propsRef.current.onCursorChange?.({
              lineNumber: e.position.lineNumber,
              column: e.position.column,
            })
          }))
          disposables.add(editor.onDidChangeCursorSelection(() => {
            const model = editor.getModel()
            const selections = editor.getSelections() ?? []
            const selectedCharCount = model
              ? selections.reduce((total, selection) => (
                selection.isEmpty() ? total : total + model.getValueLengthInRange(selection)
              ), 0)
              : 0
            const selection = editor.getSelection()
            propsRef.current.onSelectionChange?.({
              selection: selection && !selection.isEmpty()
                ? {
                    startLineNumber: selection.startLineNumber,
                    startColumn: selection.startColumn,
                    endLineNumber: selection.endLineNumber,
                    endColumn: selection.endColumn,
                  }
                : null,
              selectedCharCount,
            })
          }))
          disposables.add(editor.onDidScrollChange((e) => {
            propsRef.current.onScrollChange?.({
              scrollTop: e.scrollTop,
              scrollLeft: e.scrollLeft,
            })
          }))
          disposables.add(editor.addAction({
            id: 'find-and-replace',
            label: 'Find and Replace',
            keybindings: [
              monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF,
              monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
              monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH,
            ],
            run: (ed) => {
              ed.getAction('editor.action.startFindReplaceAction')?.run()
            },
          }))
          // Host actions are registered once at mount; `run` stays fresh via
          // propsRef lookup, keybindings/ids are fixed for the editor lifetime.
          for (const action of propsRef.current.actions ?? []) {
            disposables.add(editor.addAction({
              id: action.id,
              label: action.label,
              keybindings: action.keybindings,
              run: (ed) => {
                const current = (propsRef.current.actions ?? [])
                  .find((candidate) => candidate.id === action.id)
                current?.run(ed as MonacoEditor.IStandaloneCodeEditor)
              },
            }))
          }
          applyDecorationsTo(editor)
          const cleanup = propsRef.current.onReady?.(editor)
          if (typeof cleanup === 'function') {
            onReadyCleanupRef.current = cleanup
          }
          disposables.add(editor.onDidDispose(() => {
            onReadyCleanupRef.current?.()
            onReadyCleanupRef.current = null
            if (editorRef.current === editor) editorRef.current = null
            if (disposablesRef.current === disposables) disposablesRef.current = null
            disposables.dispose()
          }))
        }}
        options={{
          fontSize,
          lineNumbers: lineNumbers ? 'on' : 'off',
          wordWrap: wordWrap ? 'on' : 'off',
          minimap: { enabled: false },
          find: { addExtraSpaceOnTop: false },
          scrollBeyondLastLine: false,
          renderLineHighlight: 'line',
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          folding: foldingEnabled,
          stickyScroll: { enabled: stickyScroll },
          glyphMargin: false,
          lineDecorationsWidth,
          lineNumbersMinChars: 3,
          padding: { top: 12, bottom: 12, left: 8 },
          fontFamily: 'var(--font-mono)',
          automaticLayout: true,
          tabSize: 2,
          ...optionOverrides,
        }}
        theme={theme}
      />
    )
  },
)
```

注意保持两个字面锚点（契约测试依赖）：
`const lineDecorationsWidth = foldingEnabled ? 8 : 24` 和
`lineDecorationsWidth,` 紧接下一行 `lineNumbersMinChars: 3`。

- [ ] **Step 3: 验证**

```bash
npm run check:architecture        # 预期 PASS（kits/editor 不违规）
node scripts/test-editor-primitive-boundary.mjs
```

boundary 测试预期：仍 FAIL，但失败点前进到
`EditorSurface should render TextEditorCore`（第 1、2 组断言已通过）。

```bash
npx tsc --noEmit 2>&1 | grep "kits/editor" ; npm run build
```

预期：无 kits/editor 相关类型错误，build PASS。

- [ ] **Step 4: 提交**

```bash
git add src/kits/editor/types.ts src/kits/editor/TextEditorCore.tsx
git commit -m "feat: add TextEditorCore editor primitive kit"
```

---

### Task 3: DualEditorView 重建

**Files:**
- Modify: `src/kits/ui/DualEditorView.tsx`（整文件重写）
- Modify: `scripts/test-monaco-disposable-lifecycle.mjs`
- Modify: `scripts/test-spatial-ui-contract.mjs`
- Modify: `scripts/test-sticky-scroll-toggle.mjs`

**外部契约不变**：props 名称与语义保持不变（textDiff 插件通过 SDK 的
`kits.DualEditorView` 使用它，插件代码不改）。唯一放宽：
`leftStickyScrollEnabled` / `rightStickyScrollEnabled` 变为可选（默认 false），
与实际调用方 `src/plugins/textDiff/DiffPageView.tsx:171-184`（未传该 props）对齐。

- [ ] **Step 1: 重写 `src/kits/ui/DualEditorView.tsx`**

```tsx
/**
 * Generic two-editor Monaco view with synchronized scrolling and line
 * decorations. This is a pure UI kit component: callers own all product
 * semantics, pane binding, and highlight computation.
 */

import { useEffect, useMemo, useRef } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { TextEditorCore } from '../editor/TextEditorCore'
import type { LineDecorationSpec, TextEditorCoreHandle } from '../editor/types'

let cssInjected = false
function ensureCss() {
  if (cssInjected) return
  cssInjected = true
  const style = document.createElement('style')
  style.textContent = `
    .ft-left-change-line  { background: rgba(252, 165, 165, 0.22) !important; }
    .ft-right-change-line { background: rgba(134, 239, 172, 0.22) !important; }
  `
  document.head.appendChild(style)
}

const dualOptionOverrides: MonacoEditor.IStandaloneEditorConstructionOptions = {
  renderLineHighlight: 'none',
  overviewRulerLanes: 3,
}

export function DualEditorView({
  leftText,
  rightText,
  leftHighlights,
  rightHighlights,
  layout,
  language = 'plaintext',
  onLeftFocus,
  onRightFocus,
  onLeftChange,
  onRightChange,
  fontSize,
  lineNumbers,
  wordWrap,
  monacoTheme = 'flux-vscode-light',
  leftStickyScrollEnabled = false,
  rightStickyScrollEnabled = false,
}: {
  leftText: string
  rightText: string
  leftHighlights: number[]
  rightHighlights: number[]
  layout: 'side-by-side' | 'inline'
  language?: string
  onLeftFocus?: () => void
  onRightFocus?: () => void
  onLeftChange?: (text: string) => void
  onRightChange?: (text: string) => void
  fontSize: number
  lineNumbers: boolean
  wordWrap: boolean
  monacoTheme?: string
  leftStickyScrollEnabled?: boolean
  rightStickyScrollEnabled?: boolean
}) {
  const leftRef = useRef<TextEditorCoreHandle | null>(null)
  const rightRef = useRef<TextEditorCoreHandle | null>(null)
  const isSyncing = useRef(false)

  useEffect(() => {
    ensureCss()
  }, [])

  const leftDecorations = useMemo<LineDecorationSpec[]>(() => [{
    lines: leftHighlights,
    className: 'ft-left-change-line',
    rulerColor: 'rgba(252, 165, 165, 0.22)',
  }], [leftHighlights])

  const rightDecorations = useMemo<LineDecorationSpec[]>(() => [{
    lines: rightHighlights,
    className: 'ft-right-change-line',
    rulerColor: 'rgba(134, 239, 172, 0.22)',
  }], [rightHighlights])

  const syncFrom = (source: 'left' | 'right') =>
    (position: { scrollTop: number; scrollLeft: number }) => {
      if (isSyncing.current) return
      const other = source === 'left' ? rightRef.current : leftRef.current
      if (!other) return
      isSyncing.current = true
      other.setScrollPosition(position)
      isSyncing.current = false
    }

  const leftPane = (
    <TextEditorCore
      ref={leftRef}
      value={leftText}
      language={language}
      theme={monacoTheme}
      fontSize={fontSize}
      lineNumbers={lineNumbers}
      wordWrap={wordWrap}
      stickyScroll={leftStickyScrollEnabled}
      optionOverrides={dualOptionOverrides}
      lineDecorations={leftDecorations}
      onChange={onLeftChange}
      onFocus={onLeftFocus}
      onScrollChange={syncFrom('left')}
    />
  )

  const rightPane = (
    <TextEditorCore
      ref={rightRef}
      value={rightText}
      language={language}
      theme={monacoTheme}
      fontSize={fontSize}
      lineNumbers={lineNumbers}
      wordWrap={wordWrap}
      stickyScroll={rightStickyScrollEnabled}
      optionOverrides={dualOptionOverrides}
      lineDecorations={rightDecorations}
      onChange={onRightChange}
      onFocus={onRightFocus}
      onScrollChange={syncFrom('right')}
    />
  )

  const border = '1px solid var(--color-border-tertiary)'

  if (layout === 'side-by-side') {
    return (
      <div style={{ display: 'flex', height: '100%' }}>
        <div style={{ flex: 1, overflow: 'hidden', borderRight: border }}>{leftPane}</div>
        <div style={{ flex: 1, overflow: 'hidden' }}>{rightPane}</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'hidden', borderBottom: border }}>{leftPane}</div>
      <div style={{ flex: 1, overflow: 'hidden' }}>{rightPane}</div>
    </div>
  )
}
```

说明：旧实现的 `skipNextLeftSync` / `isApplying` 回声抑制不再需要——
core 的 value 同步 effect 在「model 已等于 value」时天然 no-op。
外部同步、find-replace（行为拉齐 A6）、语言切换均由 core 承担。

- [ ] **Step 2: 更新 `scripts/test-monaco-disposable-lifecycle.mjs`**

删除 `paneEditor` 与 `dualEditorView` 相关的读取与断言段
（`const paneEditor = ...`、`const dualEditorView = ...` 及其对应 assert 块），
替换为以下段落（`helper` 与 `jsFilter` 段保持原样不动）：

```js
const textEditorCore = read('src/kits/editor/TextEditorCore.tsx')

assert(/disposablesRef/.test(textEditorCore), 'TextEditorCore should keep a per-mount Monaco disposable bucket')
assert(/disposablesRef\.current\?\.dispose\(\)/.test(textEditorCore), 'TextEditorCore should dispose the previous/current bucket')
assert(/editorRef\.current\s*=\s*null/.test(textEditorCore), 'TextEditorCore should clear the Monaco editor ref during disposal')
assert(/decorationIdsRef\.current\s*=\s*\[\]/.test(textEditorCore), 'TextEditorCore should clear decoration ids during disposal')
assertTracksAll(textEditorCore, 'TextEditorCore', [
  'editor.onDidFocusEditorText',
  'editor.onDidChangeCursorPosition',
  'editor.onDidChangeCursorSelection',
  'editor.onDidScrollChange',
  'editor.addAction',
  'editor.addAction',
])
```

（Task 4 会再往这个文件追加 EditorSurface 段；本 Task 先保证 dual 部分正确。）

- [ ] **Step 3: 更新 `scripts/test-spatial-ui-contract.mjs`**

第 43 行 `dualEditor: read('src/kits/ui/DualEditorView.tsx'),` 之后新增一行：

```js
  textEditorCore: read('src/kits/editor/TextEditorCore.tsx'),
```

第 102 行 padding 断言改为（统一 padding 现在由 core 持有，锚点跟随迁移）：

```js
has(files.textEditorCore, /padding:\s*\{\s*top:\s*12,\s*bottom:\s*12,\s*left:\s*8\s*\}/, 'Editor primitive should own the unified editor padding')
```

- [ ] **Step 4: 更新 `scripts/test-sticky-scroll-toggle.mjs`**

该脚本当前因 `TextDiffRenderer.tsx` ENOENT 整体失败（历史遗留，不修复）。
只更新与本次重构文件相关的 4 条锚点，保证未来有人修复 ENOENT 后断言仍正确：

```js
// 原：assert(/leftStickyScrollEnabled:\s*boolean/.test(dualEditor), ...)
assert(/leftStickyScrollEnabled\?:\s*boolean/.test(dualEditor), 'DualEditorView should accept left stickyScroll flag')
// 原：assert(/rightStickyScrollEnabled:\s*boolean/.test(dualEditor), ...)
assert(/rightStickyScrollEnabled\?:\s*boolean/.test(dualEditor), 'DualEditorView should accept right stickyScroll flag')
// 原：assert(/stickyScroll:\s*\{\s*enabled:\s*leftStickyScrollEnabled\s*\}/s.test(dualEditor), ...)
assert(/stickyScroll=\{leftStickyScrollEnabled\}/.test(dualEditor), 'DualEditorView should pass left stickyScroll to Monaco')
// 原：assert(/stickyScroll:\s*\{\s*enabled:\s*rightStickyScrollEnabled\s*\}/s.test(dualEditor), ...)
assert(/stickyScroll=\{rightStickyScrollEnabled\}/.test(dualEditor), 'DualEditorView should pass right stickyScroll to Monaco')
```

（PaneEditor 那条锚点在 Task 6 更新。）

- [ ] **Step 5: 验证**

```bash
npm run check:architecture && npm run build
node scripts/test-monaco-disposable-lifecycle.mjs   # 预期仍 FAIL，且失败原因仍是 jsFilter（基线一致）
node scripts/test-spatial-ui-contract.mjs           # 预期仍 FAIL，失败原因仍是 Scripts view（基线一致）
```

- [ ] **Step 6: 浏览器验证（关键检查点）**

`npm run dev` 后打开 diff 双栏（text-diff 插件），验证：
左右滚动同步、红/绿行高亮、双侧可编辑且互不干扰、Cmd+F 弹出 find-replace（新行为 A6）。

- [ ] **Step 7: 提交**

```bash
git add src/kits/ui/DualEditorView.tsx scripts/test-monaco-disposable-lifecycle.mjs scripts/test-spatial-ui-contract.mjs scripts/test-sticky-scroll-toggle.mjs
git commit -m "refactor: rebuild DualEditorView on TextEditorCore"
```

---

### Task 4: framework 层 EditorSurface + EditorStatusBar

**Files:**
- Create: `src/components/editor/editorSurfaceTypes.ts`
- Create: `src/components/editor/EditorStatusBar.tsx`
- Create: `src/components/editor/EditorSurface.tsx`
- Modify: `scripts/test-monaco-disposable-lifecycle.mjs`（追加 EditorSurface 段）

- [ ] **Step 1: 创建 `src/components/editor/editorSurfaceTypes.ts`**

```ts
import type { ReactNode } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import type {
  EditorActionSpec,
  EditorPosition,
  EditorScrollPosition,
  EditorSelectionRange,
} from '../../kits/editor/types'

export interface EditorTextBinding {
  text: string
  language: string
  languageSource?: 'manual' | 'auto'
  onTextChange: (text: string) => void
  onSelectionChange?: (selection: EditorSelectionRange | null) => void
  onDetectedLanguage?: (language: string) => void
  initialCursor?: EditorPosition
  initialScroll?: EditorScrollPosition
  onCursorChange?: (position: EditorPosition) => void
  onScrollChange?: (position: EditorScrollPosition) => void
}

export interface EditorSurfaceProps {
  binding: EditorTextBinding
  statusBarLeading?: ReactNode
  statusBarTrailing?: ReactNode
  actions?: EditorActionSpec[]
  overlay?: ReactNode
  bottomPanels?: ReactNode
  autoFocus?: boolean
  stickyScroll?: boolean
  onFocus?: () => void
  onReady?: (editor: MonacoEditor.IStandaloneCodeEditor) => (() => void) | void
}
```

- [ ] **Step 2: 创建 `src/components/editor/EditorStatusBar.tsx`**

（样式与阈值逐字来自旧 PaneEditor 状态栏；Quick 形态由此获得响应式收缩 = 拉齐项 A7）

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '../../i18n'

export interface EditorStatusBarProps {
  cursor: { line: number; col: number }
  lineCount: number
  charCount: number
  selectedCharCount: number
  languageStatus: string
  leading?: ReactNode
  trailing?: ReactNode
}

export function EditorStatusBar({
  cursor,
  lineCount,
  charCount,
  selectedCharCount,
  languageStatus,
  leading,
  trailing,
}: EditorStatusBarProps) {
  const t = useT('editor')
  const barRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const node = barRef.current
    if (!node) return
    const updateWidth = () => setWidth(node.clientWidth)
    updateWidth()
    const resizeObserver = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? node.clientWidth)
    })
    resizeObserver.observe(node)
    return () => resizeObserver.disconnect()
  }, [])

  const showLineCount = width >= 240
  const showCharCount = width >= 320
  const showLanguage = width >= 160

  return (
    <div
      ref={barRef}
      className="h-[22px] flex items-center px-2 gap-2 shrink-0 overflow-hidden whitespace-nowrap text-[10px]"
      style={{
        borderTop: '0.5px solid var(--color-border-tertiary)',
        background: 'var(--color-background-secondary)',
        color: 'var(--color-text-tertiary)',
      }}
    >
      {leading}
      <span className="shrink-0">
        {t('line')} {cursor.line}, {t('column')} {cursor.col}
      </span>
      {showLineCount && (
        <span className="shrink-0">
          {lineCount} {t('lines')}
        </span>
      )}
      {showCharCount && (
        <span className="shrink-0">
          {charCount} {t('chars')}
        </span>
      )}
      {selectedCharCount > 0 && (
        <span className="shrink-0">
          {selectedCharCount} {t('selectedChars')}
        </span>
      )}
      {showLanguage && (
        <span className="ml-auto min-w-0 truncate text-right" title={languageStatus}>
          {languageStatus}
        </span>
      )}
      {trailing}
    </div>
  )
}
```

- [ ] **Step 3: 创建 `src/components/editor/EditorSurface.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import { TextEditorCore } from '../../kits/editor/TextEditorCore'
import type { TextEditorCoreHandle } from '../../kits/editor/types'
import { getFluxMonacoTheme } from '../../utils/monacoTheme'
import { detectEditorLanguage } from '../../workspace/languageDetector'
import { getLanguageOptionLabel } from '../../workspace/languageOptions'
import { EditorStatusBar } from './EditorStatusBar'
import type { EditorSurfaceProps } from './editorSurfaceTypes'

export function EditorSurface({
  binding,
  statusBarLeading,
  statusBarTrailing,
  actions,
  overlay,
  bottomPanels,
  autoFocus = false,
  stickyScroll = false,
  onFocus,
  onReady,
}: EditorSurfaceProps) {
  const settings = useAppStore((s) => s.settings)
  const locale = useAppStore((s) => s.locale)
  const t = useT('editor')
  const coreRef = useRef<TextEditorCoreHandle | null>(null)
  const [cursorInfo, setCursorInfo] = useState({ line: 1, col: 1 })
  const [selectedCharCount, setSelectedCharCount] = useState(0)
  const pasteDetectionRef = useRef<{ shouldDetect: boolean } | null>(null)
  const bindingRef = useRef(binding)
  bindingRef.current = binding
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  const languageLabel = getLanguageOptionLabel(binding.language, locale)
  const languageStatus = (binding.languageSource ?? 'auto') === 'manual'
    ? languageLabel
    : `${languageLabel} · ${t('autoLanguage')}`

  const rememberPasteDetection = useCallback(() => {
    const editor = coreRef.current?.getEditor()
    if (!editor || !editor.hasTextFocus()) return
    const model = editor.getModel()
    if (!model) {
      pasteDetectionRef.current = null
      return
    }
    const text = model.getValue()
    const fullRange = model.getFullModelRange()
    const selections = editor.getSelections() ?? []
    const hasFullSelection = selections.some((selection) => (
      selection.startLineNumber === fullRange.startLineNumber &&
      selection.startColumn === fullRange.startColumn &&
      selection.endLineNumber === fullRange.endLineNumber &&
      selection.endColumn === fullRange.endColumn
    ))
    pasteDetectionRef.current = {
      shouldDetect: text.trim().length === 0 || hasFullSelection,
    }
  }, [])

  useEffect(() => {
    const handlePasteCapture = () => rememberPasteDetection()
    const handlePasteKeydownCapture = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
        rememberPasteDetection()
      }
    }
    window.addEventListener('paste', handlePasteCapture, true)
    window.addEventListener('keydown', handlePasteKeydownCapture, true)
    return () => {
      window.removeEventListener('paste', handlePasteCapture, true)
      window.removeEventListener('keydown', handlePasteKeydownCapture, true)
    }
  }, [rememberPasteDetection])

  const handleReady = useCallback((editor: MonacoEditor.IStandaloneCodeEditor) => {
    const initial = bindingRef.current
    if (initial.initialCursor) editor.setPosition(initial.initialCursor)
    if (initial.initialScroll) editor.setScrollPosition(initial.initialScroll)
    if (autoFocus) editor.focus()
    const pasteSubscription = editor.onDidPaste(() => {
      const detection = pasteDetectionRef.current
      pasteDetectionRef.current = null
      if (!detection?.shouldDetect) return
      window.setTimeout(() => {
        const model = editor.getModel()
        const text = model?.getValue() ?? ''
        const current = bindingRef.current
        if ((current.languageSource ?? 'auto') === 'manual' || text.trim().length === 0) return
        current.onDetectedLanguage?.(
          detectEditorLanguage(text, { allowShortStrongSignals: true }),
        )
      }, 0)
    })
    const hostCleanup = onReadyRef.current?.(editor)
    return () => {
      pasteSubscription.dispose()
      if (typeof hostCleanup === 'function') hostCleanup()
    }
  }, [autoFocus])

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
      <div className="flex-1 min-h-0">
        <TextEditorCore
          ref={coreRef}
          value={binding.text}
          language={binding.language}
          theme={getFluxMonacoTheme(settings.theme)}
          fontSize={settings.fontSize}
          lineNumbers={settings.lineNumbers}
          wordWrap={settings.wordWrap}
          stickyScroll={stickyScroll}
          actions={actions}
          onChange={(text) => bindingRef.current.onTextChange(text)}
          onFocus={onFocus}
          onCursorChange={(position) => {
            setCursorInfo({ line: position.lineNumber, col: position.column })
            bindingRef.current.onCursorChange?.(position)
          }}
          onSelectionChange={(info) => {
            setSelectedCharCount(info.selectedCharCount)
            bindingRef.current.onSelectionChange?.(info.selection)
          }}
          onScrollChange={(position) => bindingRef.current.onScrollChange?.(position)}
          onReady={handleReady}
        />
      </div>
      {bottomPanels}
      <EditorStatusBar
        cursor={cursorInfo}
        lineCount={binding.text.split('\n').length}
        charCount={binding.text.length}
        selectedCharCount={selectedCharCount}
        languageStatus={languageStatus}
        leading={statusBarLeading}
        trailing={statusBarTrailing}
      />
      {overlay}
    </div>
  )
}
```

- [ ] **Step 4: 契约测试追加 EditorSurface 段**

在 `scripts/test-monaco-disposable-lifecycle.mjs` 的 TextEditorCore 段之后追加：

```js
const editorSurface = read('src/components/editor/EditorSurface.tsx')

assert(/window\.removeEventListener\('paste', handlePasteCapture, true\)/.test(editorSurface), 'EditorSurface should release paste capture listener')
assert(/window\.removeEventListener\('keydown', handlePasteKeydownCapture, true\)/.test(editorSurface), 'EditorSurface should release paste keydown listener')
assert(/pasteSubscription\.dispose\(\)/.test(editorSurface), 'EditorSurface should dispose the onDidPaste subscription via onReady cleanup')
```

- [ ] **Step 5: 验证**

```bash
npm run check:architecture && npm run build
node scripts/test-editor-primitive-boundary.mjs
```

boundary 测试预期：失败点前进到
`PaneEditor must not mount @monaco-editor/react directly anymore`
（第 3 组 EditorSurface 断言已通过）。

- [ ] **Step 6: 提交**

```bash
git add src/components/editor/editorSurfaceTypes.ts src/components/editor/EditorStatusBar.tsx src/components/editor/EditorSurface.tsx scripts/test-monaco-disposable-lifecycle.mjs
git commit -m "feat: add EditorSurface unified editor component"
```

---

### Task 5: Quick 形态切换（store + QuickEditorPanel）

**Files:**
- Modify: `src/workspace/quickEditor/quickEditorTypes.ts`
- Modify: `src/workspace/quickEditor/quickEditorStore.ts`
- Modify: `src/components/quickEditor/QuickEditorPanel.tsx`（整文件重写）

- [ ] **Step 1: `quickEditorTypes.ts` 增加 languageSource**

```ts
export interface QuickEditorState {
  /** 编辑器文本内容 */
  text: string
  /** Monaco 语言标识 */
  language: string
  /** 语言来源：manual = 用户/命令显式设置，auto = 检测或默认 */
  languageSource: 'manual' | 'auto'
  /** 光标位置 */
  cursorPosition: { lineNumber: number; column: number }
  /** 滚动位置 */
  scrollPosition: { scrollTop: number; scrollLeft: number }
}

export interface QuickEditorActions {
  setText: (text: string) => void
  setLanguage: (language: string) => void
  setDetectedLanguage: (language: string) => void
  setCursorPosition: (position: { lineNumber: number; column: number }) => void
  setScrollPosition: (position: { scrollTop: number; scrollLeft: number }) => void
  reset: () => void
}

export type QuickEditorStore = QuickEditorState & QuickEditorActions
```

- [ ] **Step 2: `quickEditorStore.ts` 实现新字段**

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QuickEditorStore, QuickEditorState } from './quickEditorTypes'

const INITIAL_STATE: QuickEditorState = {
  text: '',
  language: 'plaintext',
  languageSource: 'auto',
  cursorPosition: { lineNumber: 1, column: 1 },
  scrollPosition: { scrollTop: 0, scrollLeft: 0 },
}

export const useQuickEditorStore = create<QuickEditorStore>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      setText: (text) => set({ text }),
      setLanguage: (language) => set({ language, languageSource: 'manual' }),
      setDetectedLanguage: (language) => set({ language, languageSource: 'auto' }),
      setCursorPosition: (cursorPosition) => set({ cursorPosition }),
      setScrollPosition: (scrollPosition) => set({ scrollPosition }),
      reset: () => set(INITIAL_STATE),
    }),
    {
      name: 'hiven-quick-editor',
      partialize: (state) => ({
        text: state.text,
        language: state.language,
        languageSource: state.languageSource,
        cursorPosition: state.cursorPosition,
        scrollPosition: state.scrollPosition,
      }),
    }
  )
)
```

语义说明：`setLanguage` 的既有调用方在
`src/workspace/quickEditor/quickEditorActions.ts:47,53`（命令 effect 显式设置语言），
显式设置 → 标记 `manual`，此后粘贴检测不再覆盖，与 pane 形态语义一致。
旧持久化数据无 `languageSource` 字段，zustand persist 与 INITIAL_STATE 合并后默认
`auto`，无需迁移代码。

- [ ] **Step 3: 重写 `QuickEditorPanel.tsx`**

保留锚点（契约测试依赖，不得丢失）：`onKeyDownCapture={handleKeyDownCapture}`、
`event.key.toLowerCase() !== 'k'`、`event.preventDefault()` + `event.stopPropagation()`
+ `openQuickEditorCommand()`、`suppressStandaloneLauncherBlur()` 先于
`openQuickEditorCommand()`、`useQuickEditorEscape`、`data-no-drag`。

```tsx
import { useCallback, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useQuickEditorStore } from '../../workspace/quickEditor/quickEditorStore'
import { useAppStore } from '../../store'
import { EditorSurface } from '../editor/EditorSurface'
import type { EditorTextBinding } from '../editor/editorSurfaceTypes'
import { QuickEditorCommandOverlay } from './QuickEditorCommandOverlay'
import { suppressStandaloneLauncherBlur } from '../../workspace/launcherBlurGuard'
import { useQuickEditorEscape } from './useQuickEditorEscape'
import { isQuickEditorDetachedWindow } from '../../workspace/windowManager/quickEditorWindow'
import { quickEditorImperative } from './quickEditorImperative'
import { useT } from '../../i18n'

export function QuickEditorPanel({ onRequestExit }: { onRequestExit: () => void }) {
  const text = useQuickEditorStore((s) => s.text)
  const language = useQuickEditorStore((s) => s.language)
  const languageSource = useQuickEditorStore((s) => s.languageSource)
  const setText = useQuickEditorStore((s) => s.setText)
  const setDetectedLanguage = useQuickEditorStore((s) => s.setDetectedLanguage)
  const setCursorPosition = useQuickEditorStore((s) => s.setCursorPosition)
  const setScrollPosition = useQuickEditorStore((s) => s.setScrollPosition)
  const openQuickEditorCommand = useAppStore((s) => s.openQuickEditorCommand)

  const { exitHintVisible } = useQuickEditorEscape(onRequestExit)
  const tQuickEditor = useT('quickEditor')
  const isDetached = isQuickEditorDetachedWindow()

  // 现场恢复只发生在挂载时：用 ref 冻结初始值，避免编辑期间反向写回
  const initialCursorRef = useRef(useQuickEditorStore.getState().cursorPosition)
  const initialScrollRef = useRef(useQuickEditorStore.getState().scrollPosition)

  const handleKeyDownCapture = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
    event.preventDefault()
    event.stopPropagation()
    suppressStandaloneLauncherBlur()
    openQuickEditorCommand()
  }, [openQuickEditorCommand])

  const binding: EditorTextBinding = {
    text,
    language,
    languageSource,
    onTextChange: setText,
    onDetectedLanguage: setDetectedLanguage,
    initialCursor: initialCursorRef.current,
    initialScroll: initialScrollRef.current,
    onCursorChange: setCursorPosition,
    onScrollChange: setScrollPosition,
  }

  return (
    <div className="h-full" onKeyDownCapture={handleKeyDownCapture} data-no-drag>
      <EditorSurface
        binding={binding}
        autoFocus
        actions={[{
          id: 'quick-editor-command',
          label: 'Quick Editor Command',
          keybindings: [2048 | 41], // CtrlCmd + KeyK
          run: () => {
            suppressStandaloneLauncherBlur()
            useAppStore.getState().openQuickEditorCommand()
          },
        }]}
        onReady={(editor) => {
          quickEditorImperative.registerFind(() => {
            editor.getAction('editor.action.startFindReplaceAction')?.run()
          })
          return () => {
            quickEditorImperative.unregisterFind()
          }
        }}
        overlay={(
          <>
            {exitHintVisible && (
              <div
                className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 z-40 px-2.5 py-1 rounded text-[11px]"
                style={{
                  background: 'var(--color-background-tertiary)',
                  color: 'var(--color-text-secondary)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
                }}
              >
                {isDetached ? tQuickEditor('escCloseHint') : tQuickEditor('escExitHint')}
              </div>
            )}
            <QuickEditorCommandOverlay />
          </>
        )}
      />
    </div>
  )
}
```

已知微调（可接受）：`data-no-drag` 从旧的编辑区容器上移到面板根节点，
状态栏区域也不再触发 launcher 拖拽（22px 高的细条，产品上无感知）。

- [ ] **Step 4: 验证**

```bash
npm run check:architecture && npm run build
node scripts/test-quick-editor-host-surface.mjs      # 预期 PASS（基线通过，必须保持）
node scripts/test-quick-editor-launcher-behavior.mjs # 预期 FAIL 且原因仍是基线的 blur-to-close
node scripts/test-editor-primitive-boundary.mjs      # 失败点前进到 PaneEditor 相关断言
```

- [ ] **Step 5: 浏览器验证（关键检查点）**

quick editor 两种形态都要验：
launcher 进入：输入、Cmd+K 打开 overlay、中文输入法 Enter 上屏不触发命令、Cmd+F find-replace。
detached 窗口：Escape 两段退出提示、关闭重开后光标/滚动恢复、
清空后粘贴 JSON 自动识别语言、手动 Set Language 后再粘贴不被覆盖、
状态栏出现「语言 · 自动」标记（新拉齐行为）。

- [ ] **Step 6: 提交**

```bash
git add src/workspace/quickEditor/quickEditorTypes.ts src/workspace/quickEditor/quickEditorStore.ts src/components/quickEditor/QuickEditorPanel.tsx
git commit -m "refactor: move QuickEditorPanel onto EditorSurface"
```

---

### Task 6: Pane 形态切换（PaneEditor）

**Files:**
- Modify: `src/components/workspace/PaneEditor.tsx`（整文件重写）
- Modify: `scripts/test-monaco-gutter-width.mjs`
- Modify: `scripts/test-pane-external-update-sync.mjs`
- Modify: `scripts/test-pane-active-selection-status.mjs`
- Modify: `scripts/test-sticky-scroll-toggle.mjs`（PaneEditor 锚点）

- [ ] **Step 1: 重写 `PaneEditor.tsx`**

```tsx
import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { runtimeRegistry } from '../../workspace/runtimeRegistry'
import { RendererHost } from './RendererHost'
import { PaneBottomPanels } from './PaneBottomPanels'
import { EditorSurface } from '../editor/EditorSurface'
import type { EditorTextBinding } from '../editor/editorSurfaceTypes'
import { useT } from '../../i18n'
import { X } from 'lucide-react'

interface PaneEditorProps {
  paneId: string
}

export function PaneEditor({ paneId }: PaneEditorProps) {
  const pane = useWorkspaceStore((s) => s.panes[paneId])
  const setPaneText = useWorkspaceStore((s) => s.setPaneText)
  const setActivePaneId = useWorkspaceStore((s) => s.setActivePaneId)
  const setPaneSelection = useWorkspaceStore((s) => s.setPaneSelection)
  const updatePaneDetectedLanguage = useWorkspaceStore((s) => s.updatePaneDetectedLanguage)
  const closePane = useWorkspaceStore((s) => s.closePane)
  const layout = useWorkspaceStore((s) => s.layout)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const rendererState = useWorkspaceStore((s) => s.paneRenderers[paneId])
  const t = useT('editor')

  if (!pane) return null

  // If a plugin renderer is active, show RendererHost instead of Monaco
  if (rendererState) {
    return (
      <div className="h-full" onPointerDown={() => setActivePaneId(paneId)}>
        <RendererHost paneId={paneId} rendererState={rendererState} />
      </div>
    )
  }

  const languageSource = pane.languageSource
    ?? (pane.language && pane.language !== 'plaintext' ? 'manual' : 'auto')

  const binding: EditorTextBinding = {
    text: pane.text ?? '',
    language: pane.language || 'plaintext',
    languageSource,
    onTextChange: (text) => setPaneText(paneId, text),
    onSelectionChange: (selection) => setPaneSelection(paneId, selection),
    onDetectedLanguage: (language) => updatePaneDetectedLanguage(paneId, language),
  }

  const visiblePaneIds = layout.panes
  const paneNumber = visiblePaneIds.indexOf(paneId) + 1
  const showPaneNumber = visiblePaneIds.length > 1 && paneNumber > 0

  return (
    <div className="flex flex-col h-full" onPointerDown={() => setActivePaneId(paneId)}>
      <EditorSurface
        binding={binding}
        stickyScroll={pane.stickyScroll === true}
        onFocus={() => setActivePaneId(paneId)}
        onReady={(editor) => {
          runtimeRegistry.registerCodeEditor(paneId, editor)
          return () => {
            runtimeRegistry.unregisterCodeEditor(paneId)
          }
        }}
        actions={[{
          id: 'close-pane',
          label: 'Close Pane',
          keybindings: [2048 | 53], // CtrlCmd + KeyW
          run: () => {
            useWorkspaceStore.getState().closeActiveSurfaceOrPane()
          },
        }]}
        bottomPanels={<PaneBottomPanels paneId={paneId} />}
        statusBarLeading={showPaneNumber ? (
          <span
            className="pane-status-index shrink-0"
            title={pane.title}
            data-active={activePaneId === paneId ? 'true' : 'false'}
          >
            {paneNumber}
          </span>
        ) : undefined}
        statusBarTrailing={(
          <button
            type="button"
            className="pane-status-close"
            title={t('closePane')}
            onClick={(event) => {
              event.stopPropagation()
              closePane(paneId)
            }}
          >
            <X size={11} />
          </button>
        )}
      />
    </div>
  )
}
```

注意：所有 hooks 调用都在 `if (!pane) return null` 之前，保持 hooks 顺序稳定
（与旧实现一致）。旧实现的粘贴检测、外部同步、Cmd+F、光标/选区追踪、状态栏
均已由 EditorSurface / TextEditorCore 承担，不得在本文件重复出现。

- [ ] **Step 2: 更新 `scripts/test-monaco-gutter-width.mjs`**

整文件替换为：

```js
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const textEditorCore = readFileSync('src/kits/editor/TextEditorCore.tsx', 'utf8')
const packageJson = readFileSync('package.json', 'utf8')

assert.match(
  packageJson,
  /"test:monaco-gutter-width":\s*"node scripts\/test-monaco-gutter-width\.mjs"/,
  'package.json should expose the Monaco gutter width regression test',
)

assert.match(
  textEditorCore,
  /const\s+lineDecorationsWidth\s*=\s*foldingEnabled\s*\?\s*8\s*:\s*24/,
  'Editor primitive should normalize total gutter width for folding and plaintext editors',
)

assert.match(
  textEditorCore,
  /lineDecorationsWidth,\s*\n\s*lineNumbersMinChars:\s*3/,
  'Editor primitive should pass the normalized gutter width with fixed line-number digits',
)

console.log('Monaco gutter width checks passed')
```

- [ ] **Step 3: 更新 `scripts/test-pane-external-update-sync.mjs`**

整文件替换为（同步逻辑已收敛到 core，锚点跟随迁移，断言语义不变）：

```js
#!/usr/bin/env node

import { readFileSync } from 'node:fs'

const source = readFileSync('src/kits/editor/TextEditorCore.tsx', 'utf8')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(
  /if\s*\(\s*isLocalChange\.current\s*\)\s*\{[\s\S]{0,220}model\??\.getValue\(\)\s*={2,3}\s*value[\s\S]{0,220}return/.test(source),
  'TextEditorCore should only swallow local-change syncs when the Monaco model already matches the incoming value',
)

assert(
  /if\s*\(\s*model\s*&&\s*model\.getValue\(\)\s*!==\s*value\s*\)/.test(source),
  'TextEditorCore should still apply external value updates when the Monaco model is stale',
)

console.log('pane external update sync checks passed')
```

- [ ] **Step 4: 更新 `scripts/test-pane-active-selection-status.mjs`**

保留 `workspaceShell`、`pluginInputResolver`、`i18n` 的读取与断言不动。
把 `const paneEditor = read('src/components/workspace/PaneEditor.tsx')` 替换为：

```js
const textEditorCore = read('src/kits/editor/TextEditorCore.tsx')
const editorStatusBar = read('src/components/editor/EditorStatusBar.tsx')
```

三条 paneEditor 断言替换为：

```js
assert(
  /onDidChangeCursorSelection/.test(textEditorCore),
  'Editor primitive should subscribe to Monaco selection changes',
)

assert(
  /getValueLengthInRange/.test(textEditorCore),
  'Editor primitive should compute selected character count from the current Monaco model selection',
)

assert(
  /selectedCharCount\s*>\s*0/.test(editorStatusBar) &&
  /t\(['"`]selectedChars['"`]\)/.test(editorStatusBar),
  'Editor status bar should render selected character count when a selection exists',
)
```

- [ ] **Step 5: 更新 `scripts/test-sticky-scroll-toggle.mjs` 的 PaneEditor 锚点**

```js
// 原：assert(/stickyScroll:\s*\{\s*enabled:\s*pane\.stickyScroll\s*===\s*true\s*\}/s.test(paneEditor), ...)
assert(/stickyScroll=\{pane\.stickyScroll\s*===\s*true\}/.test(paneEditor), 'PaneEditor should pass pane stickyScroll to Monaco')
```

- [ ] **Step 6: 验证**

```bash
npm run check:architecture && npm run build
node scripts/test-editor-primitive-boundary.mjs      # 预期 PASS（首次全绿）
node scripts/test-monaco-gutter-width.mjs            # 预期 PASS
node scripts/test-pane-external-update-sync.mjs      # 预期 PASS
node scripts/test-pane-active-selection-status.mjs   # 预期 PASS
node scripts/test-pane-full-replace-store-sync.mjs   # 预期 PASS（未改动，验证无回归）
```

- [ ] **Step 7: 浏览器验证（关键检查点）**

主编辑器窗口：双 pane 编辑、pane 序号与关闭按钮、Cmd+W 关 pane、
空 pane 粘贴 JSON 自动识别语言、手动选语言后粘贴不覆盖、
命令写回 pane 文本时光标不跳（外部同步）、窗口收窄时状态栏渐隐、
sticky scroll 开关生效。

- [ ] **Step 8: 提交**

```bash
git add src/components/workspace/PaneEditor.tsx scripts/test-monaco-gutter-width.mjs scripts/test-pane-external-update-sync.mjs scripts/test-pane-active-selection-status.mjs scripts/test-sticky-scroll-toggle.mjs
git commit -m "refactor: move PaneEditor onto EditorSurface"
```

---

### Task 7: 最终验收

**Files:** 无预期改动（若本 Task 发现问题需回改，逐项处理后重跑）

- [ ] **Step 1: 全量契约测试对比基线**

```bash
for s in scripts/test-*.mjs; do node "$s" >/dev/null 2>&1 && echo "PASS $s" || echo "FAIL $s"; done > temp/editor-primitive-final.txt
diff temp/editor-primitive-baseline.txt temp/editor-primitive-final.txt
```

允许的 diff **只有**：新增 `PASS scripts/test-editor-primitive-boundary.mjs` 一行。
出现任何「基线 PASS → 现在 FAIL」都必须修复（更新锚点或修实现，不许削弱断言）。
对基线 FAIL 的脚本，逐个确认失败原因与基线表一致：

```bash
node scripts/test-monaco-disposable-lifecycle.mjs 2>&1 | grep -m1 Error   # 仍应是 jsFilter
node scripts/test-spatial-ui-contract.mjs 2>&1 | grep -m1 -E "Error|Assertion"  # 仍应是 Scripts view
node scripts/test-quick-editor-launcher-behavior.mjs 2>&1 | grep -m1 -E "Error|Assertion"  # 仍应是 blur-to-close
node scripts/test-sticky-scroll-toggle.mjs 2>&1 | grep -m1 -E "Error|ENOENT"                # 仍应是 TextDiffRenderer ENOENT
node scripts/test-window-architecture-phases.mjs 2>&1 | grep -m1 -E "Error|Assertion"       # 仍应是 native window manager 断言
node scripts/test-refactor-final-acceptance.mjs 2>&1 | grep -m1 -E "Error|Assertion"        # 仍应是 launcher lifecycle 断言
```

- [ ] **Step 2: 项目标准验证**

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
```

全部通过；`git status` 中除本计划文件外不应出现新的未跟踪/误改文件。

- [ ] **Step 3: 清理**

```bash
rm -f temp/editor-primitive-baseline.txt temp/editor-primitive-final.txt
```

- [ ] **Step 4: 收敛度确认（自检）**

```bash
grep -rn "@monaco-editor/react" src/components/workspace/PaneEditor.tsx src/components/quickEditor/QuickEditorPanel.tsx src/kits/ui/DualEditorView.tsx
```

预期：无输出（三个宿主全部不再直接装配 Monaco）。

- [ ] **Step 5: 交回用户做浏览器终验**

四场景清单（Task 3/5/6 已分别验过，终验再整体过一遍）：

1. pane 编辑：多 pane、粘贴检测、Cmd+W、状态栏响应式、sticky scroll
2. quick 从 launcher 进入：编辑、Cmd+K、IME Enter 不触发命令、find/replace
3. quick detached 窗口：Escape、光标/滚动恢复、粘贴检测、「· 自动」语言标记
4. diff 双栏：滚动同步、红绿高亮、双侧编辑、Cmd+F find-replace

---

## 行为变化对照表（验收时给用户核对）

| 变化 | 形态 | 原因 |
|------|------|------|
| tabSize 4 → 2 | pane | 拉齐 A1 |
| 底部 padding +12px | pane / diff | 拉齐 A2 |
| plaintext 不再显示折叠控件 | quick | 拉齐 A4 |
| plaintext 沟槽宽 8 → 24 | quick / diff | 拉齐 A5 |
| Cmd+F/H 打开 find-replace（原为普通 find） | diff | 拉齐 A6 |
| 状态栏窄宽度渐隐 | quick | 拉齐 A7 |
| 粘贴自动识别语言 + 「· 自动」标记 | quick | 拉齐 B 组（已拍板） |
| 多选区字符计数（原只统计主选区） | quick | 统一用 pane 的实现 |
| 状态栏拖拽区（data-no-drag 覆盖整面板） | quick | 实现简化，产品无感知 |
| stickyScroll 标志变可选 | DualEditorView API | 对齐实际调用方 |
