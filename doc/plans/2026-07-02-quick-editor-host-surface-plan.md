# Quick Editor Host Surface 化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 把 Quick Editor 从 launcher 的 `mode='quick-editor'` 寄生分支迁移为标准 host surface，删除整个 `globalLauncherMode` 死状态，新增通用 Escape 接管协议与两段式退出，命令 overlay 复用 launcher 统一组件与键盘/IME 管线，补齐 Detach 独立窗口。

**Architecture:** Quick Editor 成为 `LauncherHostSurfaceTarget` 的一个值，经 `GlobalLauncherFrameSwitch → GlobalLauncherSystemSurfaceFrame` 渲染；生命周期特判（blur/resize/escape/快捷键注销）由声明式 shell 配置表和 Escape interceptor 协议替代。设计文档：`doc/2026-07-02-quick-editor-host-surface-design.md`。

**Tech Stack:** React 19 + zustand + Tauri v2 + Monaco；验证走项目合同测试（`scripts/test-*.mjs`）+ `npm run check:architecture` + `npm run build`。

**TDD 分工（按全局规范）:** Task 1（合同测试，先红）由测试 agent 执行；Task 2–6 由实现 agent 执行（禁止改动 Task 1 的断言来迁就实现）；Task 7 由主 agent / 验收 agent 独立复核。

**注意:** 本仓库 `npm run build` 是 `vite build`，不做 TS 类型检查；类型正确性靠合同测试断言 + 目视 + `npm run lint`（lint 有历史问题，结论需区分存量与新增）。

---

### Task 1: 架构合同测试（先红）

**Files:**
- Create: `scripts/test-quick-editor-host-surface.mjs`
- Modify: `package.json`（scripts 增加一行）

- [x] **Step 1: 写合同测试**

创建 `scripts/test-quick-editor-host-surface.mjs`：

```js
#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const files = {
  packageJson: read('package.json'),
  store: read('src/store.ts'),
  host: read('src/launcher/hosts/GlobalLauncherHost.tsx'),
  systemSurfaceFrame: read('src/components/launcher/GlobalLauncherSystemSurfaceFrame.tsx'),
  hostActions: read('src/workspace/launcher/hostActions.ts'),
  hostLifecycle: read('src/components/launcher/GlobalLauncherHostLifecycle.ts'),
  keyboard: read('src/components/launcher/GlobalLauncherKeyboard.ts'),
  geometry: read('src/components/launcher/GlobalLauncherGeometry.ts'),
  layout: read('src/components/launcher/GlobalLauncherLayout.ts'),
  windowLifecycle: read('src/components/launcher/GlobalLauncherWindowLifecycle.ts'),
  hotkeys: read('src/hotkeys/globalPinnedLauncher.ts'),
  overlay: read('src/components/quickEditor/QuickEditorCommandOverlay.tsx'),
  panel: read('src/components/quickEditor/QuickEditorPanel.tsx'),
  toolbar: read('src/components/quickEditor/QuickEditorToolbar.tsx'),
  detachedView: read('src/views/QuickEditorDetachedView.tsx'),
  quickEditorWindow: read('src/workspace/windowManager/quickEditorWindow.ts'),
  appTsx: read('src/App.tsx'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:quick-editor-host-surface'],
  'node scripts/test-quick-editor-host-surface.mjs',
  'package.json must expose test:quick-editor-host-surface',
)

// ── 1. globalLauncherMode is fully removed ────────────────────────────────
assert.doesNotMatch(files.store, /GlobalLauncherMode|globalLauncherMode/, 'store must not define launcher mode state')
assert.doesNotMatch(files.host, /globalLauncherMode/, 'host must not read launcher mode')
assert.doesNotMatch(files.hotkeys, /globalLauncherMode/, 'hotkeys must not read launcher mode')
assert.doesNotMatch(files.windowLifecycle, /\bmode\b/, 'resize lifecycle must not depend on launcher mode')
assert.doesNotMatch(files.appTsx, /openGlobalLauncherOverlay\('/, 'openGlobalLauncherOverlay must take no mode argument')

// ── 2. quick-editor is a host surface target ──────────────────────────────
assert.match(
  files.store,
  /LauncherHostSurfaceTarget = 'settings' \| 'plugins' \| 'system-settings' \| 'system-plugins' \| 'quick-editor'/,
  'quick-editor must be a launcher host surface target',
)
assert.doesNotMatch(files.host, /QuickEditorPanel/, 'GlobalLauncherHost must not render QuickEditorPanel directly')
assert.match(files.systemSurfaceFrame, /QuickEditorPanel/, 'system surface frame must render QuickEditorPanel')

// ── 3. entry action: focus detached window or open surface ────────────────
assert.match(files.hostActions, /openLauncherHostSurface\('quick-editor'\)/, 'entry must open the quick-editor host surface')
assert.match(files.hostActions, /isQuickEditorWindowOpen/, 'entry must check for an existing detached window')
assert.match(files.quickEditorWindow, /export async function isQuickEditorWindowOpen/, 'window manager must expose detached-window probe')

// ── 4. escape interceptor protocol ────────────────────────────────────────
assert.ok(
  existsSync(join(root, 'src/components/launcher/launcherEscapeInterceptor.ts')),
  'launcher escape interceptor module must exist',
)
assert.match(files.hostLifecycle, /runLauncherEscapeInterceptor/, 'host escape chain must consult the interceptor')
assert.match(files.hostLifecycle, /TODO\(escape-migration\)/, 'host escape chain must carry the migration TODO')
assert.doesNotMatch(files.hostLifecycle, /quick-editor/, 'host escape chain must not carry quick editor product logic')
assert.match(files.keyboard, /hasLauncherEscapeInterceptor/, 'panel keyboard host-surface escape must yield to an active interceptor')
assert.ok(
  existsSync(join(root, 'src/components/quickEditor/useQuickEditorEscape.ts')),
  'quick editor two-stage escape hook must exist',
)
const escapeHook = read('src/components/quickEditor/useQuickEditorEscape.ts')
assert.match(escapeHook, /useLauncherEscapeInterceptor/, 'two-stage escape must register on the interceptor slot')

// ── 5. geometry/layout mode special-cases removed ──────────────────────────
assert.doesNotMatch(files.geometry, /quick-editor|QUICK_EDITOR/i, 'geometry must not special-case quick editor')
assert.doesNotMatch(files.layout, /QUICK_EDITOR/, 'layout must not re-export quick editor constants')

// ── 6. hotkey routing keyed by host surface target ─────────────────────────
assert.match(files.hotkeys, /launcherHostSurfaceTarget === 'quick-editor'/, 'hotkey routing must key off the host surface target')

// ── 7. command overlay reuses launcher pipeline ────────────────────────────
assert.match(files.overlay, /handleGlobalLauncherKeyDown/, 'overlay must use the unified launcher keyboard pipeline')
assert.match(files.overlay, /useGlobalLauncherImeComposition/, 'overlay must wire IME composition handling')
assert.match(files.overlay, /buildGlobalLauncherItems/, 'overlay must reuse the launcher item mapping')
assert.doesNotMatch(files.overlay, /Run a command\.\.\./, 'overlay placeholder must go through i18n')
assert.doesNotMatch(files.overlay, /No commands found/, 'overlay empty copy must come from the shared search frame')

// ── 8. i18n namespace ──────────────────────────────────────────────────────
assert.ok(existsSync(join(root, 'src/i18n/locales/quickEditor.ts')), 'quickEditor locale namespace must exist')
const quickEditorLocale = read('src/i18n/locales/quickEditor.ts')
assert.match(quickEditorLocale, /en:/, 'quickEditor locale must define en')
assert.match(quickEditorLocale, /zh:/, 'quickEditor locale must define zh')
assert.doesNotMatch(files.toolbar, /"Quick Editor"|'Quick Editor'|>Quick Editor</, 'toolbar title must go through i18n')

// ── 9. two-stage escape wiring in both hosts ───────────────────────────────
assert.match(files.panel, /useQuickEditorEscape/, 'panel must own the two-stage escape state machine')
assert.doesNotMatch(files.detachedView, /addEventListener\('keydown'/, 'detached view must not roll its own escape handling')
assert.doesNotMatch(files.toolbar, /closeQuickEditor\(\)/, 'toolbar must not call the removed closeQuickEditor action')

console.log('test-quick-editor-host-surface: all assertions passed')
```

- [x] **Step 2: 注册 package.json script**

在 `package.json` 的 `scripts` 中（`"test:app-launcher-contract"` 一行之后）加入：

```json
"test:quick-editor-host-surface": "node scripts/test-quick-editor-host-surface.mjs",
```

- [x] **Step 3: 运行确认失败（红）**

Run: `npm run test:quick-editor-host-surface`
Expected: FAIL —— 第一条失败应为 `store must not define launcher mode state`（`src/store.ts` 当前仍含 `globalLauncherMode`）。

- [x] **Step 4: 提交**

```bash
git add scripts/test-quick-editor-host-surface.mjs package.json
git commit -m "test(quick-editor): add host surface architecture contract (red)"
```

---

### Task 2: Escape 接管协议（launcher 通用机制）

**Files:**
- Create: `src/components/launcher/launcherEscapeInterceptor.ts`
- Modify: `src/components/launcher/GlobalLauncherHostLifecycle.ts:92-196`
- Modify: `src/components/launcher/GlobalLauncherKeyboard.ts:86-94`

- [x] **Step 1: 新建 interceptor 模块**

创建 `src/components/launcher/launcherEscapeInterceptor.ts`：

```ts
import { useEffect } from 'react'

/**
 * Generic escape takeover protocol for launcher-hosted pages.
 *
 * A page (host surface / plugin surface) may register a single interceptor.
 * The host escape chain consults it after the IME check; returning `true`
 * means the page owns this Escape press and the default chain must not run.
 * Whether to `preventDefault`/`stopPropagation` is the interceptor's call.
 */
export type LauncherEscapeInterceptor = (event: KeyboardEvent) => boolean

let activeInterceptor: LauncherEscapeInterceptor | null = null

export function runLauncherEscapeInterceptor(event: KeyboardEvent): boolean {
  return activeInterceptor ? activeInterceptor(event) : false
}

export function hasLauncherEscapeInterceptor(): boolean {
  return activeInterceptor != null
}

/** Register while mounted. Pass `null` to skip registration (e.g. wrong host). */
export function useLauncherEscapeInterceptor(handler: LauncherEscapeInterceptor | null) {
  useEffect(() => {
    if (!handler) return
    activeInterceptor = handler
    return () => {
      if (activeInterceptor === handler) activeInterceptor = null
    }
  }, [handler])
}
```

- [x] **Step 2: host Escape 链接入 interceptor 并删除 quick-editor 特判**

修改 `src/components/launcher/GlobalLauncherHostLifecycle.ts`：

顶部 import 区加入（并删除不再使用的 `useAppStore` import——它当前仅被 quick-editor 特判使用，第 5 行）：

```ts
import { runLauncherEscapeInterceptor } from './launcherEscapeInterceptor'
```

`useGlobalLauncherHostEscape` 的 `handleHostEscape` 中，删除第 129-139 行整段：

```ts
    // Quick Editor mode: Escape closes command overlay first, then launcher
    if (mode === 'quick-editor') {
      const state = useAppStore.getState()
      if (state.quickEditorCommandOpen) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      closeLauncher()
      return
    }
```

替换为：

```ts
    // TODO(escape-migration): migrate the settings / plugin surface / host
    // surface / permission branches below onto the launcherEscapeInterceptor
    // protocol so each page owns its escape handling; the default chain should
    // eventually shrink to: IME check → interceptor → controller.back → close.
    if (runLauncherEscapeInterceptor(event)) return
```

注意：本任务**不**删除 `mode` 参数本身（其余 mode 引用在 Task 5 一并移除，保持中间态可构建）；但 `handleHostEscape` 的 `useCallback` 依赖数组中的 `mode` 保留不动即可。

- [x] **Step 3: Panel 键盘链让位给 interceptor**

修改 `src/components/launcher/GlobalLauncherKeyboard.ts`：

顶部加 import：

```ts
import { hasLauncherEscapeInterceptor } from './launcherEscapeInterceptor'
```

第 86-94 行的 hostSurfaceTarget 分支：

```ts
  if (hostSurfaceTarget) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      clearLauncherHostSurface?.()
      focusSearchInputAfterBack()
    }
    return
  }
```

改为：

```ts
  if (hostSurfaceTarget) {
    // Pages that registered an escape interceptor own Escape entirely
    // (the window-capture host chain already consulted it).
    if (event.key === 'Escape' && !hasLauncherEscapeInterceptor()) {
      event.preventDefault()
      event.stopPropagation()
      clearLauncherHostSurface?.()
      focusSearchInputAfterBack()
    }
    return
  }
```

- [x] **Step 4: 构建验证**

Run: `npm run build`
Expected: 构建成功。

- [x] **Step 5: 提交**

```bash
git add src/components/launcher/launcherEscapeInterceptor.ts src/components/launcher/GlobalLauncherHostLifecycle.ts src/components/launcher/GlobalLauncherKeyboard.ts
git commit -m "feat(launcher): add generic escape interceptor protocol"
```

---

### Task 3: quickEditor i18n namespace

**Files:**
- Create: `src/i18n/locales/quickEditor.ts`

- [x] **Step 1: 新建 locale 文件**

创建 `src/i18n/locales/quickEditor.ts`（`src/i18n/index.ts` 的 `import.meta.glob` 会以文件名自动注册为 `quickEditor` namespace）：

```ts
export default {
  en: {
    title: 'Quick Editor',
    detach: 'Detach to window',
    closeWindow: 'Close window',
    commandPlaceholder: 'Run a command...',
    escExitHint: 'Press Esc again to go back',
    escCloseHint: 'Press Esc again to close',
  },
  zh: {
    title: '快捷编辑器',
    detach: '拆分为独立窗口',
    closeWindow: '关闭窗口',
    commandPlaceholder: '运行命令…',
    escExitHint: '再按一次 Esc 返回',
    escCloseHint: '再按一次 Esc 关闭窗口',
  },
}
```

- [x] **Step 2: 构建验证 + 提交**

Run: `npm run build`
Expected: 构建成功。

```bash
git add src/i18n/locales/quickEditor.ts
git commit -m "feat(quick-editor): add i18n namespace"
```

---

### Task 4: 两段式 Escape 与 Quick Editor 组件更新

**Files:**
- Create: `src/components/quickEditor/useQuickEditorEscape.ts`
- Modify: `src/components/quickEditor/QuickEditorPanel.tsx`
- Modify: `src/components/quickEditor/QuickEditorToolbar.tsx`
- Modify: `src/views/QuickEditorDetachedView.tsx`
- Modify: `src/launcher/hosts/GlobalLauncherHost.tsx:378-380`（临时接线，Task 5 删除）

- [x] **Step 1: 新建两段式 Escape hook**

创建 `src/components/quickEditor/useQuickEditorEscape.ts`：

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store'
import { useLauncherEscapeInterceptor } from '../launcher/launcherEscapeInterceptor'
import { isQuickEditorDetachedWindow } from '../../workspace/windowManager/quickEditorWindow'

const EXIT_HINT_DURATION_MS = 1500

/**
 * Quick Editor two-stage escape:
 * - command overlay open → overlay handles Escape itself (bubble phase)
 * - first Escape → show a hint only; Monaco still receives the key
 * - second Escape within the hint window → run the host-provided exit action
 *
 * Registered via the launcher escape interceptor in the surface host, and via
 * a window capture listener in the detached window (no host escape chain).
 */
export function useQuickEditorEscape(onExit: () => void) {
  const [exitHintVisible, setExitHintVisible] = useState(false)
  const hintTimerRef = useRef<number | null>(null)
  const onExitRef = useRef(onExit)

  useEffect(() => {
    onExitRef.current = onExit
  }, [onExit])

  const clearHint = useCallback(() => {
    if (hintTimerRef.current != null) window.clearTimeout(hintTimerRef.current)
    hintTimerRef.current = null
    setExitHintVisible(false)
  }, [])

  useEffect(() => () => clearHint(), [clearHint])

  const handleEscape = useCallback((event: KeyboardEvent): boolean => {
    if (event.key !== 'Escape') return false
    // The command overlay handles its own Escape in the bubble phase.
    if (useAppStore.getState().quickEditorCommandOpen) return true
    if (hintTimerRef.current != null) {
      event.preventDefault()
      event.stopPropagation()
      clearHint()
      onExitRef.current()
      return true
    }
    // First Escape: hint only. No preventDefault so Monaco can close its own
    // widgets (find, suggest) — but the host default chain must not run.
    setExitHintVisible(true)
    hintTimerRef.current = window.setTimeout(() => {
      hintTimerRef.current = null
      setExitHintVisible(false)
    }, EXIT_HINT_DURATION_MS)
    return true
  }, [clearHint])

  const detached = isQuickEditorDetachedWindow()

  // Surface host: register on the launcher escape interceptor slot.
  useLauncherEscapeInterceptor(detached ? null : handleEscape)

  // Detached window host: capture-phase window listener.
  useEffect(() => {
    if (!detached) return
    const listener = (event: KeyboardEvent) => {
      handleEscape(event)
    }
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [detached, handleEscape])

  return { exitHintVisible }
}
```

- [x] **Step 2: QuickEditorPanel 接入 hook 与 hint UI**

修改 `src/components/quickEditor/QuickEditorPanel.tsx`：

组件签名从 `export function QuickEditorPanel() {` 改为：

```tsx
export function QuickEditorPanel({ onRequestExit }: { onRequestExit: () => void }) {
```

顶部 import 增加：

```tsx
import { useQuickEditorEscape } from './useQuickEditorEscape'
import { isQuickEditorDetachedWindow } from '../../workspace/windowManager/quickEditorWindow'
import { useT } from '../../i18n'
```

组件体内（`const openQuickEditorCommand = ...` 之后）加：

```tsx
  const { exitHintVisible } = useQuickEditorEscape(onRequestExit)
  const tQuickEditor = useT('quickEditor')
  const isDetached = isQuickEditorDetachedWindow()
```

JSX 中 `<QuickEditorCommandOverlay />` 一行之前插入 hint（与 overlay 同级，root div 已是 `relative`）：

```tsx
      {exitHintVisible && (
        <div
          className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 z-40 px-2.5 py-1 rounded text-[11px]"
          style={{
            background: 'var(--color-background-tertiary)',
            color: 'var(--color-text-secondary)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
          }}
        >
          {isDetached ? tQuickEditor('escCloseHint') : tQuickEditor('escExitHint')}
        </div>
      )}
```

- [x] **Step 3: QuickEditorToolbar 改 Detach 语义 + i18n + detached 关闭按钮**

用以下内容整体替换 `src/components/quickEditor/QuickEditorToolbar.tsx`：

```tsx
import { useCallback } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { useQuickEditorStore } from '../../workspace/quickEditor/quickEditorStore'
import { getLanguageOptionLabel } from '../../workspace/languageOptions'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import {
  closeQuickEditorWindow,
  isQuickEditorDetachedWindow,
  showQuickEditorWindow,
} from '../../workspace/windowManager/quickEditorWindow'
import { hideLauncherWindow } from '../../workspace/windowManager/launcherWindow'
import { isStandaloneLauncherWindow } from '../launcher/GlobalLauncherHostLifecycle'

export function QuickEditorToolbar() {
  const language = useQuickEditorStore((s) => s.language)
  const locale = useAppStore((s) => s.locale)
  const t = useT('quickEditor')
  const languageLabel = getLanguageOptionLabel(language, locale)
  const isDetached = isQuickEditorDetachedWindow()

  const handleDetach = useCallback(async () => {
    try {
      await showQuickEditorWindow()
      // The editor now lives in the detached window; put the launcher away.
      useAppStore.getState().setGlobalLauncherOpen(false)
      if (isStandaloneLauncherWindow()) {
        await hideLauncherWindow()
      }
    } catch (error) {
      console.warn('[hiven] Failed to detach quick editor:', error)
    }
  }, [])

  const handleCloseWindow = useCallback(() => {
    void closeQuickEditorWindow().catch((error) => {
      console.warn('[hiven] Failed to close quick editor window:', error)
    })
  }, [])

  return (
    <div
      className="flex items-center justify-between px-3 h-8 shrink-0 select-none"
      style={{
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        background: 'var(--color-background-secondary)',
      }}
      data-no-drag
    >
      <div className="flex items-center gap-2">
        <span
          className="text-[11px] font-medium"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {t('title')}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {languageLabel}
        </span>
        {!isDetached && (
          <button
            type="button"
            className="flex items-center justify-center w-5 h-5 rounded transition-colors"
            style={{ color: 'var(--color-text-tertiary)' }}
            title={t('detach')}
            onClick={handleDetach}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)' }}
          >
            <ExternalLink size={12} />
          </button>
        )}
        {isDetached && (
          <button
            type="button"
            className="flex items-center justify-center w-5 h-5 rounded transition-colors"
            style={{ color: 'var(--color-text-tertiary)' }}
            title={t('closeWindow')}
            onClick={handleCloseWindow}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)' }}
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  )
}
```

- [x] **Step 4: QuickEditorDetachedView 移除自绘 Escape**

用以下内容整体替换 `src/views/QuickEditorDetachedView.tsx`：

```tsx
import { useCallback } from 'react'
import { useAppStore } from '../store'
import { QuickEditorPanel } from '../components/quickEditor/QuickEditorPanel'
import { closeQuickEditorWindow } from '../workspace/windowManager/quickEditorWindow'

/**
 * Root view for the detached Quick Editor window.
 * Shares the same quickEditorStore; two-stage Escape lives inside the panel.
 */
export function QuickEditorDetachedView() {
  const theme = useAppStore((s) => s.settings.theme)
  const fontSize = useAppStore((s) => s.settings.fontSize)

  const handleRequestExit = useCallback(() => {
    void closeQuickEditorWindow().catch((error) => {
      console.warn('[hiven] Failed to close quick editor window:', error)
    })
  }, [])

  return (
    <div
      className="h-screen w-screen overflow-hidden"
      data-theme={theme}
      style={{ fontSize }}
    >
      <QuickEditorPanel onRequestExit={handleRequestExit} />
    </div>
  )
}
```

- [x] **Step 5: Host 的旧渲染分支临时补参（Task 5 将整体删除该分支）**

修改 `src/launcher/hosts/GlobalLauncherHost.tsx` 第 379 行，`<QuickEditorPanel />` 改为：

```tsx
          <QuickEditorPanel onRequestExit={closeLauncher} />
```

- [x] **Step 6: 构建验证**

Run: `npm run build`
Expected: 构建成功。

- [x] **Step 7: 提交**

```bash
git add src/components/quickEditor/useQuickEditorEscape.ts src/components/quickEditor/QuickEditorPanel.tsx src/components/quickEditor/QuickEditorToolbar.tsx src/views/QuickEditorDetachedView.tsx src/launcher/hosts/GlobalLauncherHost.tsx
git commit -m "feat(quick-editor): two-stage escape hook and host-agnostic exit wiring"
```

---

### Task 5: 删除 globalLauncherMode，Quick Editor surface 化接线

> 本任务是 mode 删除的原子单元：所有引用点必须在同一任务内清理完，中间步骤不单独构建，最后统一 build。

**Files:**
- Modify: `src/workspace/windowManager/quickEditorWindow.ts`
- Create: `src/components/launcher/hostSurfaceShell.ts`
- Modify: `src/store.ts:142,164,188-206,408-439`
- Modify: `src/App.tsx:167`
- Modify: `src/workspace/pluginSurfaceOpenRequest.ts:57`
- Modify: `src/workspace/launcher/hostActions.ts:181-200`
- Modify: `src/components/launcher/GlobalLauncherItems.ts:9-30`
- Modify: `src/components/launcher/GlobalLauncherGeometry.ts:16-18,22-50`
- Modify: `src/components/launcher/GlobalLauncherLayout.ts:21-23`
- Modify: `src/components/launcher/GlobalLauncherWindowLifecycle.ts:56-123`
- Modify: `src/components/launcher/GlobalLauncherHostLifecycle.ts:92-196`
- Modify: `src/components/launcher/GlobalLauncherSystemSurfaceFrame.tsx`
- Modify: `src/launcher/hosts/GlobalLauncherHost.tsx`
- Modify: `src/hotkeys/globalPinnedLauncher.ts:24-32,88-98,193-201`

- [x] **Step 1: quickEditorWindow 增加探测函数**

在 `src/workspace/windowManager/quickEditorWindow.ts` 末尾追加：

```ts
export async function isQuickEditorWindowOpen(): Promise<boolean> {
  if (!isTauriRuntime()) return false
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const window = await WebviewWindow.getByLabel(QUICK_EDITOR_WINDOW_LABEL)
    return window != null
  } catch (error) {
    console.warn('[hiven] Failed to probe quick editor window:', error)
    return false
  }
}
```

- [x] **Step 2: 新建 host surface shell 配置表**

创建 `src/components/launcher/hostSurfaceShell.ts`：

```ts
import type { LauncherHostSurfaceTarget } from '../../store'

/**
 * Declarative shell config for host surfaces, mirroring plugin surface
 * `shell` contributions. Targets without an entry use launcher defaults
 * (close on blur, standard host surface geometry).
 */
type HostSurfaceShellConfig = {
  closeOnBlur?: boolean
}

const HOST_SURFACE_SHELL: Partial<Record<LauncherHostSurfaceTarget, HostSurfaceShellConfig>> = {
  'quick-editor': { closeOnBlur: false },
}

export function getHostSurfaceShell(
  target: LauncherHostSurfaceTarget | null,
): HostSurfaceShellConfig | undefined {
  return target ? HOST_SURFACE_SHELL[target] : undefined
}
```

- [x] **Step 3: store.ts 删除 mode、扩展 surface target**

修改 `src/store.ts`：

删除第 142 行：

```ts
export type GlobalLauncherMode = 'full' | 'pinned-only' | 'quick-editor'
```

第 164 行改为：

```ts
export type LauncherHostSurfaceTarget = 'settings' | 'plugins' | 'system-settings' | 'system-plugins' | 'quick-editor'
```

接口区（187-206 行），把

```ts
  globalLauncherOpen: boolean
  globalLauncherMode: GlobalLauncherMode
  globalLauncherOverlay: boolean
  setGlobalLauncherOpen: (open: boolean, mode?: GlobalLauncherMode) => void
  openGlobalLauncher: (mode: GlobalLauncherMode) => void
  openGlobalLauncherOverlay: (mode: GlobalLauncherMode) => void
```

改为（`openGlobalLauncher` 无调用者，随 mode 一并删除）：

```ts
  globalLauncherOpen: boolean
  globalLauncherOverlay: boolean
  setGlobalLauncherOpen: (open: boolean) => void
  openGlobalLauncherOverlay: () => void
```

并把 Quick Editor 区块

```ts
  // Quick Editor
  quickEditorCommandOpen: boolean
  openQuickEditor: () => void
  closeQuickEditor: () => void
  toggleQuickEditor: () => void
  openQuickEditorCommand: () => void
  closeQuickEditorCommand: () => void
```

改为：

```ts
  // Quick Editor
  quickEditorCommandOpen: boolean
  openQuickEditorCommand: () => void
  closeQuickEditorCommand: () => void
```

实现区（408-439 行），把

```ts
  globalLauncherOpen: false,
  globalLauncherMode: 'full',
  globalLauncherOverlay: false,
  pluginSurfaceToolTarget: null,
  launcherHostSurfaceTarget: null,
  setGlobalLauncherOpen: (open, mode) => set((state) => ({
    globalLauncherOpen: open,
    globalLauncherMode: mode ?? (open ? state.globalLauncherMode : 'full'),
    globalLauncherOverlay: open ? state.globalLauncherOverlay : false,
    ...(open ? {} : { launcherHostSurfaceTarget: null }),
  })),
  openGlobalLauncher: (mode) => set({ globalLauncherOpen: true, globalLauncherMode: mode }),
  openGlobalLauncherOverlay: (mode) => set({ globalLauncherOpen: true, globalLauncherMode: mode, globalLauncherOverlay: true }),
  openPluginSurfaceTool: (target) => set({ pluginSurfaceToolTarget: target, launcherHostSurfaceTarget: null }),
  clearPluginSurfaceTool: () => set({ pluginSurfaceToolTarget: null }),
  openLauncherHostSurface: (target) => set({ launcherHostSurfaceTarget: target, pluginSurfaceToolTarget: null, globalLauncherOpen: true, globalLauncherMode: 'full' }),
  clearLauncherHostSurface: () => set({ launcherHostSurfaceTarget: null }),

  // Quick Editor
  quickEditorCommandOpen: false,
  openQuickEditor: () => set({ globalLauncherOpen: true, globalLauncherMode: 'quick-editor' }),
  closeQuickEditor: () => set({ globalLauncherMode: 'full', quickEditorCommandOpen: false }),
  toggleQuickEditor: () => {
    const { globalLauncherOpen, globalLauncherMode } = get()
    if (globalLauncherOpen && globalLauncherMode === 'quick-editor') {
      get().setGlobalLauncherOpen(false)
    } else {
      get().openQuickEditor()
    }
  },
  openQuickEditorCommand: () => set({ quickEditorCommandOpen: true }),
  closeQuickEditorCommand: () => set({ quickEditorCommandOpen: false }),
```

改为：

```ts
  globalLauncherOpen: false,
  globalLauncherOverlay: false,
  pluginSurfaceToolTarget: null,
  launcherHostSurfaceTarget: null,
  setGlobalLauncherOpen: (open) => set((state) => ({
    globalLauncherOpen: open,
    globalLauncherOverlay: open ? state.globalLauncherOverlay : false,
    ...(open ? {} : { launcherHostSurfaceTarget: null, quickEditorCommandOpen: false }),
  })),
  openGlobalLauncherOverlay: () => set({ globalLauncherOpen: true, globalLauncherOverlay: true }),
  openPluginSurfaceTool: (target) => set({ pluginSurfaceToolTarget: target, launcherHostSurfaceTarget: null }),
  clearPluginSurfaceTool: () => set({ pluginSurfaceToolTarget: null }),
  openLauncherHostSurface: (target) => set({ launcherHostSurfaceTarget: target, pluginSurfaceToolTarget: null, globalLauncherOpen: true }),
  clearLauncherHostSurface: () => set({ launcherHostSurfaceTarget: null }),

  // Quick Editor
  quickEditorCommandOpen: false,
  openQuickEditorCommand: () => set({ quickEditorCommandOpen: true }),
  closeQuickEditorCommand: () => set({ quickEditorCommandOpen: false }),
```

- [x] **Step 4: 更新 openGlobalLauncherOverlay 调用点**

`src/App.tsx:167`：`openGlobalLauncherOverlay('pinned-only')` → `openGlobalLauncherOverlay()`
`src/workspace/pluginSurfaceOpenRequest.ts:57`：同样改为 `openGlobalLauncherOverlay()`

- [x] **Step 5: hostActions 入口改为 surface / 聚焦独立窗口**

修改 `src/workspace/launcher/hostActions.ts`：文件顶部 import 区加入

```ts
import { isQuickEditorWindowOpen, showQuickEditorWindow } from '../windowManager/quickEditorWindow'
```

（该文件已 import `useAppStore`，路径按文件内既有相对层级书写。）

第 181-200 行的 `host:view:quick-editor` 项，`subtitle`/`execute` 改为：

```ts
    {
      systemKey: 'host:view:quick-editor',
      kind: 'host',
      display: {
        title: 'Quick Editor',
        titleI18n: { zh: '快捷编辑器' },
        subtitle: 'Open inline editor',
        subtitleI18n: { zh: '打开内嵌编辑器' },
        icon: 'SquarePen',
        aliases: ['quick editor', 'editor', 'scratch', 'scratchpad', 'notepad', '编辑器', '快捷编辑', '记事本', '草稿'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      requiredCapabilities: ['pane-actions'],
      pinnable: false,
      execute: async () => {
        // Single-instance rule: if the editor lives in the detached window,
        // focus it instead of opening the surface.
        if (await isQuickEditorWindowOpen()) {
          await showQuickEditorWindow()
          return { ok: true }
        }
        useAppStore.getState().openLauncherHostSurface('quick-editor')
        return { ok: true, keepOpen: true }
      },
    },
```

- [x] **Step 6: GlobalLauncherItems 删 mode 参数**

修改 `src/components/launcher/GlobalLauncherItems.ts`：删除签名中的 `mode`（第 10 行解构、第 18 行类型 `mode: string`）与第 26 行 `void mode`。

- [x] **Step 7: Geometry / Layout 删 mode 与 Quick Editor 常量**

`src/components/launcher/GlobalLauncherGeometry.ts`：

- 删除第 16-18 行三个常量 `STANDALONE_QUICK_EDITOR_WIDTH/HEIGHT/MAX_HEIGHT`
- `StandaloneLauncherGeometryInput` 删除 `mode?: string` 字段
- `computeStandaloneLauncherGeometry` 删除解构参数 `mode` 与第 45-50 行整个 `if (mode === 'quick-editor')` 分支

`src/components/launcher/GlobalLauncherLayout.ts`：删除 re-export 中的 `STANDALONE_QUICK_EDITOR_HEIGHT`、`STANDALONE_QUICK_EDITOR_MAX_HEIGHT`、`STANDALONE_QUICK_EDITOR_WIDTH` 三行（21-23）。

- [x] **Step 8: WindowLifecycle resize 删 mode**

修改 `src/components/launcher/GlobalLauncherWindowLifecycle.ts` 的 `useStandaloneLauncherResize`：删除参数 `mode`（解构第 64 行、类型第 74 行）、`computeStandaloneLauncherGeometry` 调用中的 `mode: mode as string | undefined`（第 93 行）、依赖数组中的 `mode`（第 114 行）。

- [x] **Step 9: HostLifecycle 删 mode 参数**

修改 `src/components/launcher/GlobalLauncherHostLifecycle.ts` 的 `useGlobalLauncherHostEscape`：删除解构参数 `mode`、类型 `mode?: string`、`useCallback` 依赖数组中的 `mode`。

- [x] **Step 10: SystemSurfaceFrame 渲染 Quick Editor**

修改 `src/components/launcher/GlobalLauncherSystemSurfaceFrame.tsx`：顶部 import 加

```tsx
import { QuickEditorPanel } from '../quickEditor/QuickEditorPanel'
```

在 `if (target === 'system-settings' || target === 'system-plugins')` 之前插入：

```tsx
  if (target === 'quick-editor') {
    return (
      <div
        className="global-launcher-host-surface-shell flex flex-col min-h-0 outline-none"
        tabIndex={-1}
        style={{ height }}
      >
        <SurfaceBreadcrumbHeader
          title={t(locale, 'quickEditor.title')}
          onBack={onBack}
          onClose={onClose}
        />
        <div className="global-launcher-body" style={{ height: bodyHeight, maxHeight: bodyHeight, overflow: 'hidden' }}>
          <QuickEditorPanel onRequestExit={onBack} />
        </div>
      </div>
    )
  }
```

- [x] **Step 11: GlobalLauncherHost 大清理**

修改 `src/launcher/hosts/GlobalLauncherHost.tsx`：

1. 删除 import：第 29 行 `QuickEditorPanel`、第 30 行 `STANDALONE_QUICK_EDITOR_WIDTH, STANDALONE_LAUNCHER_VERTICAL_PADDING`；新增 import：

```ts
import { getHostSurfaceShell } from '../../components/launcher/hostSurfaceShell'
```

2. `useShallow` selector（第 35/45 行）删除 `mode: s.globalLauncherMode,` 与解构中的 `mode`。
3. 输入源 effect（第 100-111 行）删除 `if (mode === 'quick-editor') return` 一行，依赖数组 `[mode, open]` 改为 `[open]`。
4. `useCloseStandaloneLauncherOnBlur`（第 213-218 行）的 `closeOnBlur` 改为：

```ts
    closeOnBlur: getHostSurfaceShell(launcherHostSurfaceTarget)?.closeOnBlur
      ?? activeSurfaceFrame?.surface.shell?.closeOnBlur,
```

5. `buildGlobalLauncherItems` 调用（第 150-158 行）删除 `mode,` 一行，`useMemo` 依赖数组删除 `mode`。
6. `useStandaloneLauncherResize` 调用（第 243-253 行）删除 `mode,` 一行。
7. `useGlobalLauncherHostEscape` 调用（第 275-291 行）删除 `mode,` 一行。
8. 删除第 354-383 行整个 `if (mode === 'quick-editor') { ... }` 渲染分支（含注释）。

- [x] **Step 12: globalPinnedLauncher 三处 mode 检查改为 surface target**

修改 `src/hotkeys/globalPinnedLauncher.ts`：

第 27-28 行：

```ts
    const quickEditorActive = state.globalLauncherOpen && state.launcherHostSurfaceTarget === 'quick-editor'
    const previousQuickEditorActive = previousState.globalLauncherOpen && previousState.launcherHostSurfaceTarget === 'quick-editor'
```

第 90-98 行的条件改为：

```ts
  if (
    useAppStore.getState().globalLauncherOpen &&
    useAppStore.getState().launcherHostSurfaceTarget === 'quick-editor' &&
    shortcut.kind === 'accelerator' &&
    isQuickEditorCommandAccelerator(shortcut.accelerator)
  ) {
```

第 193-201 行的 `routeGlobalPinnedLauncherShortcut`：

```ts
export async function routeGlobalPinnedLauncherShortcut() {
  const state = useAppStore.getState()
  if (state.globalLauncherOpen && state.launcherHostSurfaceTarget === 'quick-editor') {
    suppressStandaloneLauncherBlur()
    state.openQuickEditorCommand()
    return
  }
  await showLauncherWindow()
}
```

- [x] **Step 13: 全仓孤儿引用扫描**

Run: `grep -rn "globalLauncherMode\|GlobalLauncherMode\|openQuickEditor()\|closeQuickEditor()\|toggleQuickEditor\|STANDALONE_QUICK_EDITOR" src/`
Expected: 无输出（`openQuickEditorCommand` 不在匹配范围，属正常保留）。

- [x] **Step 14: 构建验证**

Run: `npm run build && npm run check:architecture`
Expected: 均通过。

- [x] **Step 15: 提交**

```bash
git add -A src/
git commit -m "refactor(quick-editor): migrate to launcher host surface, drop globalLauncherMode"
```

---

### Task 6: 命令 overlay 复用 launcher 统一管线

**Files:**
- Modify: `src/components/quickEditor/QuickEditorCommandOverlay.tsx`（整体重写，273 → 约 130 行）

- [x] **Step 1: 重写 overlay**

用以下内容整体替换 `src/components/quickEditor/QuickEditorCommandOverlay.tsx`：

```tsx
import { useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '../../store'
import { useLauncherSession } from '../../workspace/launcher/useLauncherSession'
import { filterEditorCommandBarItems } from '../../workspace/launcher/types'
import { createQuickEditorLauncherApi } from '../../workspace/quickEditor/quickEditorActions'
import { GlobalLauncherFrameSwitch } from '../launcher/GlobalLauncherFrames'
import { useGlobalLauncherResultFrame } from '../launcher/GlobalLauncherResults'
import { buildGlobalLauncherItems, type GlobalLauncherItem } from '../launcher/GlobalLauncherItems'
import { handleGlobalLauncherKeyDown } from '../launcher/GlobalLauncherKeyboard'
import { useGlobalLauncherImeComposition } from '../launcher/GlobalLauncherHostLifecycle'
import { useT } from '../../i18n'
import type { ClipboardObjectBlockState } from '../../launcher/clipboard/useClipboardObjectBlock'

const MAX_OVERLAY_ITEMS = 12

export function QuickEditorCommandOverlay() {
  const open = useAppStore((s) => s.quickEditorCommandOpen)
  const closeCommand = useAppStore((s) => s.closeQuickEditorCommand)
  const locale = useAppStore((s) => s.locale)
  const tQuickEditor = useT('quickEditor')
  const inputRef = useRef<HTMLInputElement>(null)
  const isKeyboardNavRef = useRef(false)
  const { isImeComposingRef, handleCompositionStart, handleCompositionEnd } = useGlobalLauncherImeComposition()

  const {
    query,
    setQuery,
    selectedIndex,
    setSelectedIndex,
    controllerRef,
    controllerState,
    rankedItems,
  } = useLauncherSession({
    hostId: 'quick-editor-command',
    open,
    requestClose: closeCommand,
    staticItemFilter: filterEditorCommandBarItems,
    makeApi: createQuickEditorLauncherApi,
  })

  const activeResultFrame = controllerState?.frames.length
    ? controllerState.frames[controllerState.frames.length - 1]
    : null
  const {
    resultSelectedIndex,
    setResultSelectedIndex,
    selectedResultChoiceIds,
    activateResultChoice,
    toggleResultChoice,
  } = useGlobalLauncherResultFrame({
    controller: controllerRef.current,
    activeResultFrame: activeResultFrame?.kind === 'result' ? activeResultFrame : null,
  })

  const emptyClipboardBlock = useMemo<ClipboardObjectBlockState>(() => ({
    mode: 'search-only',
    block: null,
    hint: null,
    removeBlock: () => {},
    selectBlockForDelete: () => {},
    handleBackspace: () => false,
    attachHintAsBlock: () => {},
  }), [])

  const visibleFiltered = useMemo(() => buildGlobalLauncherItems({
    pinnedActions: [],
    rankedLauncherItems: rankedItems.slice(0, MAX_OVERLAY_ITEMS),
    query,
    locale,
    recentActionNames: [],
    actionUsageCounts: {},
  }), [locale, query, rankedItems])
  const selectedItem = visibleFiltered[Math.min(selectedIndex, Math.max(0, visibleFiltered.length - 1))]

  const selectMixedItem = (item?: GlobalLauncherItem) => {
    if (item?.kind === 'domain') controllerRef.current?.selectItem(item.domainItem)
  }
  const focusSearchInputAfterBack = () => requestAnimationFrame(() => inputRef.current?.focus())

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [open, setQuery, setSelectedIndex])

  if (!open) return null

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col overflow-hidden"
      style={{
        background: 'var(--color-background-primary, var(--panel, #fff))',
        borderRadius: 'inherit',
      }}
      onKeyDown={(event) => handleGlobalLauncherKeyDown({
        event,
        isImeComposingRef,
        launcherSettingsTarget: null,
        closeSettingsDialog: () => {},
        focusSearchInputAfterBack,
        hostSurfaceTarget: null,
        clearLauncherHostSurface: undefined,
        surfaceFrame: null,
        leaveSurface: () => {},
        itemPermissionFrame: null,
        cancelItemPermissionPrompt: () => {},
        controllerState,
        controllerRef,
        resultSelectedIndex,
        setResultSelectedIndex,
        toggleResultChoice,
        closeLauncher: closeCommand,
        isKeyboardNavRef,
        visibleFilteredLength: visibleFiltered.length,
        setSelectedIndex,
        selectedItem,
        isWorkflowObjectLauncherItem: () => false,
        selectItem: (item) => selectMixedItem(item),
      })}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
    >
      <GlobalLauncherFrameSwitch
        hostSurfaceTarget={null}
        hostSurfaceHeight={0}
        launcherSettingsTarget={null}
        settingsHeight={0}
        surfaceFrame={null}
        activeSurfaceFrame={null}
        itemPermissionFrame={null}
        controllerState={controllerState}
        inputRef={inputRef}
        query={query}
        searchPlaceholder={tQuickEditor('commandPlaceholder')}
        visibleFiltered={visibleFiltered}
        selectedItem={selectedItem}
        locale={locale}
        resultSelectedIndex={resultSelectedIndex}
        selectedResultChoiceIds={selectedResultChoiceIds}
        showCustomizeHint={false}
        showWorkflowObjectHint={false}
        customizeShortcutLabel="⌘↵"
        onSettingsClose={closeCommand}
        onSurfaceBack={closeCommand}
        onSurfaceClose={closeCommand}
        onPermissionBack={closeCommand}
        onPermissionGrant={() => {}}
        onParamQueryChange={(value) => controllerRef.current?.setParamQuery(value)}
        onParamSelectedIndexChange={(index) => controllerRef.current?.setParamSelectedIndex(index)}
        onParamCommit={(value) => { void controllerRef.current?.commitCurrentParam(value) }}
        onParamMultiToggle={(value) => controllerRef.current?.toggleCurrentMultiParamValue(value)}
        onFrameBack={() => {
          if (controllerRef.current?.back?.()) focusSearchInputAfterBack()
          else closeCommand()
        }}
        onCollectInputChange={(value) => controllerRef.current?.setInputText(value)}
        onActivateResultChoice={activateResultChoice}
        onHoverResultChoice={setResultSelectedIndex}
        onToggleResultChoice={toggleResultChoice}
        onSearchQueryChange={(value) => { setQuery(value); setSelectedIndex(0) }}
        onSearchSelectItem={(item) => selectMixedItem(item)}
        onSearchHoverIndex={(index) => { if (!isKeyboardNavRef.current) setSelectedIndex(index) }}
        onSearchMouseMove={() => { isKeyboardNavRef.current = false }}
        clipboardBlock={emptyClipboardBlock}
      />
    </div>
  )
}
```

- [x] **Step 2: 构建验证**

Run: `npm run build`
Expected: 构建成功。

- [x] **Step 3: 提交**

```bash
git add src/components/quickEditor/QuickEditorCommandOverlay.tsx
git commit -m "refactor(quick-editor): command overlay reuses launcher search frame and keyboard pipeline"
```

---

### Task 7: 全量验证与收尾（主 agent / 验收 agent）

- [x] **Step 1: 合同测试转绿**

Run: `npm run test:quick-editor-host-surface`
Expected: `test-quick-editor-host-surface: all assertions passed`

- [x] **Step 2: 项目验证命令**

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
```

Expected: 全部通过；`git status` 中除本次改动与既有的 `src-tauri/*.dylib` 未跟踪文件外无意外产物。

- [x] **Step 3: 真机手动验证（`npm run dev` + Tauri 环境）**

按设计文档验证清单逐项执行：

1. launcher 列表选 Quick Editor → surface 原地展开（920×760，带 breadcrumb）
2. surface 内 Cmd+K 连按多次 → 命令 overlay 开合，launcher 窗口不消失（原 bug 路径）
3. 两段式 Esc：overlay 打开时 Esc 先关 overlay；编辑器内第一次 Esc 出提示（Monaco find widget 打开时先关 widget）、1.5s 内第二次 Esc 返回列表、列表 Esc 关窗
4. blur（点击窗口外 / 切换 app）不关闭 Quick Editor surface；其他 surface（如 system-settings）blur 行为不变
5. 命令 overlay 中文 IME 输入，Enter 上屏不触发命令确认
6. Toolbar Detach → 独立窗口打开且内容一致，launcher 收起；launcher 重开显示命令列表；列表再选 Quick Editor → 聚焦独立窗口
7. 独立窗口内两段式 Esc（提示文案为"关闭"）→ 窗口关闭；从 launcher 进入回到 surface 形态、内容保留
8. 全局快捷键在 surface 激活时打开命令 overlay；关窗重开回到命令列表
9. 中英文 locale 切换后所有 Quick Editor 文案正确

- [x] **Step 4: 若第 2 条仍复现窗口消失**

按设计文档风险节处理：不回滚本次重构，单独立案调查 NSPanel 层面残留（`src-tauri/src/lib.rs:1546-1593` 的 `HivenKeyablePanel` 与 Cmd 修饰键交互），detached 普通窗口为逃生舱。

- [x] **Step 5: 收尾提交（如有验证期修补）**

```bash
git add -A
git commit -m "fix(quick-editor): address issues found during host-surface verification"
```
