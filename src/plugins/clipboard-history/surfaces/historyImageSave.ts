import type { PluginBlobSaveResult, PluginPrivateStorageApi } from '@hiven/plugin'
import type { ClipboardHistoryRepository } from '../storage/clipboardHistoryRepository'

export type ClipboardHistoryImageSaveResult =
  | PluginBlobSaveResult
  | { status: 'interrupted' }
  | { status: 'unavailable' }

export type HistoryImageSaveSubmission = {
  isCurrent: () => boolean
  finish: () => void
}

/**
 * Prevent duplicate native dialogs and suppress stale UI completion. Invalidating
 * this lifecycle cannot retract a native file write that has already started.
 */
export function createHistoryImageSaveLifecycle() {
  let active: symbol | null = null

  return {
    begin(ownerCurrent: () => boolean): HistoryImageSaveSubmission | null {
      if (active || !ownerCurrent()) return null
      const token = Symbol('history-image-save')
      let current = true
      active = token
      return {
        isCurrent: () => {
          if (!current || active !== token) return false
          if (!ownerCurrent()) current = false
          return current
        },
        finish: () => {
          if (active === token) active = null
        },
      }
    },
    invalidate() {
      active = null
    },
  }
}

export function getClipboardHistoryImageFilename(lastCopiedAt: number): string {
  const timestamp = Number.isFinite(lastCopiedAt) ? new Date(lastCopiedAt) : new Date()
  const iso = Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString()
  return `clipboard-image-${iso.replace(/[:.]/g, '-')}.png`
}

/** Re-read the active record and export its original blob, never its preview blob. */
export async function saveClipboardHistoryImage(
  repository: ClipboardHistoryRepository,
  storage: PluginPrivateStorageApi,
  itemId: string,
  isCurrent: () => boolean,
): Promise<ClipboardHistoryImageSaveResult> {
  if (!isCurrent()) return { status: 'interrupted' }
  const item = await repository.getItem(itemId)
  if (!isCurrent()) return { status: 'interrupted' }
  if (item?.kind !== 'image' || !item.blobId) return { status: 'unavailable' }

  return storage.blob.savePng(item.blobId, {
    suggestedFilename: getClipboardHistoryImageFilename(item.lastCopiedAt),
  })
}
