# Text Diff 全屏页面重设计 - 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标:** 将 Text Diff 从 pane renderer overlay 改为编辑器内全屏页面，统一来源选择
**架构:** workspace store 新增 activeFullscreenView 状态，EditorView 条件渲染 DiffPageView
**技术栈:** React, Zustand, Monaco Editor, TypeScript

---

### Task 1: workspace store 新增 activeFullscreenView 状态

**Files:**
- Modify: `src/workspace/workspaceStore.ts`

**Step 1: 在 WorkspaceSlice 类型中新增字段**

在 store 类型定义中新增：

```ts
// DiffSource 类型（内联或单独 type）
type DiffSource = {
  sourceId: string
  kind: 'editor-pane' | 'clipboard' | 'empty'
  paneId?: string
  title: string
  language?: string
  text?: string // clipboard/empty 的初始文本
}

type FullscreenView = {
  type: 'diff'
  original: DiffSource
  modified: DiffSource
}

// store 字段
activeFullscreenView: FullscreenView | null
```

**Step 2: 新增 actions**

```ts
openDiffPage: (payload: { original: DiffSource; modified: DiffSource }) => void
clearActiveFullscreenView: () => void
```

实现：
- `openDiffPage`: set `activeFullscreenView = { type: 'diff', ...payload }`
- `clearActiveFullscreenView`: set `activeFullscreenView = null`

**Step 3: 确保 activeFullscreenView 不被持久化**

在 `partialize` 中排除 `activeFullscreenView`（已有的 partialize 逻辑只序列化 pane 核心字段，所以默认就不会持久化新字段，但需确认）。

**验证:** TypeScript 编译通过，store 可正常创建。

---

### Task 2: PluginLauncherApi 暴露 openDiffPage

**Files:**
- Modify: `src/workspace/launcher/types.ts`（PluginLauncherApi 类型）
- Modify: `src/workspace/launcher/pluginApi.ts`（实现）

**Step 1: 类型中新增方法签名**

在 `PluginLauncherApi` 类型中添加：

```ts
openDiffPage: (payload: { original: DiffSource; modified: DiffSource }) => void
```

**Step 2: 实现中调用 workspace store**

在 pluginApi.ts 的 API 对象中添加：

```ts
openDiffPage(payload) {
  useWorkspaceStore.getState().openDiffPage(payload)
}
```

**验证:** TypeScript 编译通过。

---

### Task 3: EditorView 条件渲染

**Files:**
- Modify: `src/views/EditorView.tsx`

**Step 1: 导入 DiffPageView 和 store selector**

```tsx
import { DiffPageView } from '../plugins/textDiff/DiffPageView'
// 在组件内:
const activeFullscreenView = useWorkspaceStore((s) => s.activeFullscreenView)
```

**Step 2: 条件渲染**

将原有 EditorView 的主体内容包裹在条件判断中：

```tsx
if (activeFullscreenView?.type === 'diff') {
  return <DiffPageView source={activeFullscreenView} />
}

// ... 原有 EditorView 内容不变
```

**验证:** 编译通过；手动设置 activeFullscreenView 后页面切换正确。

---

### Task 4: 创建 DiffPageView 组件

**Files:**
- Create: `src/plugins/textDiff/DiffPageView.tsx`

**Step 1: 基础结构**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getPluginHostSdk, detectExternalEditorLanguage } from '@hiven/plugin'
import { SegmentedControl, SurfaceToolbar, ToolbarButton } from '@hiven/plugin-ui'
import { CloseIcon } from '@hiven/plugin-ui/icons'
import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { canUseSemanticJsonDiff, isAutoDiffExitKey } from './autoDiffMode'
import './style.css'

const PLUGIN_ID = 'text-diff'

type DiffPageProps = {
  source: {
    type: 'diff'
    original: DiffSource
    modified: DiffSource
  }
}

export function DiffPageView({ source }: DiffPageProps) {
  const { kits, hooks } = getPluginHostSdk()
  const { DualEditorView, diff } = kits
  const t = hooks.useT(PLUGIN_ID)
  const settings = hooks.useSettings()
  const clearActiveFullscreenView = useWorkspaceStore((s) => s.clearActiveFullscreenView)

  // ... diff 逻辑（复用 TextDiffRenderer 核心逻辑）
}
```

**Step 2: 文本获取逻辑**

- `editor-pane`: 用 `hooks.usePaneText(paneId)` 获取实时文本
- `clipboard` / `empty`: 用 `useState` 管理本地文本（初始值来自 source.text）

```tsx
// editor-pane 实时文本
const originalPaneText = hooks.usePaneText(source.original.kind === 'editor-pane' ? source.original.paneId! : undefined)
const modifiedPaneText = hooks.usePaneText(source.modified.kind === 'editor-pane' ? source.modified.paneId! : undefined)

// 本地文本（clipboard/empty）
const [localOriginalText, setLocalOriginalText] = useState(source.original.text ?? '')
const [localModifiedText, setLocalModifiedText] = useState(source.modified.text ?? '')

// 统一取文本
const originalText = source.original.kind === 'editor-pane' ? (originalPaneText ?? '') : localOriginalText
const modifiedText = source.modified.kind === 'editor-pane' ? (modifiedPaneText ?? '') : localModifiedText
```

**Step 3: 编辑回调**

```tsx
const setPaneText = useWorkspaceStore((s) => s.setPaneText)

const handleOriginalChange = useCallback((text: string) => {
  if (source.original.kind === 'editor-pane' && source.original.paneId) {
    setPaneText(source.original.paneId, text)
  } else {
    setLocalOriginalText(text)
  }
}, [source.original, setPaneText])

const handleModifiedChange = useCallback((text: string) => {
  if (source.modified.kind === 'editor-pane' && source.modified.paneId) {
    setPaneText(source.modified.paneId, text)
  } else {
    setLocalModifiedText(text)
  }
}, [source.modified, setPaneText])
```

**Step 4: ESC 关闭**

```tsx
useEffect(() => {
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isAutoDiffExitKey(event.key)) return
    event.preventDefault()
    clearActiveFullscreenView()
  }
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}, [clearActiveFullscreenView])
```

**Step 5: diff 计算和渲染**

复用 TextDiffRenderer 中的 diff 计算逻辑（semanticEnabled 状态、viewModel、highlights），渲染 toolbar + DualEditorView。

**Step 6: Toolbar 渲染**

```tsx
<SurfaceToolbar className="text-diff-toolbar">
  <div className="text-diff-title-group">
    <span className="text-diff-title">{t('textDiff.title')}</span>
    <span className="text-diff-source">
      {source.original.title} ↔ {source.modified.title}
    </span>
  </div>
  <SegmentedControl ... />
  <ToolbarButton onClick={clearActiveFullscreenView} title={t('diff.exit')}>
    <CloseIcon size={13} />
  </ToolbarButton>
</SurfaceToolbar>
```

**验证:** 手动调用 `openDiffPage` 后，DiffPageView 正确渲染，ESC 可关闭。

---

### Task 5: 改写 Launcher execute 逻辑

**Files:**
- Modify: `src/plugins/textDiff/index.tsx`

**Step 1: 简化来源类型**

删除 `snapshot` 类型，简化 `TextSource` / `DiffSource` 为：

```ts
type DiffSource = {
  sourceId: string
  kind: 'editor-pane' | 'clipboard' | 'empty'
  paneId?: string
  title: string
  language?: string
  text?: string
}
```

**Step 2: 重写 buildSourceChoiceOutput**

不再区分 pane 数量，统一展示所有来源：

```ts
function buildSourceList(ctx: TextDiffLauncherContext, snapshot: PaneSnapshot): DiffSource[] {
  const paneSources = snapshot.paneIds.map((paneId) => ({
    sourceId: 'pane:' + paneId,
    kind: 'editor-pane' as const,
    paneId,
    title: paneLabel(snapshot, paneId),
    language: snapshot.panes[paneId]?.language,
  }))
  return [
    ...paneSources,
    { sourceId: 'clipboard', kind: 'clipboard', title: ctx.t('choice.clipboard') },
  ]
}
```

**Step 3: execute handler 改写**

```ts
execute(ctx) {
  const snapshot = ctx.api.getPaneSnapshot()
  const sources = buildSourceList(ctx, snapshot)
  if (sources.length < 2) return { ok: false, message: ctx.t('choice.needTwoSources') }

  const sourceById = new Map(sources.map((s) => [s.sourceId, s]))
  return {
    ok: true,
    output: {
      choices: sources.map((s) => ({
        id: s.sourceId,
        title: s.title,
        primaryAction: () => undefined,
      })),
      selection: {
        type: 'multi' as const,
        min: 2,
        max: 2,
        submitTitle: ctx.t('choice.compareSelected'),
        async submit(choices) {
          const selected = choices
            .map((c) => sourceById.get(c.id))
            .filter((s): s is DiffSource => Boolean(s))
          if (selected.length !== 2) return { ok: false, message: ctx.t('choice.needTwoSources') }

          // clipboard 需要读文本
          for (const source of selected) {
            if (source.kind === 'clipboard') {
              source.text = await ctx.api.getClipboardText()
            }
          }

          ctx.api.openDiffPage({ original: selected[0], modified: selected[1] })
          return { ok: true }
        },
      },
    },
  }
}
```

**Step 4: 删除不再需要的代码**

- 删除 `textDiffEffects()`
- 删除 `clearExistingTextDiffEffects()`
- 删除 `runTextDiff()`
- 删除 `runTextDiffForSources()`
- 删除 `materializeSourcePane()`
- 删除 `selectableSources()` 中的 snapshot/crossEditor 逻辑
- 删除 `paneTextSource()` 中的 snapshot kind
- 删除 `emptyTextSource()`（如果不再在列表中展示 empty 选项；或保留为可选）

**验证:** Launcher 展示来源列表，选 2 个后点"对比"打开 DiffPageView。

---

### Task 6: 删除旧代码

**Files:**
- Delete: `src/plugins/textDiff/TextDiffSurface.tsx`
- Modify: `src/plugins/textDiff/index.tsx`（移除 ui.surfaces、renderers、commands）
- Modify: `src/plugins/textDiff/manifest.json`（更新 version、移除 renderer capability）

**Step 1: 删除 TextDiffSurface.tsx**

直接删除文件。

**Step 2: 从 index.tsx 导出中移除**

- 删除 `import { TextDiffSurface }` 
- 删除 `import { TextDiffRenderer }`（DiffPageView 直接复用逻辑，不再注册为 renderer）
- 删除 `ui: { surfaces: [...] }` 配置
- 删除 `renderers: [...]` 配置
- 删除 `commands: [...]` 配置
- 保留 `launcher: { items: [...] }`

**Step 3: 更新 manifest.json**

```json
{
  "pluginId": "text-diff",
  "displayName": "Text Diff",
  "displayNameI18n": { "zh": "文本对比" },
  "version": "2.0.0",
  "capabilities": ["command"]
}
```

**Step 4: 清理不再使用的 import 和类型**

删除 `PaneInput`、`RendererProps` 等仅被旧 renderer 使用的 import。

**验证:** `npm run build` 通过，无死代码引用。

---

### Task 7: 样式适配

**Files:**
- Modify: `src/plugins/textDiff/style.css`

**Step 1: 确保 `.text-diff-surface` 全屏布局**

DiffPageView 复用 `.text-diff-surface` 类名，确保它是全屏 flex 布局：

```css
.text-diff-surface {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
```

**Step 2: 移除 TextDiffSurface 专属样式**

删除 `.text-diff-tool-surface` 及其子类的所有样式（textarea 相关）。

**验证:** Diff 页面全屏展示，toolbar 和 DualEditorView 布局正确。

---

### Task 8: 构建验证

**Run:**
```bash
npm run build
```
Expected: 构建成功，无 TypeScript 错误

**Run:**
```bash
npm run check:architecture
```
Expected: 架构检查通过（diff 插件不应引用 framework 内部模块）

---

## 依赖关系

```
Task 1 (store) → Task 2 (API) → Task 3 (EditorView) → Task 4 (DiffPageView)
                                                     → Task 5 (Launcher)
                                                     → Task 6 (删除旧代码)
Task 4 + Task 6 → Task 7 (样式)
All → Task 8 (构建验证)
```

## 风险点

1. **`hooks.usePaneText` 可能不存在或签名不同** — 需确认 SDK hook 实际能力，可能需要用 `useWorkspaceStore` 直接订阅
2. **DiffPageView 直接 import workspace store** — 按 CLAUDE.md 规范，first-party 插件应通过 host API/SDK 使用能力。但 `openDiffPage` / `clearActiveFullscreenView` 是框架新增 API，插件调用是合理的。如果不允许直接 import store，需要在 SDK 中额外暴露。
3. **EditorView 直接 import 插件组件** — 这是从 framework 依赖 plugin 的方向。解法：DiffPageView 注册为一个 fullscreen view contribution，EditorView 通过 registry 查询渲染。但这增加了复杂度，MVP 阶段可先直接 import。
