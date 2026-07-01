# Quick Editor 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Global Launcher 浮窗内新增 Quick Editor 模式——与 Launcher 模式 toggle 切换，共享同一个 Tauri 窗口，提供完整 Monaco 编辑能力，关闭后内容保留，支持 detach 为独立窗口。

**Architecture:** Quick Editor 作为 Global Launcher 浮窗的第二种模式，通过独立的 Zustand store 持久化内容，复用现有的 Tauri 窗口 show/hide/resize 机制。`⌘K` 命令覆盖层通过新增一个 launcher host (`quick-editor-command`) 复用现有 controller 框架。Detach 功能通过 Tauri 多窗口 API 创建独立窗口并共享同一份 store。

**Tech Stack:** React 19, Zustand (persist), Monaco Editor (@monaco-editor/react), Tauri v2 (multi-window, global shortcut), Tailwind CSS, framer-motion (动画)

---

## 文件结构

### 新建文件

| 文件路径 | 职责 |
|----------|------|
| `src/workspace/quickEditor/quickEditorStore.ts` | Quick Editor 独立 Zustand store（内容、语言、光标、滚动位置持久化） |
| `src/workspace/quickEditor/quickEditorTypes.ts` | 类型定义 |
| `src/workspace/quickEditor/quickEditorActions.ts` | detach/attach、命令执行等 action |
| `src/components/quickEditor/QuickEditorPanel.tsx` | Quick Editor 主面板组件（包含 Monaco） |
| `src/components/quickEditor/QuickEditorCommandOverlay.tsx` | `⌘K` 命令覆盖层 |
| `src/components/quickEditor/QuickEditorToolbar.tsx` | 顶部工具栏（语言指示、detach 按钮） |
| `src/components/quickEditor/QuickEditorTransition.tsx` | 模式切换动画容器 |
| `src/workspace/launcher/quickEditorHost.ts` | 新 launcher host 定义（能力子集） |
| `src/workspace/windowManager/quickEditorWindow.ts` | detach 独立窗口管理 |
| `src/views/QuickEditorDetachedView.tsx` | detach 后独立窗口的根视图 |

### 修改文件

| 文件路径 | 修改内容 |
|----------|----------|
| `src/workspace/appStore.ts` | 新增 `globalLauncherMode` 扩展为 `'launcher' \| 'quick-editor'`，新增 Quick Editor 相关状态 |
| `src/launcher/hosts/GlobalLauncherHost.tsx` | 根据 mode 渲染 Launcher 或 Quick Editor |
| `src/components/launcher/GlobalLauncherLayout.ts` | 新增 Editor 模式尺寸常量和计算 |
| `src/components/launcher/GlobalLauncherWindowLifecycle.ts` | Editor 模式的 resize 逻辑 |
| `src/components/launcher/GlobalLauncherHostLifecycle.ts` | Editor 模式的 Escape 处理 |
| `src/components/launcher/GlobalLauncherClose.ts` | Editor 模式的关闭行为 |
| `src/App.tsx` | 监听新热键事件、注册 Quick Editor 模式 |
| `src/workspace/launcher/types.ts` | 新增 `quick-editor-command` host |
| `src-tauri/src/lib.rs` 或相关 Rust 文件 | 注册新全局快捷键 |

---

## Task 1: Quick Editor Store

创建独立的持久化 store，管理编辑器内容和元数据。

**Files:**
- Create: `src/workspace/quickEditor/quickEditorTypes.ts`
- Create: `src/workspace/quickEditor/quickEditorStore.ts`

- [ ] **Step 1: 定义类型**

```typescript
// src/workspace/quickEditor/quickEditorTypes.ts

export interface QuickEditorState {
  /** 编辑器文本内容 */
  text: string
  /** Monaco 语言标识 */
  language: string
  /** 光标位置 (line, column) */
  cursorPosition: { lineNumber: number; column: number }
  /** 滚动位置 */
  scrollPosition: { scrollTop: number; scrollLeft: number }
  /** 是否已 detach 为独立窗口 */
  detached: boolean
}

export interface QuickEditorActions {
  setText: (text: string) => void
  setLanguage: (language: string) => void
  setCursorPosition: (position: { lineNumber: number; column: number }) => void
  setScrollPosition: (position: { scrollTop: number; scrollLeft: number }) => void
  setDetached: (detached: boolean) => void
  reset: () => void
}

export type QuickEditorStore = QuickEditorState & QuickEditorActions
```

- [ ] **Step 2: 创建 store**

```typescript
// src/workspace/quickEditor/quickEditorStore.ts

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QuickEditorStore, QuickEditorState } from './quickEditorTypes'

const INITIAL_STATE: QuickEditorState = {
  text: '',
  language: 'plaintext',
  cursorPosition: { lineNumber: 1, column: 1 },
  scrollPosition: { scrollTop: 0, scrollLeft: 0 },
  detached: false,
}

export const useQuickEditorStore = create<QuickEditorStore>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      setText: (text) => set({ text }),
      setLanguage: (language) => set({ language }),
      setCursorPosition: (cursorPosition) => set({ cursorPosition }),
      setScrollPosition: (scrollPosition) => set({ scrollPosition }),
      setDetached: (detached) => set({ detached }),
      reset: () => set(INITIAL_STATE),
    }),
    {
      name: 'hiven-quick-editor',
      partialize: (state) => ({
        text: state.text,
        language: state.language,
        cursorPosition: state.cursorPosition,
        scrollPosition: state.scrollPosition,
      }),
    }
  )
)
```

- [ ] **Step 3: 验证 store 可正常导入**

Run: `npx tsc --noEmit src/workspace/quickEditor/quickEditorStore.ts`
Expected: 无类型错误

- [ ] **Step 4: 提交**

```bash
git add src/workspace/quickEditor/
git commit -m "feat(quick-editor): add persisted store for quick editor state"
```

---

## Task 2: App State 扩展 — 模式切换

在 appStore 中支持 Launcher 浮窗的双模式状态。

**Files:**
- Modify: `src/workspace/appStore.ts` — 新增 Quick Editor 模式状态

- [ ] **Step 1: 确认 appStore 当前 globalLauncherMode 定义**

Run: `grep -n "globalLauncherMode\|LauncherMode" src/workspace/appStore.ts | head -20`

了解现有 mode 的类型和用法。

- [ ] **Step 2: 扩展 mode 类型**

在 appStore 中找到 `globalLauncherMode` 的类型定义，将其扩展：

```typescript
// 原来可能是:
// globalLauncherMode: 'search' | 'surface' | ...
// 新增 'quick-editor':
type GlobalLauncherMode = 'search' | 'surface' | 'settings' | 'quick-editor'
```

新增 action：

```typescript
openQuickEditor: () => void
closeQuickEditor: () => void
toggleQuickEditor: () => void
```

`openQuickEditor` 实现：
```typescript
openQuickEditor: () => set({
  globalLauncherOpen: true,
  globalLauncherMode: 'quick-editor',
}),
```

`toggleQuickEditor` 实现：
```typescript
toggleQuickEditor: () => {
  const { globalLauncherOpen, globalLauncherMode } = get()
  if (globalLauncherOpen && globalLauncherMode === 'quick-editor') {
    // 已打开 Editor 模式 → 关闭
    get().closeGlobalLauncher()
  } else if (globalLauncherOpen) {
    // 已打开其他模式 → 切换到 Editor
    set({ globalLauncherMode: 'quick-editor' })
  } else {
    // 未打开 → 打开为 Editor 模式
    get().openQuickEditor()
  }
},
```

- [ ] **Step 3: 确保 toggleGlobalLauncher 切换到 Launcher 模式时能从 Editor 切回**

验证现有 `toggleGlobalLauncher`（热键 A）在 `mode === 'quick-editor'` 时的行为：
- 如果当前是 quick-editor 模式，按热键 A 应切回 launcher 的 search 模式
- 修改 `toggleGlobalLauncher` 以支持此逻辑

- [ ] **Step 4: 验证构建**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 5: 提交**

```bash
git add src/workspace/appStore.ts
git commit -m "feat(quick-editor): extend app store with quick-editor mode and toggle actions"
```

---

## Task 3: Layout 系统 — Editor 模式尺寸

为 Editor 模式定义尺寸常量和计算逻辑。

**Files:**
- Modify: `src/components/launcher/GlobalLauncherLayout.ts`

- [ ] **Step 1: 新增 Editor 模式尺寸常量**

```typescript
// Quick Editor 模式尺寸
export const STANDALONE_QUICK_EDITOR_WIDTH = 720
export const STANDALONE_QUICK_EDITOR_HEIGHT = 480
export const STANDALONE_QUICK_EDITOR_MIN_HEIGHT = 320
export const STANDALONE_QUICK_EDITOR_MAX_HEIGHT = 720
```

- [ ] **Step 2: 扩展 buildGlobalLauncherPanelStyle**

在函数中新增 `mode === 'quick-editor'` 分支：

```typescript
if (mode === 'quick-editor') {
  return {
    width: `calc(100vw - ${STANDALONE_LAUNCHER_HORIZONTAL_PADDING}px)`,
    maxWidth: `${STANDALONE_QUICK_EDITOR_WIDTH}px`,
    height: `calc(100vh - ${STANDALONE_LAUNCHER_VERTICAL_PADDING}px)`,
    maxHeight: `${STANDALONE_QUICK_EDITOR_MAX_HEIGHT}px`,
    '--launcher-panel-width': `${STANDALONE_QUICK_EDITOR_WIDTH}px`,
    position: 'fixed' as const,
    left: '50%',
    transform: 'translateX(-50%)',
    top: 12,
  }
}
```

- [ ] **Step 3: 扩展 computeStandaloneLauncherSize**

新增 `mode === 'quick-editor'` 分支返回 Editor 窗口尺寸：

```typescript
if (mode === 'quick-editor') {
  return {
    width: STANDALONE_QUICK_EDITOR_WIDTH + STANDALONE_LAUNCHER_HORIZONTAL_PADDING,
    height: STANDALONE_QUICK_EDITOR_HEIGHT + STANDALONE_LAUNCHER_VERTICAL_PADDING,
  }
}
```

- [ ] **Step 4: 验证构建**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 5: 提交**

```bash
git add src/components/launcher/GlobalLauncherLayout.ts
git commit -m "feat(quick-editor): add editor mode sizing to launcher layout system"
```

---

## Task 4: Quick Editor 面板组件

创建 Quick Editor 的 Monaco 编辑器面板。

**Files:**
- Create: `src/components/quickEditor/QuickEditorToolbar.tsx`
- Create: `src/components/quickEditor/QuickEditorPanel.tsx`

- [ ] **Step 1: 创建工具栏组件**

```tsx
// src/components/quickEditor/QuickEditorToolbar.tsx

import { useQuickEditorStore } from '../../workspace/quickEditor/quickEditorStore'
import { useAppStore } from '../../workspace/appStore'

export function QuickEditorToolbar() {
  const language = useQuickEditorStore((s) => s.language)
  const detachQuickEditor = useAppStore((s) => s.detachQuickEditor)

  return (
    <div
      className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 select-none"
      data-no-drag
    >
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground font-medium">
          Quick Editor
        </span>
        <span className="text-xs text-muted-foreground/60">
          {language}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
          onClick={detachQuickEditor}
          title="Detach to window"
        >
          ⇗
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 创建 Quick Editor 面板组件**

```tsx
// src/components/quickEditor/QuickEditorPanel.tsx

import { useRef, useCallback, useEffect } from 'react'
import Editor, { type OnMount, type OnChange } from '@monaco-editor/react'
import { useQuickEditorStore } from '../../workspace/quickEditor/quickEditorStore'
import { useAppStore } from '../../workspace/appStore'
import { QuickEditorToolbar } from './QuickEditorToolbar'
import { registerFluxMonacoThemes } from '../../workspace/monacoThemes'

import type * as Monaco from 'monaco-editor'

export function QuickEditorPanel() {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const isLocalChangeRef = useRef(false)

  const text = useQuickEditorStore((s) => s.text)
  const language = useQuickEditorStore((s) => s.language)
  const cursorPosition = useQuickEditorStore((s) => s.cursorPosition)
  const scrollPosition = useQuickEditorStore((s) => s.scrollPosition)
  const setText = useQuickEditorStore((s) => s.setText)
  const setCursorPosition = useQuickEditorStore((s) => s.setCursorPosition)
  const setScrollPosition = useQuickEditorStore((s) => s.setScrollPosition)

  const theme = useAppStore((s) => s.settings.theme)
  const fontSize = useAppStore((s) => s.settings.fontSize)

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    registerFluxMonacoThemes(monaco)

    // 恢复光标位置
    editor.setPosition(cursorPosition)
    editor.setScrollPosition(scrollPosition)
    editor.focus()

    // 跟踪光标
    editor.onDidChangeCursorPosition((e) => {
      setCursorPosition({
        lineNumber: e.position.lineNumber,
        column: e.position.column,
      })
    })

    // 跟踪滚动
    editor.onDidScrollChange((e) => {
      setScrollPosition({
        scrollTop: e.scrollTop,
        scrollLeft: e.scrollLeft,
      })
    })

    // 注册 ⌘K 快捷键
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
      () => {
        useAppStore.getState().openQuickEditorCommand()
      }
    )
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange: OnChange = useCallback((value) => {
    if (value !== undefined) {
      isLocalChangeRef.current = true
      setText(value)
    }
  }, [setText])

  // 外部文本变更时同步到 Monaco（例如命令执行后替换文本）
  useEffect(() => {
    if (isLocalChangeRef.current) {
      isLocalChangeRef.current = false
      return
    }
    const editor = editorRef.current
    if (editor && editor.getValue() !== text) {
      editor.executeEdits('external', [{
        range: editor.getModel()!.getFullModelRange(),
        text,
      }])
    }
  }, [text])

  return (
    <div className="flex flex-col h-full overflow-hidden rounded-lg bg-background">
      <QuickEditorToolbar />
      <div className="flex-1 min-h-0">
        <Editor
          defaultValue={text}
          language={language}
          theme={theme === 'dark' ? 'flux-dark' : 'flux-light'}
          onChange={handleChange}
          onMount={handleMount}
          options={{
            fontSize: fontSize ?? 13,
            minimap: { enabled: false },
            lineNumbers: 'on',
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            padding: { top: 8, bottom: 8 },
            renderLineHighlight: 'gutter',
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            automaticLayout: true,
            tabSize: 2,
          }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 验证构建**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 4: 提交**

```bash
git add src/components/quickEditor/
git commit -m "feat(quick-editor): add QuickEditorPanel with Monaco and toolbar"
```

---

## Task 5: 模式切换动画

创建 Launcher ↔ Editor 切换的过渡动画容器。

**Files:**
- Create: `src/components/quickEditor/QuickEditorTransition.tsx`
- Modify: `src/launcher/hosts/GlobalLauncherHost.tsx`

- [ ] **Step 1: 创建动画容器**

```tsx
// src/components/quickEditor/QuickEditorTransition.tsx

import { type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface QuickEditorTransitionProps {
  mode: 'launcher' | 'quick-editor'
  launcherContent: ReactNode
  editorContent: ReactNode
}

const transition = { duration: 0.22, ease: [0.4, 0, 0.2, 1] }

export function QuickEditorTransition({
  mode,
  launcherContent,
  editorContent,
}: QuickEditorTransitionProps) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {mode === 'quick-editor' ? (
        <motion.div
          key="quick-editor"
          className="h-full w-full"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={transition}
        >
          {editorContent}
        </motion.div>
      ) : (
        <motion.div
          key="launcher"
          className="h-full w-full"
          initial={{ opacity: 0, scale: 1.02 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={transition}
        >
          {launcherContent}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: 修改 GlobalLauncherHost 集成模式切换**

在 `GlobalLauncherHost.tsx` 中：

1. 导入 `QuickEditorPanel` 和 `QuickEditorTransition`
2. 从 appStore 读取 `globalLauncherMode`
3. 当 `mode === 'quick-editor'` 时渲染 `QuickEditorPanel` 替代 `GlobalLauncherPanel`
4. 用 `QuickEditorTransition` 包裹两者实现动画切换

关键修改点（在 render 部分）：

```tsx
// 替换原来直接渲染 GlobalLauncherPanel 的逻辑：
const effectiveMode = globalLauncherMode === 'quick-editor' ? 'quick-editor' : 'launcher'

return (
  <div className={/* existing wrapper classes */}>
    <QuickEditorTransition
      mode={effectiveMode}
      launcherContent={<GlobalLauncherPanel {...panelProps} />}
      editorContent={<QuickEditorPanel />}
    />
  </div>
)
```

- [ ] **Step 3: 验证构建和视觉效果**

Run: `npm run build`
Expected: 构建成功

手动验证：在开发模式下测试切换动画是否平滑

- [ ] **Step 4: 提交**

```bash
git add src/components/quickEditor/QuickEditorTransition.tsx
git add src/launcher/hosts/GlobalLauncherHost.tsx
git commit -m "feat(quick-editor): integrate mode transition animation in GlobalLauncherHost"
```

---

## Task 6: 窗口生命周期适配

让窗口 resize、blur/close 在 Editor 模式下正确工作。

**Files:**
- Modify: `src/components/launcher/GlobalLauncherWindowLifecycle.ts`
- Modify: `src/components/launcher/GlobalLauncherClose.ts`
- Modify: `src/components/launcher/GlobalLauncherHostLifecycle.ts`

- [ ] **Step 1: 修改 resize 逻辑**

在 `useStandaloneLauncherResize` 中：当 `mode === 'quick-editor'` 时，使用 `computeStandaloneLauncherSize` 的 Editor 分支计算尺寸，并触发窗口 resize。

关键：模式切换时需要触发一次 resize（从搜索条尺寸到 Editor 尺寸）。在依赖数组中加入 `mode`。

- [ ] **Step 2: 修改 Escape 处理**

在 `useGlobalLauncherHostEscape` 中新增 Editor 模式的 Escape 逻辑：

```typescript
// 在 escape cascade 中新增：
// 如果当前是 quick-editor 模式且没有 command overlay 打开
// → 关闭浮窗（而非切回 launcher 模式）
if (mode === 'quick-editor') {
  if (quickEditorCommandOpen) {
    // 有命令覆盖层 → 关闭覆盖层
    closeQuickEditorCommand()
    return
  }
  // 无覆盖层 → 关闭浮窗
  closeLauncher()
  return
}
```

- [ ] **Step 3: Close 行为不变**

确认 `closeGlobalLauncherWindow` 在 Editor 模式下行为和 Launcher 一致（hide window + setOpen false）。不需要额外修改，但验证 `closeLauncher()` 不会重置 Quick Editor store 内容。

检查 `closeLauncher` 是否调用了 `controller.reset()`——如果是，确保 Editor 模式下不额外清理 Quick Editor 的文本。

- [ ] **Step 4: 验证构建**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 5: 提交**

```bash
git add src/components/launcher/GlobalLauncherWindowLifecycle.ts
git add src/components/launcher/GlobalLauncherClose.ts
git add src/components/launcher/GlobalLauncherHostLifecycle.ts
git commit -m "feat(quick-editor): adapt window lifecycle for editor mode (resize, escape, close)"
```

---

## Task 7: ⌘K 命令覆盖层

实现 Editor 模式下的命令搜索覆盖层。

**Files:**
- Create: `src/components/quickEditor/QuickEditorCommandOverlay.tsx`
- Create: `src/workspace/launcher/quickEditorHost.ts`
- Modify: `src/workspace/launcher/types.ts`

- [ ] **Step 1: 注册新 host 类型**

在 `src/workspace/launcher/types.ts` 中：

```typescript
// 扩展 LauncherHostId
export type LauncherHostId = 'global-launcher' | 'editor-command-bar' | 'quick-editor-command'

// 在 LAUNCHER_HOSTS 中新增
'quick-editor-command': {
  presentation: 'editor-overlay',
  capabilities: ['text-input-actions', 'pane-actions', 'parameter-customization'],
  placeholderKey: 'placeholder',
}
```

- [ ] **Step 2: 创建 Quick Editor Host 定义**

```typescript
// src/workspace/launcher/quickEditorHost.ts

import type { LauncherHostCapability } from './types'

export const QUICK_EDITOR_HOST_ID = 'quick-editor-command' as const

export const QUICK_EDITOR_HOST_CAPABILITIES: LauncherHostCapability[] = [
  'text-input-actions',
  'pane-actions',
  'parameter-customization',
]
```

- [ ] **Step 3: 创建命令覆盖层组件**

```tsx
// src/components/quickEditor/QuickEditorCommandOverlay.tsx

import { useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../../workspace/appStore'
import { useLauncherSession } from '../../workspace/launcher/useLauncherSession'
import { QUICK_EDITOR_HOST_ID } from '../../workspace/launcher/quickEditorHost'
import { LauncherMixedList } from '../launcher/LauncherMixedList'

export function QuickEditorCommandOverlay() {
  const open = useAppStore((s) => s.quickEditorCommandOpen)
  const closeCommand = useAppStore((s) => s.closeQuickEditorCommand)
  const inputRef = useRef<HTMLInputElement>(null)

  const session = useLauncherSession({
    hostId: QUICK_EDITOR_HOST_ID,
    open,
    requestClose: closeCommand,
  })

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <motion.div
      className="absolute inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm rounded-lg overflow-hidden"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15 }}
    >
      <div className="flex items-center px-3 py-2 border-b border-border/50">
        <span className="text-xs text-muted-foreground mr-2">⌘K</span>
        <input
          ref={inputRef}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          placeholder="Run a command..."
          value={session.query}
          onChange={(e) => session.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              closeCommand()
            }
          }}
        />
      </div>
      <div className="flex-1 overflow-auto">
        <LauncherMixedList
          items={session.rankedItems}
          selectedIndex={session.selectedIndex}
          onSelect={(item) => session.controller?.selectItem(item)}
        />
      </div>
    </motion.div>
  )
}
```

- [ ] **Step 4: 集成覆盖层到 QuickEditorPanel**

在 `QuickEditorPanel.tsx` 中加入 `QuickEditorCommandOverlay`：

```tsx
// 在 QuickEditorPanel render 末尾添加：
import { QuickEditorCommandOverlay } from './QuickEditorCommandOverlay'

// 在 return 的 div 内部：
<QuickEditorCommandOverlay />
```

- [ ] **Step 5: 在 appStore 中添加命令覆盖层状态**

```typescript
// appStore 新增：
quickEditorCommandOpen: boolean
openQuickEditorCommand: () => void
closeQuickEditorCommand: () => void
```

- [ ] **Step 6: 验证构建**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 7: 提交**

```bash
git add src/components/quickEditor/QuickEditorCommandOverlay.tsx
git add src/workspace/launcher/quickEditorHost.ts
git add src/workspace/launcher/types.ts
git add src/workspace/appStore.ts
git commit -m "feat(quick-editor): add ⌘K command overlay with launcher controller integration"
```

---

## Task 8: 全局快捷键注册

在 Tauri 侧注册 Quick Editor 的独立全局快捷键。

**Files:**
- Modify: `src-tauri/src/` (快捷键注册相关 Rust 文件)
- Modify: `src/App.tsx` (监听新事件)

- [ ] **Step 1: 查找现有快捷键注册位置**

Run: `grep -rn "global.*shortcut\|register.*shortcut\|launcher-open\|GlobalShortcut" src-tauri/src/ --include="*.rs" | head -20`

了解现有 `hiven://launcher-open` 快捷键的注册方式。

- [ ] **Step 2: 注册新快捷键事件**

参照 `hiven://launcher-open` 的注册方式，新增 `hiven://quick-editor-open` 事件。

快捷键默认值建议：`Option+E`（macOS）/ `Alt+E`（Windows/Linux）。

- [ ] **Step 3: 在 App.tsx 中监听事件**

```typescript
// 在 App.tsx 的 useEffect 中，和 hiven://launcher-open 并列：
const unlistenQuickEditor = await listen('hiven://quick-editor-open', () => {
  useAppStore.getState().toggleQuickEditor()
})
```

确保清理：
```typescript
return () => {
  unlistenQuickEditor()
  // ... 其他 unlisten
}
```

- [ ] **Step 4: 验证构建**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/
git add src/App.tsx
git commit -m "feat(quick-editor): register global hotkey for quick editor toggle"
```

---

## Task 9: Detach 为独立窗口

支持从浮窗 Editor 弹出为独立窗口，关闭后内容回归浮窗。

**Files:**
- Create: `src/workspace/windowManager/quickEditorWindow.ts`
- Create: `src/views/QuickEditorDetachedView.tsx`
- Modify: `src/workspace/appStore.ts` (detach action)

- [ ] **Step 1: 创建窗口管理模块**

```typescript
// src/workspace/windowManager/quickEditorWindow.ts

import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useQuickEditorStore } from '../quickEditor/quickEditorStore'

let quickEditorWindow: WebviewWindow | null = null

export async function openQuickEditorWindow(): Promise<void> {
  if (quickEditorWindow) {
    await quickEditorWindow.setFocus()
    return
  }

  quickEditorWindow = new WebviewWindow('quick-editor-detached', {
    url: '/?window=quick-editor',
    title: 'Quick Editor',
    width: 720,
    height: 480,
    minWidth: 400,
    minHeight: 300,
    decorations: true,
    center: true,
    resizable: true,
  })

  quickEditorWindow.once('tauri://destroyed', () => {
    quickEditorWindow = null
    useQuickEditorStore.getState().setDetached(false)
  })
}

export async function closeQuickEditorWindow(): Promise<void> {
  if (quickEditorWindow) {
    await quickEditorWindow.close()
    quickEditorWindow = null
  }
}

export function isQuickEditorWindowOpen(): boolean {
  return quickEditorWindow !== null
}
```

- [ ] **Step 2: 创建 detach 视图**

```tsx
// src/views/QuickEditorDetachedView.tsx

import { QuickEditorPanel } from '../components/quickEditor/QuickEditorPanel'

export function QuickEditorDetachedView() {
  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      <QuickEditorPanel />
    </div>
  )
}
```

- [ ] **Step 3: 在 appStore 添加 detach action**

```typescript
detachQuickEditor: async () => {
  const { closeGlobalLauncher } = get()
  // 1. 标记为 detached
  useQuickEditorStore.getState().setDetached(true)
  // 2. 关闭浮窗（回到 launcher 模式）
  closeGlobalLauncher()
  // 3. 打开独立窗口
  const { openQuickEditorWindow } = await import('../windowManager/quickEditorWindow')
  await openQuickEditorWindow()
},
```

- [ ] **Step 4: 在路由中处理 `?window=quick-editor`**

在应用的路由入口（可能是 `main.tsx` 或 `App.tsx`）中，根据 URL 参数渲染对应视图：

```typescript
const windowType = new URLSearchParams(window.location.search).get('window')

if (windowType === 'quick-editor') {
  return <QuickEditorDetachedView />
}
```

- [ ] **Step 5: 验证构建**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 6: 提交**

```bash
git add src/workspace/windowManager/quickEditorWindow.ts
git add src/views/QuickEditorDetachedView.tsx
git add src/workspace/appStore.ts
git commit -m "feat(quick-editor): implement detach to independent window"
```

---

## Task 10: 命令执行结果写入 Quick Editor

让 `⌘K` 执行的命令结果正确作用于 Quick Editor 内容。

**Files:**
- Create: `src/workspace/quickEditor/quickEditorActions.ts`
- Modify: `src/components/quickEditor/QuickEditorCommandOverlay.tsx`

- [ ] **Step 1: 创建 Quick Editor 专用 action 处理**

```typescript
// src/workspace/quickEditor/quickEditorActions.ts

import { useQuickEditorStore } from './quickEditorStore'
import type { FluxEffect } from '../types'

/**
 * 处理命令执行后的 effect，将 text.replace 等效果应用到 Quick Editor
 */
export function applyEffectToQuickEditor(effect: FluxEffect): void {
  const store = useQuickEditorStore.getState()

  switch (effect.kind) {
    case 'text.replace': {
      store.setText(effect.text)
      break
    }
    case 'pane.update': {
      if (effect.language) {
        store.setLanguage(effect.language)
      }
      if (effect.text !== undefined) {
        store.setText(effect.text)
      }
      break
    }
    // 其他 effect 类型在 Quick Editor 上下文中忽略
  }
}
```

- [ ] **Step 2: 在命令覆盖层中连接 effect 处理**

在 `QuickEditorCommandOverlay.tsx` 的 `useLauncherSession` 配置中，确保命令执行时的 effect 路由到 `applyEffectToQuickEditor` 而非 editor window bridge。

具体实现取决于现有 `pluginLauncherApi` 如何分发 effect——需要在创建 session 时注入自定义的 effect handler。

- [ ] **Step 3: 验证构建**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 4: 提交**

```bash
git add src/workspace/quickEditor/quickEditorActions.ts
git add src/components/quickEditor/QuickEditorCommandOverlay.tsx
git commit -m "feat(quick-editor): route command effects to quick editor content"
```

---

## Task 11: 集成测试与收尾

整体集成验证和收尾工作。

**Files:**
- Modify: 多个文件（根据测试结果修复）

- [ ] **Step 1: 全量构建验证**

Run: `npm run build`
Expected: 构建成功，无错误

- [ ] **Step 2: 架构检查**

Run: `npm run check:architecture`
Expected: 通过。Quick Editor 在 workspace 层，不违反插件边界。

- [ ] **Step 3: 手动集成测试**

启动开发模式，验证以下场景：

1. ✅ 按热键 B → 浮窗以 Editor 模式打开，Monaco 加载
2. ✅ 输入文本 → 关闭浮窗 → 重新打开 → 文本保留
3. ✅ Editor 模式下按热键 A → 动画切换到 Launcher 模式
4. ✅ Launcher 模式下按热键 B → 动画切换到 Editor 模式
5. ✅ Editor 模式下按 `⌘K` → 命令覆盖层出现
6. ✅ 选择一个文本命令执行 → 文本被正确替换
7. ✅ 按 Esc → 覆盖层关闭；再按 Esc → 浮窗关闭
8. ✅ 点击 detach 按钮 → 独立窗口打开，内容一致
9. ✅ 独立窗口中编辑 → 关闭 → 浮窗 Editor 打开后内容同步
10. ✅ blur（点击浮窗外） → 浮窗关闭

- [ ] **Step 4: 处理 framer-motion 依赖**

确认 `framer-motion` 已在 `package.json` 中。如果没有：

Run: `npm install framer-motion`

- [ ] **Step 5: 最终提交**

```bash
git add .
git commit -m "feat(quick-editor): integration polish and final fixes"
```

---

## 依赖关系

```
Task 1 (Store) ─────────────────────────────┐
Task 2 (App State) ─────────────────────────┤
Task 3 (Layout) ────────────────────────────┼──→ Task 5 (动画) ──→ Task 6 (生命周期)
Task 4 (Panel) ─────────────────────────────┘         │
                                                      ↓
Task 7 (⌘K Overlay) ──→ Task 10 (Effect 路由)        │
Task 8 (全局快捷键) ←─────────────────────────────────┘
Task 9 (Detach) ←── Task 1 + Task 4
Task 11 (集成) ←── 全部
```

可并行的任务：Task 1, 2, 3 可同时进行；Task 4 依赖 Task 1；Task 7 依赖 Task 2。
