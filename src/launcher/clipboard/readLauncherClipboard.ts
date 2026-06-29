/**
 * Read clipboard text for the launcher context.
 * Uses Tauri clipboard plugin when available, falls back to navigator.clipboard.
 */
export async function readLauncherClipboard(): Promise<string> {
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
