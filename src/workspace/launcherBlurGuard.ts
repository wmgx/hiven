/**
 * Standalone Global Launcher blur-dismiss guard.
 *
 * Two layers:
 * 1. Timed suppress — open companion windows (clipboard history, quick editor)
 *    steal focus for a few hundred ms; ignore blur during that handoff.
 * 2. Companion focus/visibility — while another hiven webview holds focus
 *    (or a plugin-surface window is still visible), do not dismiss the launcher.
 */

let suppressStandaloneLauncherBlurUntil = 0

export function suppressStandaloneLauncherBlur(durationMs = 600): void {
  suppressStandaloneLauncherBlurUntil = Math.max(
    suppressStandaloneLauncherBlurUntil,
    Date.now() + durationMs,
  )
}

export function shouldSuppressStandaloneLauncherBlur(): boolean {
  return Date.now() < suppressStandaloneLauncherBlurUntil
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

/**
 * True when focus (or a visible plugin-surface window) is still inside hiven,
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

      // Plugin surfaces (clipboard history, …): stay open while the surface
      // window is still on screen, even across brief focus gaps.
      if (label.startsWith('plugin-surface:')) {
        try {
          if (await webview.isVisible()) return true
        } catch {
          // ignore
        }
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
  if (shouldSuppressStandaloneLauncherBlur()) return true

  const delayMs = options?.handoffDelayMs ?? 80
  if (delayMs > 0) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, delayMs)
    })
  }

  if (shouldSuppressStandaloneLauncherBlur()) return true

  // User clicked back onto the launcher during the handoff.
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    if (await getCurrentWindow().isFocused()) return true
  } catch {
    // ignore
  }

  return isHivenCompanionWindowActive()
}
