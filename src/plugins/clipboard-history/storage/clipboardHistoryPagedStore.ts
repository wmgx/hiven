import type { PluginPrivateStorageApi } from '@hiven/plugin'
import type { ClipboardHistoryItem, ClipboardHistoryIndexEntry } from './clipboardHistoryTypes'

export const ROOT = 'history/v2/'
export const STATE = `${ROOT}state`
export const ITEM = 'history/items/'
export const META = `${ROOT}meta/`
export const ORDER = `${ROOT}order/`
export const FREQUENT = `${ROOT}frequent/`
export const TRASH = `${ROOT}trash/`
export const TRASH_ID = `${ROOT}trash-id/`
export const BLOB = `${ROOT}blob/`
export const GC = `${ROOT}gc/`
export type HistoryState = { version: 2; phase: 'migrating' | 'complete'; cursor?: number; revision: string; active: number; trash: number; legacy: number; legacyEnabledAt?: number }
export type HistoryMetadata = ClipboardHistoryIndexEntry & { blobId?: string; legacy?: boolean; retentionStartedAt?: number }
export type TrashRecord = { metadata: HistoryMetadata; deletedAt: number; purgeAfter: number; reason: 'expired' | 'manual' }
export type BlobReferences = { count: number; gc?: boolean }
export type Operation = { type: 'set'; key: string; value: unknown } | { type: 'delete'; key: string }
export const revision = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
export const invert = (number: number) => String(Math.max(0, 9_000_000_000_000_000 - number)).padStart(16, '0')
export const orderKey = (meta: HistoryMetadata) => `${ORDER}${invert(meta.lastCopiedAt)}/${meta.id}`
export const frequentKey = (meta: HistoryMetadata) => `${FREQUENT}${invert(meta.pasteCount ?? 0)}/${invert(meta.lastPastedAt ?? 0)}/${meta.id}`
export const hashKey = (hash: string) => `${ROOT}hash/${encodeURIComponent(hash)}`
export const trashKey = (row: TrashRecord) => `${TRASH}${String(row.purgeAfter).padStart(16, '0')}/${row.metadata.id}`
export const blobKey = (id: string) => `${BLOB}${encodeURIComponent(id)}`
export const blobIds = (meta: HistoryMetadata) => meta.kind === 'image' ? [...new Set([meta.blobId, meta.previewBlobId].filter((id): id is string => Boolean(id)))] : []
export function metadata(item: ClipboardHistoryItem, extra: Partial<HistoryMetadata> = {}): HistoryMetadata {
  const { id, kind, hash, lastCopiedAt, byteSize, sourceApp, firstCopiedAt, copyCount, pasteCount, lastPastedAt, isFavorite, favoriteTitle, favoritedAt } = item
  return { id, kind, hash, lastCopiedAt, byteSize, sourceApp, firstCopiedAt, copyCount, pasteCount, lastPastedAt, isFavorite, favoriteTitle, favoritedAt,
    ...(item.kind === 'text' ? { preview: item.preview } : item.kind === 'image' ? { blobId: item.blobId, previewBlobId: item.previewBlobId, contentType: item.contentType, width: item.width, height: item.height } : { fileNames: item.fileNames }), ...extra }
}
export function putMetadata(meta: HistoryMetadata): Operation[] {
  return [{ type: 'set', key: META + meta.id, value: meta }, { type: 'set', key: orderKey(meta), value: meta }, { type: 'set', key: frequentKey(meta), value: meta }, { type: 'set', key: hashKey(meta.hash), value: meta.id }]
}
export function removeMetadata(meta: HistoryMetadata): Operation[] {
  return [META + meta.id, orderKey(meta), frequentKey(meta), hashKey(meta.hash)].map((key) => ({ type: 'delete', key }))
}

/** All namespace mutations share a persisted CAS revision, not a per-webview mutex. */
export function createPagedHistoryStore(storage: PluginPrivateStorageApi) {
  let migration: Promise<void> | undefined
  async function state(): Promise<HistoryState> {
    const result = await storage.kv.get<HistoryState>(STATE)
    if (!result || result.version !== 2) throw new Error('History migration is incomplete')
    return result
  }
  async function commit(previous: HistoryState | undefined, next: HistoryState, operations: Operation[]): Promise<boolean> {
    return (await storage.kv.batch({ checks: [{ key: STATE, expected: previous }], operations: [...operations, { type: 'set', key: STATE, value: { ...next, revision: revision() } }] })).committed
  }
  async function adjustBlobs(changes: { meta: HistoryMetadata; delta: 1 | -1 }[]): Promise<Operation[]> {
    const refs = new Map<string, BlobReferences>()
    for (const change of changes) for (const id of blobIds(change.meta)) {
      const current = refs.get(id) ?? await storage.kv.get<BlobReferences>(blobKey(id)) ?? { count: 0 }
      if (change.delta > 0 && current.gc) throw new Error('Image reference is no longer available')
      if (current.count + change.delta < 0) throw new Error('Image reference index is inconsistent')
      refs.set(id, { count: current.count + change.delta })
    }
    const operations: Operation[] = []
    for (const [id, ref] of refs) {
      operations.push({ type: 'set', key: blobKey(id), value: ref.count ? ref : { count: 0, gc: true } })
      if (!ref.count) operations.push({ type: 'set', key: GC + encodeURIComponent(id), value: id })
    }
    return operations
  }
  /** Only IDs supplied by this successful image capture may be reclaimed here.
   * The caller commits these operations with the same namespace CAS as dedupe.
   * Never infer that arbitrary unindexed old blobs are disposable.
   */
  async function discardUnusedCaptureBlobs(ids: readonly string[], retained: readonly string[]): Promise<Operation[]> {
    const operations: Operation[] = []
    for (const id of new Set(ids)) {
      if (!id || retained.includes(id)) continue
      const current = await storage.kv.get<BlobReferences>(blobKey(id))
      if (current && (current.count !== 0 || current.gc)) continue
      operations.push({ type: 'set', key: blobKey(id), value: { count: 0, gc: true } },
        { type: 'set', key: GC + encodeURIComponent(id), value: id })
    }
    return operations
  }
  async function migrate(): Promise<void> {
    for (;;) {
      let previous = await storage.kv.get<HistoryState>(STATE)
      if (previous && (previous.version !== 2 || !['migrating', 'complete'].includes(previous.phase))) throw new Error('Unsupported history storage version; original data is retained')
      if (previous?.phase === 'complete') {
        // The complete marker is authoritative; removing v1 cannot revive entries
        // on restart. Its item bodies remain the single canonical v2 bodies.
        await storage.kv.delete('history/index')
        return
      }
      if (!previous) {
        const initial: HistoryState = { version: 2, phase: 'migrating', revision: revision(), active: 0, trash: 0, legacy: 0 }
        if (!await commit(undefined, initial, [])) continue
        previous = await state()
      }
      const page = await storage.kv.arrayPage<ClipboardHistoryIndexEntry>({ key: 'history/index', path: '$.entries', afterIndex: previous.cursor, limit: 8 })
      const operations: Operation[] = []
      const additions: HistoryMetadata[] = []
      for (const { value: entry } of page.entries) {
        if (!entry || typeof entry.id !== 'string') throw new Error('History index is invalid; original data is retained')
        const item = await storage.kv.get<ClipboardHistoryItem>(ITEM + entry.id)
        if (!item || item.id !== entry.id || item.kind !== entry.kind || !['text', 'image', 'files'].includes(item.kind) || typeof item.hash !== 'string' || !Number.isFinite(item.lastCopiedAt) || !Number.isFinite(item.byteSize) || item.byteSize < 0 || (item.kind === 'text' && typeof item.text !== 'string') || (item.kind === 'image' && (!item.blobId || !item.previewBlobId)) || (item.kind === 'files' && !Array.isArray(item.paths))) throw new Error('History item is unreadable; migration has paused without deleting data')
        const old = await storage.kv.get<HistoryMetadata>(META + entry.id)
        if (old || additions.some((added) => added.id === entry.id)) continue
        const normalized = { ...item, isFavorite: item.isFavorite === true || entry.isFavorite === true }
        const meta = metadata(normalized, { legacy: true })
        additions.push(meta)
        operations.push(...putMetadata(meta))
      }
      operations.push(...await adjustBlobs(additions.map((meta) => ({ meta, delta: 1 }))))
      const next = { ...previous, active: previous.active + additions.length, legacy: previous.legacy + additions.length,
        ...(page.nextIndex === undefined ? { phase: 'complete' as const } : { cursor: page.nextIndex }) }
      if (await commit(previous, next, operations) && next.phase === 'complete') {
        await storage.kv.delete('history/index')
        return
      }
    }
  }
  async function ready() {
    if (!migration) migration = migrate().catch((error) => { migration = undefined; throw error })
    await migration
  }
  async function mutate<T>(build: (previous: HistoryState) => Promise<{ operations: Operation[]; next?: HistoryState; result: T }>, beforeCommit?: () => void): Promise<T> {
    await ready()
    for (let attempt = 0; attempt < 12; attempt++) {
      const previous = await state()
      const change = await build(previous)
      beforeCommit?.()
      if (change.operations.length === 0 && !change.next) return change.result
      if (await commit(previous, change.next ?? previous, change.operations)) return change.result
    }
    throw new Error('History changed concurrently; retry')
  }
  return { ready, state, mutate, adjustBlobs, discardUnusedCaptureBlobs }
}
