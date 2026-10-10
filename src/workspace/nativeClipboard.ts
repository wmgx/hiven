/**
 * Desktop-safe clipboard reads.
 *
 * WKWebView shows a floating English "Paste" chip when JS calls
 * `navigator.clipboard.readText()` / `.read()` without a user gesture.
 * Native IPC skips concealed/transient content before returning any text.
 * Never fall back to a web read on native failure: that could expose secrets
 * or show a WebKit permission chip during background polling.
 */

export function isTauriClipboardRuntime(): boolean {
  return Boolean((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

// Native commands serialize macOS pasteboard access with WebKit on the main thread.
export async function writeText(text: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return
  const { invoke } = await import('@tauri-apps/api/core')
  if (signal?.aborted) return
  await invoke('clipboard_write_text', { text })
}

export async function readImage(): Promise<import('@tauri-apps/api/image').Image> {
  const { invoke } = await import('@tauri-apps/api/core')
  const { Image } = await import('@tauri-apps/api/image')
  return new Image(await invoke<number>('clipboard_read_image'))
}

export async function writeImage(image: import('@tauri-apps/api/image').Image, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return
  const { invoke } = await import('@tauri-apps/api/core')
  if (signal?.aborted) return
  await invoke('clipboard_write_image', { image: image.rid })
}

export async function readNativeClipboardText(): Promise<string> {
  if (isTauriClipboardRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      return (await invoke<string>('clipboard_read_public_text')) ?? ''
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
