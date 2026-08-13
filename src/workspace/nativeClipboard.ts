/**
 * Desktop-safe clipboard reads.
 *
 * WKWebView shows a floating English "Paste" chip when JS calls
 * `navigator.clipboard.readText()` / `.read()` without a user gesture.
 * The desktop app already has `clipboard-manager` IPC, so Tauri must never
 * fall back to the web Clipboard API just because native `readText()` threw
 * (empty pasteboard, image-only content, plugin still loading).
 */

export function isTauriClipboardRuntime(): boolean {
  return Boolean((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

export async function readNativeClipboardText(): Promise<string> {
  if (isTauriClipboardRuntime()) {
    try {
      const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
      return (await readText()) ?? ''
    } catch {
      return ''
    }
  }

  try {
    return (await navigator.clipboard.readText()) ?? ''
  } catch {
    return ''
  }
}
