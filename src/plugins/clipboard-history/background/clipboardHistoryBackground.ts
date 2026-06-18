/**
 * Clipboard History Plugin — Background Lifecycle
 *
 * Starts clipboard watching when settings.enabled is true.
 * Handles text/image/files based on settings toggles.
 * Persists items to plugin storage via repository.
 * Returns a stop function for cleanup.
 */

import type {
  PluginBackgroundContribution,
  PluginBackgroundContext,
  PluginBackgroundStop,
  ClipboardChange,
  ClipboardWatchOptions,
} from '@hiven/plugin'
import type { ClipboardHistorySettings } from '../settings/model'
import { createClipboardHistoryRepository } from '../storage/clipboardHistoryRepository'
import type { AddItemInput } from '../storage/clipboardHistoryTypes'

function buildWatchOptions(settings: ClipboardHistorySettings): ClipboardWatchOptions {
  return {
    text: settings.recordText,
    images: settings.recordImages,
    files: settings.recordFiles,
    maxTextBytes: settings.maxTextBytes,
    maxImageBytes: settings.maxImageBytes,
  }
}

function buildAddItemInput(change: ClipboardChange): AddItemInput | null {
  switch (change.kind) {
    case 'text':
      if (!change.text.trim()) return null
      return {
        kind: 'text',
        text: change.text,
        byteSize: change.byteSize,
        hash: change.hash,
        sourceApp: change.sourceApp,
      }
    case 'image':
      return {
        kind: 'image',
        blobId: change.blobId,
        previewBlobId: change.previewBlobId,
        contentType: change.contentType,
        byteSize: change.byteSize,
        width: change.width,
        height: change.height,
        hash: change.hash,
        sourceApp: change.sourceApp,
      }
    case 'files':
      if (change.paths.length === 0) return null
      return {
        kind: 'files',
        paths: change.paths,
        fileNames: change.fileNames,
        byteSize: change.paths.join('\n').length,
        hash: change.hash,
        sourceApp: change.sourceApp,
      }
    default:
      return null
  }
}

export function createClipboardHistoryBackground(): PluginBackgroundContribution<ClipboardHistorySettings> {
  return {
    async start(ctx: PluginBackgroundContext<ClipboardHistorySettings>): Promise<PluginBackgroundStop | void> {
      // Only start if enabled
      if (!ctx.settings.enabled) {
        return
      }

      const repository = createClipboardHistoryRepository(ctx.storage)
      const watchOptions = buildWatchOptions(ctx.settings)

      // Warm the in-memory index cache so Surface opens instantly
      void repository.getListItems()

      let unwatch: (() => void) | null = null

      try {
        unwatch = await ctx.clipboard.watch(watchOptions, async (change: ClipboardChange) => {
          try {
            // Filter based on settings
            if (change.kind === 'text' && !ctx.settings.recordText) return
            if (change.kind === 'image' && !ctx.settings.recordImages) return
            if (change.kind === 'files' && !ctx.settings.recordFiles) return

            const input = buildAddItemInput(change)
            if (!input) return

            await repository.addItem(input)

            // Prune after each addition
            await repository.pruneItems({
              maxItems: ctx.settings.maxItems,
              retentionDays: ctx.settings.retentionDays,
              maxTotalCacheBytes: ctx.settings.maxTotalCacheBytes,
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            ctx.showMessage(`Clipboard history error: ${message}`, 'error')
          }
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.showMessage(`Failed to start clipboard watcher: ${message}`, 'error')
        return
      }

      // Return stop function for cleanup
      const stop: PluginBackgroundStop = () => {
        if (unwatch) {
          unwatch()
          unwatch = null
        }
      }

      return stop
    },
  }
}

export const clipboardHistoryBackground = createClipboardHistoryBackground()
