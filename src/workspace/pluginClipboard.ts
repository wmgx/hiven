/**
 * Plugin Clipboard API — Host Implementation
 *
 * Provides clipboard read/write and a polling-based watch mechanism.
 * Uses @tauri-apps/plugin-clipboard-manager when available, falls back to navigator.clipboard.
 */

import type { PluginClipboardApi, ClipboardChange, ClipboardWatchOptions } from './pluginTypes'

async function readClipboardText(): Promise<string> {
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

async function writeClipboardText(text: string): Promise<void> {
  try {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(text)
  } catch {
    try {
      await navigator.clipboard.writeText(text)
    } catch (error) {
      console.warn('[plugin-clipboard] write failed:', error)
    }
  }
}

function hashString(text: string): string {
  // Simple FNV-1a hash for change detection
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function createPluginClipboard(_pluginId: string): PluginClipboardApi {
  return {
    async readText(): Promise<string> {
      return readClipboardText()
    },

    async writeText(text: string): Promise<void> {
      await writeClipboardText(text)
    },

    async writeImage(_blobId: string): Promise<void> {
      // First version: stub — native image clipboard write needs Tauri plugin extension
      console.warn('[plugin-clipboard] writeImage not yet implemented')
    },

    async writeFiles(_paths: string[]): Promise<void> {
      // First version: stub — native file clipboard write needs platform-specific support
      console.warn('[plugin-clipboard] writeFiles not yet implemented')
    },

    async watch(
      options: ClipboardWatchOptions,
      onChange: (change: ClipboardChange) => void,
    ): Promise<() => void> {
      const pollInterval = options.pollIntervalMs ?? 1000
      let lastHash = ''
      let lastText = ''
      let stopped = false

      // Initialize with current clipboard content
      try {
        lastText = await readClipboardText()
        lastHash = hashString(lastText)
      } catch {
        // Ignore initialization errors
      }

      const intervalId = setInterval(async () => {
        if (stopped) return

        try {
          // Currently only text watching is implemented
          if (options.text !== false) {
            const currentText = await readClipboardText()
            if (!currentText) return

            const currentHash = hashString(currentText)
            if (currentHash === lastHash) return

            // Check size limits
            const byteSize = new TextEncoder().encode(currentText).length
            if (options.maxTextBytes && byteSize > options.maxTextBytes) return

            lastHash = currentHash
            lastText = currentText

            const change: ClipboardChange = {
              kind: 'text',
              text: currentText,
              byteSize,
              hash: currentHash,
              changedAt: Date.now(),
            }
            onChange(change)
          }
        } catch (error) {
          console.warn('[plugin-clipboard] watch poll error:', error)
        }
      }, pollInterval)

      // Return unsubscribe function
      return () => {
        stopped = true
        clearInterval(intervalId)
      }
    },
  }
}
