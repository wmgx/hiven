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
      const repository = createClipboardHistoryRepository(ctx.storage)
      const watchOptions = buildWatchOptions(ctx.settings)

      let unwatch: (() => void) | null = null
      const lifecycle = new AbortController()
      let cleaning = false
      const cleanup = async () => {
        if (cleaning || lifecycle.signal.aborted) return
        cleaning = true
        try {
          // Bounded catch-up on startup/resume and once per minute, independent
          // of new clipboard changes or recording being enabled.
          for (let batch = 0; batch < 8 && !lifecycle.signal.aborted; batch++) {
            const pruned = await repository.pruneItems({ retentionMonths: ctx.settings.retentionMonths }, { signal: lifecycle.signal })
            await repository.purgeExpiredTrash({ signal: lifecycle.signal })
            if (!pruned.hasMore) break
          }
        } catch {
          if (!lifecycle.signal.aborted) ctx.showMessage(ctx.t('error.retentionCleanup'), 'error')
        } finally { cleaning = false }
      }
      void cleanup()
      const cleanupTimer = setInterval(() => { void cleanup() }, 60_000)
      const onResume = () => { void cleanup() }
      if (typeof window !== 'undefined') window.addEventListener('focus', onResume)

      try {
        if (ctx.settings.enabled) unwatch = await ctx.clipboard.watch(watchOptions, async (change: ClipboardChange) => {
          try {
            // Filter based on settings
            if (change.kind === 'text' && !ctx.settings.recordText) return
            if (change.kind === 'image' && !ctx.settings.recordImages) return
            if (change.kind === 'files' && !ctx.settings.recordFiles) return

            const input = buildAddItemInput(change)
            if (!input) return

            await repository.addItem(input)

            void cleanup()
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            ctx.showMessage(ctx.t('error.background', { message }), 'error')
          }
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.showMessage(ctx.t('error.watcherStart', { message }), 'error')
      }

      // Return stop function for cleanup
      const stop: PluginBackgroundStop = () => {
        lifecycle.abort()
        clearInterval(cleanupTimer)
        if (typeof window !== 'undefined') window.removeEventListener('focus', onResume)
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
