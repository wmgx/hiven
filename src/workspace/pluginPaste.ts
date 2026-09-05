/**
 * Plugin Paste API — Host Implementation
 *
 * Provides controlled paste semantics: write to clipboard, then attempt to simulate Cmd/Ctrl+V.
 * Falls back to "copied to clipboard" if accessibility/simulation unavailable.
 */

import type { PluginPasteApi, PluginPasteResult, PluginPermission, PluginPermissionSnapshot, PluginPrivateStorageApi } from './pluginTypes'
import { requirePluginPermissions } from './pluginPermissions'
import { writeClipboardImageBytes } from './pluginClipboard'
import { t } from '../i18n'
import { useAppStore } from '../store'

const pasteMessage = (key: string) => t(useAppStore.getState().locale, `workspace.${key}`)

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
      ? pasteMessage('paste.accessibilityRequired')
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
        return { ok: false, fallback: 'none', message: pasteMessage('paste.clipboardWriteFailed') }
      }

      return pasteAfterClipboardWrite(pasteMessage('paste.copied'))
    },

    async pasteImage(blobId: string): Promise<PluginPasteResult> {
      requirePermissions(['clipboard.write', 'clipboard.image', 'storage.blob', 'accessibility.paste'])
      if (!storage) {
        return { ok: false, fallback: 'none', message: pasteMessage('paste.imageStorageRequired') }
      }
      const bytes = await storage.blob.get(blobId)
      if (!bytes) {
        return { ok: false, fallback: 'none', message: pasteMessage('paste.imageUnavailable') }
      }
      try {
        await writeClipboardImageBytes(bytes)
      } catch {
        return { ok: false, fallback: 'none', message: pasteMessage('paste.imageWriteFailed') }
      }

      return pasteAfterClipboardWrite(pasteMessage('paste.imageCopied'))
    },

    async pasteFiles(paths: string[]): Promise<PluginPasteResult> {
      requirePermissions(['clipboard.write', 'clipboard.files', 'accessibility.paste'])
      try {
        await writeTextToClipboard(paths.join('\n'))
      } catch {
        return { ok: false, fallback: 'none', message: pasteMessage('paste.filesWriteFailed') }
      }

      return pasteAfterClipboardWrite(pasteMessage('paste.filesCopied'))
    },
  }
}
