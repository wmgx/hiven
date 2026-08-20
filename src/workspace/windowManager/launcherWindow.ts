import { invoke } from '@tauri-apps/api/core'
import { markSurfaceInstanceState, upsertSurfaceInstance } from '../../surfaces/registry'
import { LAUNCHER_WINDOW_LABEL } from './windowLabels'

export async function showLauncherWindow(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('show_launcher_window')
  upsertSurfaceInstance({
    id: LAUNCHER_WINDOW_LABEL,
    kind: 'launcher',
    windowLabel: LAUNCHER_WINDOW_LABEL,
    title: 'Hiven Launcher',
    state: 'visible',
    canReceiveText: true,
  })
}

/**
 * How hide should handle the app that was frontmost when the launcher opened.
 * - `auto` (default): restore only if focus has not already moved elsewhere
 * - `never`: blur-dismiss — user chose another frontmost app; do not steal focus
 * - `force`: always restore (prefer hide_launcher_and_paste for clipboard paste)
 */
export type RestoreForegroundMode = 'auto' | 'never' | 'force'

export async function hideLauncherWindow(options?: {
  restoreForeground?: RestoreForegroundMode
}): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('hide_launcher_window', {
    restoreForeground: options?.restoreForeground ?? 'auto',
  })
  markSurfaceInstanceState(LAUNCHER_WINDOW_LABEL, 'hidden')
}

export async function restoreLauncherInputSource(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('restore_launcher_input_source')
}

export type LauncherWindowPosition = {
  x: number
  y: number
}

export type LauncherWindowMovedPosition = {
  toLogical(scaleFactor: number): LauncherWindowPosition
}

export async function setCurrentLauncherWindowPosition(position: LauncherWindowPosition): Promise<void> {
  if (!isTauriRuntime()) return
  const { LogicalPosition } = await import('@tauri-apps/api/dpi')
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().setPosition(new LogicalPosition(position.x, position.y))
}

export async function onCurrentLauncherWindowMoved(
  onMoved: (position: LauncherWindowMovedPosition, helpers: { toLogical: (position: LauncherWindowMovedPosition) => Promise<LauncherWindowPosition> }) => void | Promise<void>,
): Promise<() => void> {
  if (!isTauriRuntime()) return () => {}
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  return win.onMoved(async ({ payload: position }) => {
    await onMoved(position as LauncherWindowMovedPosition, {
      toLogical: async (nextPosition) => nextPosition.toLogical(await win.scaleFactor()),
    })
  })
}

export async function resizeCurrentLauncherWindow(size: { width: number; height: number }): Promise<void> {
  if (!isTauriRuntime()) return
  const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window')
  await getCurrentWindow().setSize(new LogicalSize(size.width, size.height))
}

/**
 * Re-apply key window + webview first responder after the search input is
 * focused in DOM. Required on macOS non-activating launcher panels: HTML
 * focus alone often yields a caret-less "ghost" focus until the user clicks.
 */
export async function focusLauncherWebview(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('focus_launcher_webview')
}

export async function onCurrentLauncherWindowFocusChanged(
  onFocusChanged: (focused: boolean) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) return () => {}
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().onFocusChanged(({ payload: focused }) => onFocusChanged(focused))
}

export async function startCurrentLauncherWindowDrag(): Promise<void> {
  if (!isTauriRuntime()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().startDragging()
}

export async function restoreCurrentLauncherOverlayWindow(options: { hide?: boolean } = {}): Promise<void> {
  if (!isTauriRuntime()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  await win.setDecorations(true)
  if (options.hide) await win.hide()
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
