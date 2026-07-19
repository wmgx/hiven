/**
 * Read clipboard for the launcher context.
 * Prefer real file paths when the user copied a file in Finder / file manager:
 * plain-text flavor is often only the bare filename and would be mis-detected as "text".
 */

export async function readLauncherClipboard(): Promise<string> {
  // 1) Native file list (macOS NSFilenamesPboardType / public.file-url)
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const paths = await invoke<string[]>('read_clipboard_file_paths')
    if (Array.isArray(paths) && paths.length > 0) {
      const first = paths[0]?.trim()
      if (first) return first
    }
  } catch {
    // Not in Tauri, or command unavailable
  }

  // 2) Plain text
  try {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
    return (await readText()) ?? ''
  } catch {
    try {
      return await navigator.clipboard.readText()
    } catch {
      return ''
    }
  }
}
