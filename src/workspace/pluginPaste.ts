/**
 * Plugin Paste API — Host Implementation
 *
 * Provides controlled paste semantics: write to clipboard, then attempt to simulate Cmd/Ctrl+V.
 * Falls back to "copied to clipboard" if accessibility/simulation unavailable.
 */

import type { PluginPasteApi, PluginPasteResult, PluginPermission, PluginPermissionSnapshot, PluginPrivateStorageApi } from './pluginTypes'
import { requirePluginPermissions } from './pluginPermissions'

async function writeTextToClipboard(text: string): Promise<void> {
  try {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(text)
  } catch {
    await navigator.clipboard.writeText(text)
  }
}

async function writeImageToClipboard(bytes: Uint8Array): Promise<void> {
  try {
    const { writeImage } = await import('@tauri-apps/plugin-clipboard-manager')
    try {
      const { Image } = await import('@tauri-apps/api/image')
      const image = await Image.fromBytes(bytes)
      await writeImage(image)
    } catch {
      await writeImage(bytes)
    }
    return
  } catch {
    // Fall through to browser ClipboardItem support.
  }

  const ClipboardItemCtor = globalThis.ClipboardItem
  if (!navigator.clipboard?.write || !ClipboardItemCtor) {
    throw new Error('Image clipboard write is not supported in this environment')
  }
  const blob = new Blob([bytes], { type: 'image/png' })
  await navigator.clipboard.write([new ClipboardItemCtor({ [blob.type]: blob })])
}

async function trySimulatePaste(): Promise<{ ok: boolean; permissionDenied?: boolean }> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('simulate_paste')
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, permissionDenied: msg.includes('Accessibility permission') }
  }
}

async function tryHideLauncherWindow(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('hide_launcher_window')
  } catch {
    // Not in standalone launcher mode, or command doesn't exist
  }
}

async function pasteAfterClipboardWrite(fallbackMessage: string): Promise<PluginPasteResult> {
  // Paste before hiding: the launcher is a non-activating panel so the previous app stays
  // frontmost the entire time. Sending Cmd+V while the launcher is still visible guarantees
  // the event goes to the correct target app — no focus-transition race condition.
  const result = await trySimulatePaste()
  void tryHideLauncherWindow()
  if (result.ok) {
    return { ok: true }
  }
  const message = result.permissionDenied
    ? 'Copied to clipboard. Grant Accessibility access in System Settings → Privacy & Security → Accessibility to enable auto-paste.'
    : fallbackMessage
  return { ok: false, fallback: 'copied', message }
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
        await writeImageToClipboard(bytes)
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
