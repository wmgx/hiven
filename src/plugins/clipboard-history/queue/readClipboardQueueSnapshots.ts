import type { ClipboardHistoryRepository } from '../storage/clipboardHistoryRepository'
import { CLIPBOARD_QUEUE_MAX_ITEMS, validateQueueSnapshots } from './clipboardPasteQueue'

/** Complete fresh reads in selection order; stale/deleted/edited entries reject the whole operation. */
export async function readClipboardQueueSnapshots(
  repository: Pick<ClipboardHistoryRepository, 'getItem' | 'getFreshListItems'>,
  selection: readonly { id: string; hash: string }[],
  isCurrent: () => boolean,
) {
  const requireCurrent = () => { if (!isCurrent()) throw new Error('QueueCancelledError') }
  requireCurrent()
  // Capture metadata before the first await: caller mutation cannot change the read transaction.
  const selected = selection.map(({ id, hash }) => ({ id, hash }))
  if (selected.length < 1 || selected.length > CLIPBOARD_QUEUE_MAX_ITEMS) throw new Error('QueueCountError')
  if (new Set(selected.map((item) => item.id)).size !== selected.length) throw new Error('QueueSnapshotError')
  let snapshots
  try {
    snapshots = await Promise.all(selected.map(async ({ id, hash }) => {
      const item = await repository.getItem(id)
      requireCurrent()
      if (!item || item.id !== id || item.kind !== 'text' || item.hash !== hash || typeof item.text !== 'string') {
        throw new Error('QueueReadError')
      }
      return { id, text: item.text }
    }))
  } catch {
    requireCurrent()
    throw new Error('QueueReadError')
  }
  requireCurrent()
  const validated = validateQueueSnapshots(snapshots)
  let index
  try { index = await repository.getFreshListItems() } catch { requireCurrent(); throw new Error('QueueReadError') }
  requireCurrent()
  if (selected.some(({ id, hash }) => !index.some((item) => item.id === id && item.kind === 'text' && item.hash === hash))) {
    throw new Error('QueueReadError')
  }
  return validated
}
