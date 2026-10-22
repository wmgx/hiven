/**
 * Clipboard text as last seen by the background age tracker.
 *
 * Native clipboard reads run on the main thread and queue behind window show /
 * resize when the launcher opens (telemetry: 150ms–3s). The tracker polls while
 * the launcher is hidden, so its copy lets the open path decide on the first frame.
 */

import { readNativeClipboardText } from '../../workspace/nativeClipboard'

let lastChangeCount: number | null = null
let lastText = ''
let lastReadAt: number | undefined

/** Tracker reader: the pasteboard changeCount is a cheap probe; only re-read text when it moved. */
export async function readClipboardTextForAgeTracker(): Promise<string> {
  let count: number | null = null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const value = await invoke<number | null>('clipboard_change_count')
    count = typeof value === 'number' ? value : null
  } catch {
    count = null
  }
  if (count === null || count !== lastChangeCount) {
    lastText = await readNativeClipboardText()
    lastChangeCount = count
  }
  lastReadAt = Date.now()
  return lastText
}

/** Cached text when the tracker confirmed it within `maxAgeMs`; otherwise null. */
export function peekTrackedClipboardText(maxAgeMs: number, now: number = Date.now()): string | null {
  if (lastReadAt === undefined || now - lastReadAt > maxAgeMs) return null
  return lastText || null
}
