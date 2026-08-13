/**
 * Read clipboard for the launcher context.
 *
 * Ordering matters for latency: both native clipboard reads are synchronous Tauri
 * commands that run on the *main thread*, and telemetry showed `read_clipboard_file_paths`
 * costing 2–4s per open while returning `count:0` every time (the common case is
 * copied text, not a Finder file). So read plain text first (one IPC), and only pay
 * the extra file-path IPC when the text is empty or actually looks like a bare
 * filename / path — the exact case where the text flavor is ambiguous and the real
 * Finder path is worth resolving. `detectClipboardFilePath` already recognizes that
 * shape from text, so no detection is lost.
 *
 * Each await is timed under `clipboard-read:<step>` so a single repro pinpoints cost.
 */

import { detectClipboardFilePath } from './clipboardSnapshot'
import { launcherPerfNow, logLauncherPerfDuration } from '../../workspace/launcher/perf'
import { readNativeClipboardText } from '../../workspace/nativeClipboard'

async function readClipboardFilePath(): Promise<string | null> {
  try {
    const t0 = launcherPerfNow()
    const { invoke } = await import('@tauri-apps/api/core')
    const paths = await invoke<string[]>('read_clipboard_file_paths')
    logLauncherPerfDuration('clipboard-read:invoke-file-paths', t0, {
      kind: 'perf',
      count: Array.isArray(paths) ? paths.length : 0,
    })
    if (Array.isArray(paths) && paths.length > 0) {
      const first = paths[0]?.trim()
      if (first) return first
    }
  } catch {
    // Not in Tauri, or command unavailable.
  }
  return null
}

export async function readLauncherClipboard(): Promise<string> {
  // 1) Plain text — the common case, single main-thread IPC.
  // Never fall back to navigator.clipboard.readText() here: in WKWebView that
  // pops a native English "Paste" chip on the focused search field.
  const t1 = launcherPerfNow()
  const text = await readNativeClipboardText()
  logLauncherPerfDuration('clipboard-read:read-text', t1, { kind: 'perf', textLength: text.length })

  // 2) Only resolve the real Finder file path when the text is empty or looks like
  //    a bare filename / path. Skips the 2–4s file-path IPC for ordinary text/URLs.
  if (!text || detectClipboardFilePath(text)) {
    const filePath = await readClipboardFilePath()
    if (filePath) return filePath
  }

  return text
}
