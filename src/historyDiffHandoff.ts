import type { DiffSourcePayload } from './workspace/diffTypes'

/** Only the bundled History may send two immutable text snapshots to bundled Diff. */
export const HISTORY_DIFF_MAX_BYTES = 1024 * 1024
export type HistoryDiffSnapshot = Readonly<{ id: string; title: string; text: string }>

export function createDiffPageTarget(payload: { original: DiffSourcePayload; modified: DiffSourcePayload }) {
  const serialize = (side: DiffSourcePayload) => ({
    sourceId: side.sourceId, kind: side.kind, paneId: side.paneId, origin: side.origin,
    title: side.title ?? '', language: side.language, text: side.text ?? '',
  })
  return {
    source: 'builtin' as const, pluginId: 'text-diff', surfaceId: 'main',
    initialText: JSON.stringify({ original: serialize(payload.original), modified: serialize(payload.modified) }),
  }
}

export function prepareHistoryDiffTarget(source: string, pluginId: string, snapshots: readonly HistoryDiffSnapshot[]) {
  if (source !== 'builtin' || pluginId !== 'clipboard-history') throw new Error('NotSupportedError')
  if (!Array.isArray(snapshots) || snapshots.length !== 2) throw new Error('InvalidSnapshotError')
  let bytes = 0
  const sides = snapshots.map((snapshot) => {
    if (!snapshot || typeof snapshot.id !== 'string' || !snapshot.id || snapshot.id.length > 256
      || typeof snapshot.title !== 'string' || snapshot.title.length > 512 || typeof snapshot.text !== 'string') {
      throw new Error('InvalidSnapshotError')
    }
    // Bound both UTF-16 allocation and actual UTF-8 payload. Never truncate.
    if (snapshot.text.length > HISTORY_DIFF_MAX_BYTES) throw new Error('TextTooLargeError')
    bytes += new TextEncoder().encode(snapshot.text).byteLength
    if (bytes > HISTORY_DIFF_MAX_BYTES) throw new Error('TextTooLargeError')
    return { sourceId: `history:${snapshot.id}`, kind: 'empty' as const, title: snapshot.title, text: snapshot.text }
  })
  if (snapshots[0].id === snapshots[1].id) throw new Error('InvalidSnapshotError')
  return createDiffPageTarget({ original: sides[0], modified: sides[1] })
}

/** A one-shot return receipt. Revoked owners and late callbacks cannot finish a newer visit. */
export function createHistoryDiffReturnReceipt(
  owner: { isCurrent(): boolean; subscribeInvalidation(listener: () => void): () => void },
  signal: AbortSignal | undefined,
  onFinish: () => void,
) {
  let resolve!: (accepted: boolean) => void
  let finished = false
  let stopOwner = () => {}
  const promise = new Promise<boolean>((done) => { resolve = done })
  const finish = (accepted: boolean) => {
    if (finished) return
    finished = true
    stopOwner()
    signal?.removeEventListener('abort', abort)
    onFinish()
    resolve(accepted && owner.isCurrent() && !signal?.aborted)
  }
  const abort = () => finish(false)
  return {
    promise, finish,
    start: () => {
      if (finished) return
      stopOwner = owner.subscribeInvalidation(abort)
      signal?.addEventListener('abort', abort, { once: true })
      if (!owner.isCurrent() || signal?.aborted) finish(false)
    },
  }
}
