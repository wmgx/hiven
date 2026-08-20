/**
 * Plugin Paste API — Host Implementation
 *
 * Provides controlled paste semantics: write to clipboard, then attempt to simulate Cmd/Ctrl+V.
 * Falls back to "copied to clipboard" if accessibility/simulation unavailable.
 */

import type { PluginPasteApi, PluginPasteResult, PluginPermission, PluginPermissionSnapshot, PluginPrivateStorageApi } from './pluginTypes'
import { requirePluginPermissions } from './pluginPermissions'
import { writeClipboardImageBytes } from './pluginClipboard'

async function writeTextToClipboard(text: string): Promise<void> {
  try {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(text)
  } catch {
    await navigator.clipboard.writeText(text)
  }
}

// The hide-then-paste sequence must run as a single native command rather than
// hide + JS delay + simulate: once the launcher WebView is hidden, macOS throttles
// its JS timers, so a JS-side setTimeout between hide and simulate is unreliable
// (see history: a hidden WKWebView may throttle JS execution). Doing the wait for
// foreground focus handoff and the Cmd/Ctrl+V simulation natively in Rust avoids that.
async function pasteAfterClipboardWrite(fallbackMessage: string): Promise<PluginPasteResult> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('hide_launcher_and_paste')
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const message = msg.includes('Accessibility permission')
      ? 'Copied to clipboard. Grant Accessibility access in System Settings → Privacy & Security → Accessibility to enable auto-paste.'
      : fallbackMessage
    return { ok: false, fallback: 'copied', message }
  }
}

export function createPluginPaste(
  permissions?: PluginPermissionSnapshot,
  storage?: PluginPrivateStorageApi,
): PluginPasteApi {
  const requirePermissions = (required: PluginPermission[]) => {
    if (permissions) requirePluginPermissions(permissions, required)
  }

  return {
    async pasteText(text: string): Promise<PluginPasteResult> {
      requirePermissions(['clipboard.write', 'accessibility.paste'])
      try {
        await writeTextToClipboard(text)
      } catch {
        return { ok: false, fallback: 'none', message: 'Failed to write to clipboard' }
      }

      return pasteAfterClipboardWrite('Copied to clipboard. Enable accessibility permissions for direct paste.')
    },

    async pasteImage(blobId: string): Promise<PluginPasteResult> {
      requirePermissions(['clipboard.write', 'clipboard.image', 'storage.blob', 'accessibility.paste'])
      if (!storage) {
        return { ok: false, fallback: 'none', message: 'Image paste requires plugin blob storage' }
      }
      const bytes = await storage.blob.get(blobId)
      if (!bytes) {
        return { ok: false, fallback: 'none', message: 'Image blob is no longer available' }
      }
      try {
        await writeClipboardImageBytes(bytes)
      } catch {
        return { ok: false, fallback: 'none', message: 'Failed to write image to clipboard' }
      }

      return pasteAfterClipboardWrite('Image copied to clipboard. Enable accessibility permissions for direct paste.')
    },

    async pasteFiles(paths: string[]): Promise<PluginPasteResult> {
      requirePermissions(['clipboard.write', 'clipboard.files', 'accessibility.paste'])
      try {
        await writeTextToClipboard(paths.join('\n'))
      } catch {
        return { ok: false, fallback: 'none', message: 'Failed to write file paths to clipboard' }
      }

      return pasteAfterClipboardWrite('File paths copied to clipboard. Enable accessibility permissions for direct paste.')
    },
  }
}
