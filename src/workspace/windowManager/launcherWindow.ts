import { invoke } from '@tauri-apps/api/core'
import { markSurfaceInstanceState, upsertSurfaceInstance } from '../../surfaces/registry'
import { LAUNCHER_PROGRAMMATIC_MOVE_EVENT } from '../launcherWindowEvents'
import { LAUNCHER_WINDOW_LABEL } from './windowLabels'
import { isNativeDesktopRuntime } from '../webNativeBridge'

export async function showLauncherWindow(): Promise<void> {
  if (!isNativeDesktopRuntime()) return
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
  invalidateCurrentLauncherWindowResize()
  if (!isNativeDesktopRuntime()) return
  await invoke('hide_launcher_window', {
    restoreForeground: options?.restoreForeground ?? 'auto',
  })
  markSurfaceInstanceState(LAUNCHER_WINDOW_LABEL, 'hidden')
}

export async function restoreLauncherInputSource(): Promise<void> {
  if (!isNativeDesktopRuntime()) return
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
  if (!isNativeDesktopRuntime()) return
  const { LogicalPosition } = await import('@tauri-apps/api/dpi')
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().setPosition(new LogicalPosition(position.x, position.y))
}

export async function onCurrentLauncherWindowMoved(
  onMoved: (position: LauncherWindowMovedPosition, helpers: { toLogical: (position: LauncherWindowMovedPosition) => Promise<LauncherWindowPosition> }) => void | Promise<void>,
): Promise<() => void> {
  if (!isNativeDesktopRuntime()) return () => {}
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  return win.onMoved(async ({ payload: position }) => {
    await onMoved(position as LauncherWindowMovedPosition, {
      toLogical: async (nextPosition) => nextPosition.toLogical(await win.scaleFactor()),
    })
  })
}

let latestLauncherResize = 0
let latestLauncherConfiguration = 0
let lastLauncherNativeRevision = 0

export type LauncherWindowConfiguration = {
  resizable: boolean
  /** Search/controller frames use the native monitor's normal launcher width. */
  compactWidth?: boolean
  minWidth?: number
  minHeight?: number
}

/** Revoke pending geometry work immediately on surface change or dismissal. */
export function invalidateCurrentLauncherWindowResize(): void {
  latestLauncherResize += 1
  latestLauncherConfiguration += 1
}

export async function configureCurrentLauncherWindow(
  configuration: LauncherWindowConfiguration & { width?: number; height?: number },
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  for (const dimension of [configuration.width, configuration.height, configuration.minWidth, configuration.minHeight]) {
    if (dimension !== undefined && (!Number.isFinite(dimension) || dimension <= 0)) {
      throw new RangeError('Launcher window dimensions must be finite and positive')
    }
  }
  if (configuration.compactWidth && (configuration.resizable || configuration.height === undefined)) {
    throw new RangeError('Compact launcher sizing requires a fixed window and explicit height')
  }
  if (configuration.compactWidth && configuration.width !== undefined) {
    throw new RangeError('Compact launcher sizing cannot also specify a width')
  }
  if (!configuration.compactWidth && (configuration.width === undefined) !== (configuration.height === undefined)) {
    throw new RangeError('Launcher window width and height must be supplied together')
  }
  if (!isNativeDesktopRuntime()) return false
  const revision = ++latestLauncherConfiguration
  const session = await invoke<{ session: number; revision: number }>('get_launcher_window_resize_session')
  if (revision !== latestLauncherConfiguration || !isCurrent()) return false
  lastLauncherNativeRevision = Math.max(lastLauncherNativeRevision, session.revision) + 1
  // The private native command validates the caller, session and revision again
  // on its main thread, including requests racing a native close/reopen.
  window.dispatchEvent(new CustomEvent(LAUNCHER_PROGRAMMATIC_MOVE_EVENT))
  return invoke<boolean>('configure_launcher_window', {
    request: { ...configuration, session: session.session, revision: lastLauncherNativeRevision },
  })
}

export async function resizeCurrentLauncherWindow(size: { width: number; height: number }): Promise<void> {
  if (!Number.isFinite(size.width) || size.width <= 0 || !Number.isFinite(size.height) || size.height <= 0) {
    throw new RangeError('Launcher window dimensions must be finite and positive')
  }
  if (!isNativeDesktopRuntime()) return
  const resize = ++latestLauncherResize
  const { getCurrentWindow, LogicalPosition, LogicalSize } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  const scaleFactor = await win.scaleFactor()
  const [physicalPosition, physicalSize] = await Promise.all([win.outerPosition(), win.outerSize()])
  if (resize !== latestLauncherResize) return

  const position = physicalPosition.toLogical(scaleFactor)
  const currentSize = physicalSize.toLogical(scaleFactor)
  const sameWidth = Math.abs(currentSize.width - size.width) < 0.5
  if (sameWidth && Math.abs(currentSize.height - size.height) < 0.5) return

  window.dispatchEvent(new CustomEvent(LAUNCHER_PROGRAMMATIC_MOVE_EVENT))
  await win.setSize(new LogicalSize(size.width, size.height))
  if (sameWidth || resize !== latestLauncherResize) return
  await win.setPosition(new LogicalPosition(position.x + (currentSize.width - size.width) / 2, position.y))
}

/**
 * Re-apply key window + webview first responder after the search input is
 * focused in DOM. Required on macOS non-activating launcher panels: HTML
 * focus alone often yields a caret-less "ghost" focus until the user clicks.
 */
export async function focusLauncherWebview(): Promise<void> {
  if (!isNativeDesktopRuntime()) return
  await invoke('focus_launcher_webview')
}

export async function onCurrentLauncherWindowFocusChanged(
  onFocusChanged: (focused: boolean) => void,
): Promise<() => void> {
  if (!isNativeDesktopRuntime()) return () => {}
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().onFocusChanged(({ payload: focused }) => onFocusChanged(focused))
}

export async function startCurrentLauncherWindowDrag(): Promise<void> {
  if (!isNativeDesktopRuntime()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().startDragging()
}

export type LauncherWindowResizeDirection = 'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest'

export async function startCurrentLauncherWindowResize(direction: LauncherWindowResizeDirection): Promise<void> {
  if (!isNativeDesktopRuntime()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  if (win.label !== LAUNCHER_WINDOW_LABEL) return
  await win.startResizeDragging(direction)
}

export async function restoreCurrentLauncherOverlayWindow(options: { hide?: boolean } = {}): Promise<void> {
  if (!isNativeDesktopRuntime()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  await win.setDecorations(true)
  if (options.hide) await win.hide()
}
