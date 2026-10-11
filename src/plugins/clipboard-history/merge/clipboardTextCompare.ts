import type { ClipboardHistoryRepository } from '../storage/clipboardHistoryRepository'

const MAX_BYTES = 1024 * 1024
/** Fresh full reads only; list previews and old merge previews are never inputs. */
export async function readHistoryCompareSnapshots(
  repository: Pick<ClipboardHistoryRepository, 'getItem' | 'getFreshListItems'>,
  selection: readonly { id: string; hash: string; title: string }[],
  isCurrent: () => boolean,
) {
  const requireCurrent = () => { if (!isCurrent()) throw new Error('AbortError') }
  requireCurrent()
  if (selection.length !== 2 || selection[0].id === selection[1].id) throw new Error('InvalidSnapshotError')
  const loaded = await Promise.all(selection.map(async (selected) => {
    const item = await repository.getItem(selected.id)
    requireCurrent()
    if (!item || item.kind !== 'text' || item.id !== selected.id || item.hash !== selected.hash || typeof item.text !== 'string') {
      throw new Error('ReadFailedError')
    }
    return Object.freeze({ id: item.id, title: selected.title, text: item.text })
  }))
  requireCurrent()
  let bytes = 0
  for (const item of loaded) {
    if (item.text.length > MAX_BYTES) throw new Error('TextTooLargeError')
    bytes += new TextEncoder().encode(item.text).byteLength
    if (bytes > MAX_BYTES) throw new Error('TextTooLargeError')
  }
  // A deletion/change while full reads were pending must not revive an old item.
  const index = await repository.getFreshListItems(selection.map((item) => item.id))
  requireCurrent()
  if (selection.some((selected) => !index.some((item) => item.id === selected.id && item.kind === 'text' && item.hash === selected.hash))) {
    throw new Error('ReadFailedError')
  }
  return Object.freeze(loaded)
}
