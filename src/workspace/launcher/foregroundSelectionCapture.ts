/**
 * On-demand capture of whatever is selected in the app that was foreground
 * before Global Launcher opened. Used as a last-resort text source so a
 * matching tool can run without the user manually copying first — see
 * hide_launcher_and_capture_selection in src-tauri/src/lib.rs (mirrors the
 * existing hide_launcher_and_paste write-back path in the read direction:
 * hide the launcher, wait for OS focus to hand back to the target app,
 * simulate Cmd/Ctrl+C, then read and restore the clipboard).
 *
 * Entering a command never captures; the input step exposes an explicit read action.
 */

import { t, type Locale } from '../../i18n'
import { isNativeDesktopRuntime } from '../webNativeBridge'
import type { PluginLauncherApi } from './types'

type CaptureInvokeResult = { text: string; error?: string }
export type SelectionCaptureAvailability = 'can-attempt' | 'unsupported' | 'unknown'
const SELECTION_CAPTURE_UNSUPPORTED = 'SELECTION_CAPTURE_UNSUPPORTED'

/** Match the native capture capability, independently of direct-paste support. */
export async function readSelectionCaptureAvailability(): Promise<SelectionCaptureAvailability> {
  if (typeof window === 'undefined' || !isNativeDesktopRuntime()) return 'unsupported'
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      import('@tauri-apps/api/core').then(async ({ invoke }): Promise<SelectionCaptureAvailability> => {
        const availability = await invoke<unknown>('get_selection_capture_availability')
        return availability === 'can-attempt' || availability === 'unsupported' ? availability : 'unknown'
      }),
      new Promise<SelectionCaptureAvailability>((resolve) => {
        timeout = setTimeout(() => resolve('unknown'), 300)
      }),
    ])
  } catch {
    return 'unknown'
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

async function invokeCapture(): Promise<CaptureInvokeResult> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const text = await invoke<string | null>('hide_launcher_and_capture_selection')
    return { text: text?.trim() ?? '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[launcher] foreground selection capture failed:', error)
    return { text: '', error: message }
  }
}

async function restoreLauncherWindow(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('show_launcher_window', { resume: true })
  } catch (error) {
    console.warn('[launcher] failed to restore launcher after capture:', error)
  }
}

function captureFailureMessageKey(error: string): string {
  if (error === SELECTION_CAPTURE_UNSUPPORTED) return 'workspace.captureSelection.unsupported'
  return error.includes('Accessibility permission')
    ? 'workspace.captureSelection.accessibilityRequired'
    : 'workspace.captureSelection.failed'
}

/**
 * Attempt the capture. The native command hides the launcher window as part
 * of running (it needs the target app to hold real OS focus) — on failure
 * this re-shows it unless native rejected unsupported capture before hiding.
 * Unsupported/unknown hosts fail preflight without altering focus or clipboard.
 *
 * Input import restores the same window without starting a new launcher session.
 * Direct tool execution can leave it hidden for the following output action.
 */
export async function captureForegroundSelectionText(
  api: PluginLauncherApi,
  locale: Locale,
  options: { restoreLauncher?: boolean } = {},
): Promise<string | undefined> {
  const availability = await readSelectionCaptureAvailability()
  if (availability !== 'can-attempt') {
    api.showMessage(t(locale, availability === 'unsupported'
      ? 'workspace.captureSelection.unsupported'
      : 'workspace.captureSelection.unavailable'), 'warning')
    return undefined
  }
  const { text, error } = await invokeCapture()
  if (error !== SELECTION_CAPTURE_UNSUPPORTED && (!text || options.restoreLauncher)) await restoreLauncherWindow()
  if (text) return text
  if (error) api.showMessage(t(locale, captureFailureMessageKey(error)), 'warning')
  return undefined
}
