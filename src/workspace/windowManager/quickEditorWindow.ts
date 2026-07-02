import { invoke } from '@tauri-apps/api/core'

export const QUICK_EDITOR_WINDOW_LABEL = 'quick-editor'

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

export async function showQuickEditorWindow(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('show_quick_editor_window')
}

export async function closeQuickEditorWindow(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('close_quick_editor_window')
}

export function isQuickEditorDetachedWindow(): boolean {
  return new URLSearchParams(window.location.search).get('window') === 'quick-editor'
}

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
