import { invoke } from '@tauri-apps/api/core'
import type { ResizeDirection } from '@tauri-apps/api/window'

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

export async function startQuickEditorWindowDrag(): Promise<void> {
  if (!isTauriRuntime()) {
    console.warn('[hiven][drag] skipped: not running inside Tauri (isTauriRuntime() is false)')
    return
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  console.info('[hiven][drag] calling startDragging() on window label:', win.label)
  await win.startDragging()
  console.info('[hiven][drag] startDragging() resolved')
}

export async function startQuickEditorWindowResize(direction: ResizeDirection): Promise<void> {
  if (!isTauriRuntime()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().startResizeDragging(direction)
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
