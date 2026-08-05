import { useAppStore } from '../../store'
import { showToast } from '../toast'
import { useQuickEditorStore } from './quickEditorStore'
import type {
  QuickEditorExternalVersion,
  QuickEditorOverwriteOptions,
  QuickEditorPaneId,
} from './quickEditorTypes'
import { isQuickEditorWindowOpen, showQuickEditorWindow } from '../windowManager/quickEditorWindow'
import { requestOpenLauncherHostSurface } from '../launcherHostSurfaceBridge'

export const QUICK_EDITOR_CREATE_PANE_EVENT = 'hiven://quick-editor-create-pane'
export const QUICK_EDITOR_SET_PANE_TEXT_EVENT = 'hiven://quick-editor-set-pane-text'
export const QUICK_EDITOR_OVERWRITE_EVENT = 'hiven://quick-editor-overwrite'

export type QuickEditorPaneRequest = {
  text?: string
  language?: string
  direction?: 'left' | 'right' | 'top' | 'bottom'
}

export type QuickEditorSetPaneTextRequest = {
  paneId: QuickEditorPaneId
  text: string
}

export type QuickEditorOverwriteRequest = {
  paneId: QuickEditorPaneId
  text: string
  language?: string
  languageSource?: 'manual' | 'auto'
  externalVersionHistory: QuickEditorExternalVersion[]
}

export type OverwriteQuickEditorResult = {
  paneId: QuickEditorPaneId
  historyCount: number
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

function normalizeDirection(direction: QuickEditorPaneRequest['direction']): 'right' | 'bottom' {
  return direction === 'top' || direction === 'bottom' ? 'bottom' : 'right'
}

/**
 * Summon Quick Editor as an independent window (same presentation as clipboard).
 *
 * Desktop (Tauri): always open/focus the detached quick-editor window.
 * If the editor was hosted inside the launcher, leave that host first so only
 * one editor host is active.
 * Browser / non-Tauri: fall back to the launcher host surface.
 */
export async function showQuickEditorSurface(): Promise<void> {
  if (!isTauriRuntime()) {
    await requestOpenLauncherHostSurface('quick-editor')
    return
  }

  const state = useAppStore.getState()
  if (state.launcherHostSurfaceTarget === 'quick-editor') {
    // Single-instance rule: detach leaves the launcher host empty; put it away.
    const wasLauncherOpen = state.globalLauncherOpen
    state.setGlobalLauncherOpen(false)
    if (wasLauncherOpen) {
      try {
        const { hideLauncherWindow } = await import('../windowManager/launcherWindow')
        await hideLauncherWindow()
      } catch (error) {
        console.warn('[hiven] Failed to hide launcher while opening quick editor window:', error)
      }
    }
  }

  await showQuickEditorWindow()
}

export async function createQuickEditorPane(input: QuickEditorPaneRequest = {}): Promise<QuickEditorPaneId | undefined> {
  if (await isQuickEditorWindowOpen()) {
    await showQuickEditorWindow()
    if (isTauriRuntime()) {
      const { emit } = await import('@tauri-apps/api/event')
      await emit(QUICK_EDITOR_CREATE_PANE_EVENT, input)
    }
    return undefined
  }

  useAppStore.getState().openLauncherHostSurface('quick-editor')
  return useQuickEditorStore.getState().createPane({
    direction: normalizeDirection(input.direction),
    text: input.text,
    language: input.language,
  })
}

export function applyQuickEditorPaneRequest(input: QuickEditorPaneRequest): QuickEditorPaneId {
  return useQuickEditorStore.getState().createPane({
    direction: normalizeDirection(input.direction),
    text: input.text,
    language: input.language,
  })
}

export function isQuickEditorPaneRequest(value: unknown): value is QuickEditorPaneRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as QuickEditorPaneRequest
  return (
    (request.text === undefined || typeof request.text === 'string') &&
    (request.language === undefined || typeof request.language === 'string') &&
    (
      request.direction === undefined ||
      request.direction === 'left' ||
      request.direction === 'right' ||
      request.direction === 'top' ||
      request.direction === 'bottom'
    )
  )
}

export function applyQuickEditorSetPaneText(input: QuickEditorSetPaneTextRequest): boolean {
  return useQuickEditorStore.getState().setPaneText(input.paneId, input.text)
}

export function isQuickEditorSetPaneTextRequest(value: unknown): value is QuickEditorSetPaneTextRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as QuickEditorSetPaneTextRequest
  return typeof request.paneId === 'string' && request.paneId.length > 0 && typeof request.text === 'string'
}

/**
 * Write pane text for Diff ↔ quick-editor binding.
 * Always updates the local store; when the detached Quick Editor window is open,
 * also emit a live update so that webview stays in sync.
 */
export async function setQuickEditorPaneText(paneId: QuickEditorPaneId, text: string): Promise<boolean> {
  const updated = useQuickEditorStore.getState().setPaneText(paneId, text)
  if (!isTauriRuntime()) return updated
  try {
    if (await isQuickEditorWindowOpen()) {
      const { emit } = await import('@tauri-apps/api/event')
      await emit(QUICK_EDITOR_SET_PANE_TEXT_EVENT, { paneId, text } satisfies QuickEditorSetPaneTextRequest)
    }
  } catch (error) {
    console.warn('[hiven] Failed to emit quick editor set-pane-text:', error)
  }
  return updated
}

/**
 * Overwrite active Quick Editor content (Object Block / tool destination).
 * Archives the pre-overwrite content into external version history only —
 * user typing never creates history entries. Then open/focus the editor window.
 */
export async function overwriteQuickEditorText(
  text: string,
  options: QuickEditorOverwriteOptions = {},
): Promise<OverwriteQuickEditorResult> {
  const paneId = useQuickEditorStore.getState().overwriteActiveText(text, options)
  const history = useQuickEditorStore.getState().externalVersionHistory
  const payload: QuickEditorOverwriteRequest = {
    paneId,
    text,
    language: options.language,
    languageSource: options.language ? 'manual' : undefined,
    externalVersionHistory: history,
  }

  if (isTauriRuntime()) {
    try {
      if (await isQuickEditorWindowOpen()) {
        const { emit } = await import('@tauri-apps/api/event')
        await emit(QUICK_EDITOR_OVERWRITE_EVENT, payload)
      }
    } catch (error) {
      console.warn('[hiven] Failed to emit quick editor overwrite:', error)
    }
    await showQuickEditorSurface()
  } else {
    useAppStore.getState().openLauncherHostSurface('quick-editor')
  }

  const historyCount = useQuickEditorStore.getState().externalVersionHistory.length
  const locale = useAppStore.getState().locale
  showToast(
    historyCount > 0
      ? (locale === 'zh'
        ? `已覆盖到快捷编辑器（${historyCount} 个历史版本）`
        : `Overwritten in Quick Editor (${historyCount} version${historyCount === 1 ? '' : 's'})`)
      : (locale === 'zh' ? '已覆盖到快捷编辑器' : 'Overwritten in Quick Editor'),
    'success',
    3500,
  )

  return { paneId, historyCount }
}

/**
 * Restore a specific external-overwrite version. Does not create a new history entry.
 */
export async function restoreQuickEditorExternalVersion(versionId: string): Promise<boolean> {
  const restored = useQuickEditorStore.getState().restoreExternalVersion(versionId)
  if (!restored) return false

  const state = useQuickEditorStore.getState()
  if (isTauriRuntime()) {
    try {
      if (await isQuickEditorWindowOpen()) {
        const { emit } = await import('@tauri-apps/api/event')
        await emit(QUICK_EDITOR_OVERWRITE_EVENT, {
          paneId: state.activePaneId,
          text: state.text,
          language: state.language,
          languageSource: state.languageSource,
          externalVersionHistory: state.externalVersionHistory,
        } satisfies QuickEditorOverwriteRequest)
      }
    } catch (error) {
      console.warn('[hiven] Failed to emit quick editor version restore sync:', error)
    }
  }

  const locale = useAppStore.getState().locale
  showToast(
    locale === 'zh' ? '已恢复历史版本' : 'Restored historical version',
    'info',
    2500,
  )
  return true
}

export function applyQuickEditorOverwrite(input: QuickEditorOverwriteRequest): boolean {
  return useQuickEditorStore.getState().applyOverwriteFromRemote(input)
}

export function isQuickEditorOverwriteRequest(value: unknown): value is QuickEditorOverwriteRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as QuickEditorOverwriteRequest
  return (
    typeof request.paneId === 'string' &&
    request.paneId.length > 0 &&
    typeof request.text === 'string' &&
    (request.language === undefined || typeof request.language === 'string') &&
    (request.languageSource === undefined ||
      request.languageSource === 'manual' ||
      request.languageSource === 'auto') &&
    Array.isArray(request.externalVersionHistory)
  )
}
