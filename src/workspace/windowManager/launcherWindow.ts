import { invoke } from '@tauri-apps/api/core'
import { markSurfaceInstanceState, upsertSurfaceInstance } from '../../surfaces/registry'

export async function showLauncherWindow(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('show_launcher_window')
  upsertSurfaceInstance({
    id: 'launcher',
    kind: 'launcher',
    windowLabel: 'launcher',
    title: 'Hiven Launcher',
    state: 'visible',
    canReceiveText: true,
  })
}

export async function hideLauncherWindow(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('hide_launcher_window')
  markSurfaceInstanceState('launcher', 'hidden')
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

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
