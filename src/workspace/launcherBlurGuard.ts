/**
 * Standalone Global Launcher blur-dismiss guard.
 *
 * Two layers:
 * 1. Timed suppress — open companion windows (clipboard history, quick editor)
 *    steal focus for a few hundred ms; ignore blur during that handoff.
 * 2. Companion focus — while another hiven webview holds focus, do not dismiss
 *    the launcher. A visible but unfocused tool must not prevent dismissal.
 */

let suppressStandaloneLauncherBlurUntil = 0

const nativeDialogLeases = new Set<symbol>()
const nativeDialogLeaseListeners = new Set<() => void>()

/** A native dialog owns focus for its actual lifetime, including slow user selection. */
export const launcherNativeDialogFocus = {
  isActive: () => nativeDialogLeases.size > 0,
  subscribe: (listener: () => void) => {
    nativeDialogLeaseListeners.add(listener)
    return () => { nativeDialogLeaseListeners.delete(listener) }
  },
}

export function acquireLauncherNativeDialogFocus(): () => void {
  const lease = Symbol('native-dialog')
  nativeDialogLeases.add(lease)
  for (const listener of nativeDialogLeaseListeners) listener()
  return () => {
    if (!nativeDialogLeases.delete(lease)) return
    for (const listener of nativeDialogLeaseListeners) listener()
  }
}

export function suppressStandaloneLauncherBlur(durationMs = 600): void {
  suppressStandaloneLauncherBlurUntil = Math.max(
    suppressStandaloneLauncherBlurUntil,
    Date.now() + durationMs,
  )
}

export function shouldSuppressStandaloneLauncherBlur(): boolean {
  return Date.now() < suppressStandaloneLauncherBlurUntil
}

/**
 * DevTools/Web Inspector opens as its own native panel outside Tauri's
 * webview-window registry, so it is invisible to `isHivenCompanionWindowActive`
 * — the native focus-changed listener sees a plain blur and closes the
 * launcher out from under the user the moment they open the console.
 * Not a timed suppress: devtools can hold focus indefinitely, and clearing it
 * on the first regained-focus tick races with clicking back into the search
 * input to keep typing (devtools can re-steal focus for a beat right after —
 * that follow-up blur would no longer be suppressed and would close the
 * launcher mid-keystroke). Instead this stays on for the rest of the current
 * launcher open and is only reset when a fresh open starts (see
 * `useCloseStandaloneLauncherOnBlur`).
 */
let devtoolsBlurSuppressActive = false

export function suppressStandaloneLauncherBlurForDevtools(): void {
  devtoolsBlurSuppressActive = true
}

export function clearStandaloneLauncherBlurDevtoolsSuppress(): void {
  devtoolsBlurSuppressActive = false
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

/**
 * True when focus is still inside a companion hiven window,
 * so launcher blur should not mean "user left for another app".
 */
export async function isHivenCompanionWindowActive(): Promise<boolean> {
  if (!isTauriRuntime()) return false
  try {
    const { getAllWebviewWindows } = await import('@tauri-apps/api/webviewWindow')
    const windows = await getAllWebviewWindows()
    for (const webview of windows) {
      const label = webview.label
      // Own launcher / main shell — not a "companion" for keep-open.
      if (label === 'launcher' || label === 'main') continue

      try {
        if (await webview.isFocused()) return true
      } catch {
        // ignore per-window errors
      }
    }
  } catch {
    return false
  }
  return false
}

/**
 * Debounced companion check used by blur-dismiss.
 * Returns true = keep launcher open.
 */
export async function shouldKeepLauncherOpenOnBlur(
  options?: { handoffDelayMs?: number },
): Promise<boolean> {
  if (launcherNativeDialogFocus.isActive()) return true
  if (devtoolsBlurSuppressActive) return true
  if (shouldSuppressStandaloneLauncherBlur()) return true

  const delayMs = options?.handoffDelayMs ?? 80
  if (delayMs > 0) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, delayMs)
    })
  }

  if (shouldSuppressStandaloneLauncherBlur() || launcherNativeDialogFocus.isActive()) return true

  // User clicked back onto the launcher during the handoff.
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    if (await getCurrentWindow().isFocused()) return true
  } catch {
    // ignore
  }

  return isHivenCompanionWindowActive()
}
