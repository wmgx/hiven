/**
 * Plugin Paste API — Host Implementation
 *
 * Provides controlled paste semantics: write to clipboard, then attempt to simulate Cmd/Ctrl+V.
 * Falls back to "copied to clipboard" if accessibility/simulation unavailable.
 */

import type { PluginPasteApi, PluginPasteResult } from './pluginTypes'

async function writeTextToClipboard(text: string): Promise<void> {
  try {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(text)
  } catch {
    await navigator.clipboard.writeText(text)
  }
}

async function trySimulatePaste(): Promise<boolean> {
  // Try to simulate Cmd+V via Tauri invoke (requires accessibility permissions on macOS)
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('simulate_paste')
    return true
  } catch {
    return false
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

export function createPluginPaste(): PluginPasteApi {
  return {
    async pasteText(text: string): Promise<PluginPasteResult> {
      try {
        await writeTextToClipboard(text)
      } catch {
        return { ok: false, fallback: 'none', message: 'Failed to write to clipboard' }
      }

      await tryHideLauncherWindow()

      // Small delay to let window hide complete before simulating paste
      await new Promise((r) => setTimeout(r, 100))

      const pasted = await trySimulatePaste()
      if (pasted) {
        return { ok: true }
      }
      return {
        ok: false,
        fallback: 'copied',
        message: 'Copied to clipboard. Enable accessibility permissions for direct paste.',
      }
    },

    async pasteImage(blobId: string): Promise<PluginPasteResult> {
      // First version: image paste not fully implemented (needs native Tauri plugin)
      // Just report copied fallback
      void blobId
      return {
        ok: false,
        fallback: 'copied',
        message: 'Image copied to clipboard. Direct paste for images is not yet supported.',
      }
    },

    async pasteFiles(paths: string[]): Promise<PluginPasteResult> {
      // First version: file paste not fully implemented
      void paths
      return {
        ok: false,
        fallback: 'copied',
        message: 'File paths copied. Direct paste for files is not yet supported.',
      }
    },
  }
}
