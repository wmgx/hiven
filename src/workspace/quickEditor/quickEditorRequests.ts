import { useAppStore } from '../../store'
import { useQuickEditorStore } from './quickEditorStore'
import type { QuickEditorPaneId } from './quickEditorTypes'
import { isQuickEditorWindowOpen, showQuickEditorWindow } from '../windowManager/quickEditorWindow'
import { requestOpenLauncherHostSurface } from '../launcherHostSurfaceBridge'

export const QUICK_EDITOR_CREATE_PANE_EVENT = 'hiven://quick-editor-create-pane'
export const QUICK_EDITOR_SET_PANE_TEXT_EVENT = 'hiven://quick-editor-set-pane-text'

export type QuickEditorPaneRequest = {
  text?: string
  language?: string
  direction?: 'left' | 'right' | 'top' | 'bottom'
}

export type QuickEditorSetPaneTextRequest = {
  paneId: QuickEditorPaneId
  text: string
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

function normalizeDirection(direction: QuickEditorPaneRequest['direction']): 'right' | 'bottom' {
  return direction === 'top' || direction === 'bottom' ? 'bottom' : 'right'
}

/**
 * Summon Quick Editor: focus detached window if open, otherwise open the
 * host surface inside the global launcher (showing the launcher window).
 */
export async function showQuickEditorSurface(): Promise<void> {
  if (await isQuickEditorWindowOpen()) {
    await showQuickEditorWindow()
    return
  }
  // Already open as launcher host surface — re-show launcher so it comes forward.
  const state = useAppStore.getState()
  if (state.globalLauncherOpen && state.launcherHostSurfaceTarget === 'quick-editor') {
    if (isTauriRuntime()) {
      const { showLauncherWindow } = await import('../windowManager/launcherWindow')
      await showLauncherWindow()
    }
    return
  }
  await requestOpenLauncherHostSurface('quick-editor')
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
