import { useAppStore } from '../../store'
import { useQuickEditorStore } from './quickEditorStore'
import type { QuickEditorPaneId } from './quickEditorTypes'
import { isQuickEditorWindowOpen, showQuickEditorWindow } from '../windowManager/quickEditorWindow'

export const QUICK_EDITOR_CREATE_PANE_EVENT = 'hiven://quick-editor-create-pane'

export type QuickEditorPaneRequest = {
  text?: string
  language?: string
  direction?: 'left' | 'right' | 'top' | 'bottom'
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

function normalizeDirection(direction: QuickEditorPaneRequest['direction']): 'right' | 'bottom' {
  return direction === 'top' || direction === 'bottom' ? 'bottom' : 'right'
}

export async function showQuickEditorSurface(): Promise<void> {
  if (await isQuickEditorWindowOpen()) {
    await showQuickEditorWindow()
    return
  }
  useAppStore.getState().openLauncherHostSurface('quick-editor')
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
