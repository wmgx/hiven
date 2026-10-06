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
import type { PluginLauncherApi } from './types'

type CaptureInvokeResult = { text: string; error?: string }

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
  return error.includes('Accessibility permission')
    ? 'workspace.captureSelection.accessibilityRequired'
    : 'workspace.captureSelection.failed'
}

/**
 * Attempt the capture. The native command hides the launcher window as part
 * of running (it needs the target app to hold real OS focus) — on failure
 * this always re-shows it, so callers only need to decide what UI state to
 * land on next (e.g. fall through to a manual text prompt).
 *
 * Input import restores the same window without starting a new launcher session.
 * Direct tool execution can leave it hidden for the following output action.
 */
export async function captureForegroundSelectionText(
  api: PluginLauncherApi,
  locale: Locale,
  options: { restoreLauncher?: boolean } = {},
): Promise<string | undefined> {
  const { text, error } = await invokeCapture()
  if (!text || options.restoreLauncher) await restoreLauncherWindow()
  if (text) return text
  if (error) api.showMessage(t(locale, captureFailureMessageKey(error)), 'warning')
  return undefined
}
