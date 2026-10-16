import type { PluginPrivateStorageApi } from '@hiven/plugin'
import { getCachedIndex, setCachedIndex, clearCachedIndex } from './clipboardHistoryCache'
import { matchesClipboardHistorySearch, type ClipboardHistorySearchMatchMode } from './clipboardHistorySearch'
import { resolveClipboardHistoryRetentionMonths } from '../settings/model'
import { createPagedHistoryStore, ROOT, ITEM, META, ORDER, FREQUENT, TRASH, TRASH_ID, GC, metadata, putMetadata, removeMetadata, hashKey, trashKey, blobIds, type HistoryMetadata, type TrashRecord, type Operation } from './clipboardHistoryPagedStore'
import type { AddItemInput, ClipboardHistoryItem, ClipboardHistoryIndex, ClipboardHistoryPrunePolicy, PruneResult, ClipboardTextHistoryItem, ClipboardImageHistoryItem, ClipboardFilesHistoryItem } from './clipboardHistoryTypes'

export type HistoryPageRequest = { query?: string; matchMode?: ClipboardHistorySearchMatchMode; filter?: 'all' | 'text' | 'image' | 'files' | 'favorites' | 'frequent' | 'trash'; frequentThreshold?: number; cursor?: string; limit?: number; signal?: AbortSignal }
export type HistoryPage = { items: ClipboardHistoryItem[]; nextCursor?: string; scanned: number }
export type HistoryRetentionStatus = { legacyProtectedCount: number; trashCount: number; migrationComplete: boolean; hasPurgeable: boolean }
export type ClipboardHistoryRepository = {
  addItem(input: AddItemInput): Promise<ClipboardHistoryItem>
  getItem(id: string): Promise<ClipboardHistoryItem | undefined>
  getTrashItem(id: string): Promise<ClipboardHistoryItem | undefined>
  getAllItems(): Promise<ClipboardHistoryItem[]>
  getPage(request?: HistoryPageRequest): Promise<HistoryPage>
  getListItems(): Promise<ClipboardHistoryItem[]>
  getFreshListItems(ids?: readonly string[]): Promise<ClipboardHistoryItem[]>
  getListItemsSync(): ClipboardHistoryItem[] | null
  getRetentionStatus(): Promise<HistoryRetentionStatus>
  enableLegacyRetention(months: number): Promise<void>
  restoreItem(id: string): Promise<ClipboardHistoryItem | undefined>
  purgeExpiredTrash(options?: { signal?: AbortSignal }): Promise<PruneResult>
  deleteItem(id: string): Promise<void>
  clearAll(): Promise<void>
  pruneItems(policy: ClipboardHistoryPrunePolicy, options?: { signal?: AbortSignal }): Promise<PruneResult>
  findByHash(hash: string): Promise<ClipboardHistoryItem | undefined>
  recordPaste(id: string): Promise<ClipboardHistoryItem | undefined>
  toggleFavorite(id: string): Promise<ClipboardHistoryItem | undefined>
  setFavorite(id: string, favorite: boolean, title?: string): Promise<ClipboardHistoryItem | undefined>
  updateFavoriteTitle(id: string, title: string): Promise<ClipboardHistoryItem | undefined>
  updateText(id: string, expectedText: string, text: string, maxBytes: number, isCurrent?: () => boolean): Promise<ClipboardTextHistoryItem>
}
const DAY = 86_400_000
const makeTextPreview = (text: string) => { const line = text.replace(/\n/g, ' ').trim(); return line.length > 200 ? `${line.slice(0, 200)}…` : line }
const emptyPrune = (): PruneResult => ({ removedCount: 0, removedBytes: 0, removedBlobIds: [] })
function requireCurrent(signal?: AbortSignal) { if (signal?.aborted) throw new Error('cancelled') }
/** Calendar-month retention uses UTC timestamps, clamping month ends explicitly. */
export function historyRetentionCutoff(now: number, months: number): number {
  const date = new Date(now)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() - resolveClipboardHistoryRetentionMonths(months))
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return date.getTime()
}
export function indexToListItems(index: ClipboardHistoryIndex): ClipboardHistoryItem[] {
  return index.entries.map((entry): ClipboardHistoryItem | null => {
    const base = {
      id: entry.id,
      kind: entry.kind,
      hash: entry.hash,
      firstCopiedAt: entry.firstCopiedAt ?? entry.lastCopiedAt,
      lastCopiedAt: entry.lastCopiedAt,
      copyCount: entry.copyCount ?? 1,
      byteSize: entry.byteSize,
      sourceApp: entry.sourceApp,
      pasteCount: entry.pasteCount ?? 0,
      lastPastedAt: entry.lastPastedAt,
      isFavorite: entry.isFavorite ?? false,
      favoriteTitle: entry.favoriteTitle,
      favoritedAt: entry.favoritedAt,
    }
    switch (entry.kind) {
      case 'text':
        return { ...base, kind: 'text', text: '', preview: entry.preview ?? '' } as ClipboardTextHistoryItem
      case 'image':
        return { ...base, kind: 'image', blobId: '', previewBlobId: entry.previewBlobId ?? '', contentType: entry.contentType ?? 'image/png', width: entry.width, height: entry.height } as ClipboardImageHistoryItem
      case 'files':
        return { ...base, kind: 'files', paths: [], fileNames: entry.fileNames ?? [] } as ClipboardFilesHistoryItem
      default:
        return null
    }
  }).filter(Boolean) as ClipboardHistoryItem[]
}

export function createClipboardHistoryRepository(storage: PluginPrivateStorageApi): ClipboardHistoryRepository {
  const store = createPagedHistoryStore(storage)
  const notify = () => clearCachedIndex()
  async function getItem(id: string) {
    await store.ready()
    const meta = await storage.kv.get<HistoryMetadata>(META + id)
    if (!meta) return undefined
    const body = await storage.kv.get<ClipboardHistoryItem>(ITEM + id)
    return body ? { ...body, isFavorite: meta.isFavorite, favoriteTitle: meta.favoriteTitle, favoritedAt: meta.favoritedAt } : undefined
  }
  async function getTrashItem(id: string) {
    await store.ready()
    if (!await storage.kv.get<string>(TRASH_ID + id)) return undefined
    return storage.kv.get<ClipboardHistoryItem>(ITEM + id)
  }
  async function getPage(request: HistoryPageRequest = {}): Promise<HistoryPage> {
    await store.ready()
    requireCurrent(request.signal)
    const limit = Math.max(1, Math.min(100, Math.floor(request.limit ?? 100)))
    const matchMode = request.matchMode ?? 'literal'
    const prefix = request.filter === 'trash' ? TRASH : request.filter === 'frequent' ? FREQUENT : ORDER
    if (request.cursor && !request.cursor.startsWith(prefix)) throw new Error('Invalid history cursor')
    const legacyEnabled = Boolean((await store.state()).legacyEnabledAt)
    const items: ClipboardHistoryItem[] = []
    let cursor = request.cursor
    let scanned = 0
    while (scanned < 2048 && items.length < limit) {
      requireCurrent(request.signal)
      const query = request.query?.trim()
      const page = query && prefix !== TRASH
        ? await storage.kv.relatedSearch<HistoryMetadata>({
            indexPrefix: prefix, valuePrefix: ITEM, after: cursor,
            limit: Math.min(100, Math.max(32, limit - items.length)), scanLimit: 2048 - scanned,
            query: query.toLowerCase(), matchMode, idPath: '$.id',
            indexPaths: ['$.favoriteTitle', '$.preview', '$.contentType', '$.width', '$.height', '$.fileNames'],
            indexPathGroups: [['$.contentType', '$.width', '$.height']],
            valuePaths: ['$.text'],
          })
        : await storage.kv.page<HistoryMetadata | TrashRecord>({ prefix, after: cursor, limit: Math.min(100, Math.max(32, limit - items.length)) })
      const candidates: Array<{ meta: HistoryMetadata; lite: ClipboardHistoryItem; trash?: TrashRecord }> = []
      for (const row of page.entries) {
        requireCurrent(request.signal)
        cursor = row.key
        const trash = request.filter === 'trash' ? row.value as TrashRecord : undefined
        const meta = trash ? trash.metadata : row.value as HistoryMetadata
        if (request.filter === 'favorites' && !meta.isFavorite) continue
        if (request.filter === 'frequent' && (meta.pasteCount ?? 0) < (request.frequentThreshold ?? 3)) continue
        if (['text', 'image', 'files'].includes(request.filter ?? '') && meta.kind !== request.filter) continue
        const lite = indexToListItems({ entries: [meta], updatedAt: 0 })[0]
        if (!lite) continue
        candidates.push({ meta, lite, trash })
      }
      scanned += 'scanned' in page ? page.scanned : page.entries.length
      // Native search deliberately returns a broad Unicode candidate set.
      // Reapply the existing JS matcher to every candidate so case expansion
      // (for example Straße/SS) and composite-field spacing stay exact.
      const bodyKeys = query ? candidates
        .filter(({ lite }) => lite.kind === 'text' && !matchesClipboardHistorySearch(lite, query, matchMode))
        .map(({ meta }) => ({ key: ITEM + meta.id, byteSize: meta.byteSize })) : []
      const bodies = new Map<string, ClipboardHistoryItem>()
      let bodyChunk: string[] = []; let bodyChunkBytes = 0
      const flushBodies = async () => {
        if (!bodyChunk.length) return
        for (const entry of await storage.kv.getMany<ClipboardHistoryItem>(bodyChunk)) bodies.set(entry.key, entry.value)
        requireCurrent(request.signal)
        bodyChunk = []; bodyChunkBytes = 0
      }
      for (const body of bodyKeys) {
        // JSON escaping can expand text substantially; keep the raw-text
        // budget well below the native 16 MiB response ceiling.
        if (body.byteSize > 2 * 1024 * 1024) {
          await flushBodies()
          const value = await storage.kv.get<ClipboardHistoryItem>(body.key)
          requireCurrent(request.signal)
          if (value) bodies.set(body.key, value)
          continue
        }
        if (bodyChunk.length === 32 || bodyChunkBytes + body.byteSize > 2 * 1024 * 1024) await flushBodies()
        bodyChunk.push(body.key); bodyChunkBytes += body.byteSize
      }
      await flushBodies()
      requireCurrent(request.signal)
      for (const { meta, lite, trash } of candidates) {
        if (items.length >= limit) break
        if (query && !matchesClipboardHistorySearch(lite, query, matchMode)) {
          if (lite.kind !== 'text') continue
          const full = bodies.get(ITEM + meta.id)
          if (!full || !matchesClipboardHistorySearch(full, query, matchMode)) continue
        }
        items.push({ ...lite, ...(trash ? { deletedAt: trash.deletedAt, purgeAfter: trash.purgeAfter } : {}), legacyProtected: meta.legacy === true && !legacyEnabled })
      }
      if (!page.nextCursor) return { items, scanned }
      cursor = page.nextCursor
    }
    return { items, scanned, nextCursor: cursor }
  }
  async function getFreshListItems(ids?: readonly string[]) {
    await store.ready()
    if (ids) {
      if (ids.length > 20) throw new Error('Too many selected history items')
      const records = await Promise.all(ids.map((id) => storage.kv.get<HistoryMetadata>(META + id)))
      return indexToListItems({ entries: records.filter((item): item is HistoryMetadata => Boolean(item)), updatedAt: Date.now() })
    }
    const result = await getPage()
    // Only the first bounded page is cached; mutation notifications invalidate it.
    setCachedIndex({ entries: result.items.map((item) => metadata(item)), updatedAt: Date.now() })
    return result.items
  }
  async function findByHash(hash: string) {
    await store.ready()
    const id = await storage.kv.get<string>(hashKey(hash))
    return id ? getItem(id) : undefined
  }
  async function addItem(input: AddItemInput) {
    const result = await store.mutate(async (state) => {
      const id = await storage.kv.get<string>(hashKey(input.hash))
      const prior = id ? await storage.kv.get<HistoryMetadata>(META + id) : undefined
      const existing = prior ? await storage.kv.get<ClipboardHistoryItem>(ITEM + prior.id) : undefined
      const now = Date.now()
      if (prior && existing) {
        const item = { ...existing, isFavorite: prior.isFavorite, favoriteTitle: prior.favoriteTitle, favoritedAt: prior.favoritedAt, lastCopiedAt: now, copyCount: existing.copyCount + 1, sourceApp: input.sourceApp ?? existing.sourceApp }
        const meta = metadata(item, { legacy: prior.legacy, retentionStartedAt: prior.retentionStartedAt })
        const unusedCapture = input.kind === 'image'
          ? await store.discardUnusedCaptureBlobs([input.blobId, input.previewBlobId], blobIds(prior)) : []
        return { result: item, operations: [...removeMetadata(prior), { type: 'set', key: ITEM + item.id, value: item }, ...putMetadata(meta), ...unusedCapture] }
      }
      const item = { ...input, id: `${now}-${Math.random().toString(36).slice(2, 10)}`, firstCopiedAt: now, lastCopiedAt: now, copyCount: 1, pasteCount: 0, isFavorite: false,
        ...(input.kind === 'text' ? { preview: makeTextPreview(input.text) } : {}) } as ClipboardHistoryItem
      const meta = metadata(item)
      const operations: Operation[] = [{ type: 'set', key: ITEM + item.id, value: item }, ...putMetadata(meta), ...await store.adjustBlobs([{ meta, delta: 1 }])]
      return { result: item, operations, next: { ...state, active: state.active + 1 } }
    })
    notify(); return result
  }
  async function update(id: string, mutate: (item: ClipboardHistoryItem) => ClipboardHistoryItem, current = () => true) {
    const result = await store.mutate(async () => {
      const prior = await storage.kv.get<HistoryMetadata>(META + id)
      const item = prior ? await storage.kv.get<ClipboardHistoryItem>(ITEM + id) : undefined
      if (!current()) throw new Error('cancelled')
      if (!item || !prior) return { operations: [], result: undefined }
      const changed = mutate({ ...item, isFavorite: prior.isFavorite, favoriteTitle: prior.favoriteTitle, favoritedAt: prior.favoritedAt })
      if (changed.hash !== prior.hash) {
        const duplicate = await storage.kv.get<string>(hashKey(changed.hash))
        if (duplicate && duplicate !== id) throw new Error('duplicate')
      }
      const meta = metadata(changed, { legacy: prior.legacy, retentionStartedAt: prior.retentionStartedAt })
      return { result: changed, operations: [...removeMetadata(prior), { type: 'set', key: ITEM + id, value: changed }, ...putMetadata(meta)] }
    }, () => { if (!current()) throw new Error('cancelled') })
    notify(); return result
  }
  async function softDelete(id: string, reason: 'manual' | 'expired', cutoff?: number, signal?: AbortSignal) {
    const result = await store.mutate(async (state) => {
      const prior = await storage.kv.get<HistoryMetadata>(META + id)
      if (!prior) return { result: undefined, operations: [] }
      if (reason === 'expired' && (prior.isFavorite || (prior.legacy && !state.legacyEnabledAt) || Math.max(prior.lastCopiedAt, prior.retentionStartedAt ?? 0, prior.legacy ? state.legacyEnabledAt ?? 0 : 0) >= (cutoff ?? 0))) return { result: undefined, operations: [] }
      const now = Date.now()
      const trash: TrashRecord = { metadata: prior, deletedAt: now, purgeAfter: now + 30 * DAY, reason }
      return { result: prior, next: { ...state, active: state.active - 1, trash: state.trash + 1, legacy: state.legacy - (prior.legacy ? 1 : 0) },
        operations: [...removeMetadata(prior), { type: 'set', key: trashKey(trash), value: trash }, { type: 'set', key: TRASH_ID + id, value: trashKey(trash) }] }
    }, () => requireCurrent(signal))
    if (result) notify()
    return result
  }
  async function deleteItem(id: string) { await softDelete(id, 'manual') }
  async function restoreItem(id: string) {
    const result = await store.mutate(async (state) => {
      const key = await storage.kv.get<string>(TRASH_ID + id)
      const trash = key ? await storage.kv.get<TrashRecord>(key) : undefined
      const body = trash ? await storage.kv.get<ClipboardHistoryItem>(ITEM + id) : undefined
      if (!trash || !body || !key) return { result: undefined, operations: [] }
      const duplicate = await storage.kv.get<string>(hashKey(body.hash))
      if (duplicate && duplicate !== id) throw new Error('duplicate')
      const meta = { ...trash.metadata, retentionStartedAt: Date.now() }
      return { result: body, next: { ...state, active: state.active + 1, trash: state.trash - 1, legacy: state.legacy + (meta.legacy ? 1 : 0) },
        operations: [{ type: 'delete', key }, { type: 'delete', key: TRASH_ID + id }, ...putMetadata(meta)] }
    })
    notify(); return result
  }
  async function getRetentionStatus(): Promise<HistoryRetentionStatus> {
    await store.ready()
    const state = await store.state()
    const first = await storage.kv.page<TrashRecord>({ prefix: TRASH, limit: 1 })
    return { legacyProtectedCount: state.legacyEnabledAt ? 0 : state.legacy, trashCount: state.trash, migrationComplete: state.phase === 'complete', hasPurgeable: (first.entries[0]?.value.purgeAfter ?? Infinity) <= Date.now() }
  }
  async function enableLegacyRetention(months: number) {
    resolveClipboardHistoryRetentionMonths(months)
    await store.mutate(async (state) => ({ result: undefined, operations: [], next: { ...state, legacyEnabledAt: state.legacyEnabledAt ?? Date.now() } }))
    notify()
  }
  async function collectBlobGarbage(signal?: AbortSignal) {
    await store.ready()
    const page = await storage.kv.page<string>({ prefix: GC, limit: 16 })
    const removed: string[] = []
    for (const row of page.entries) {
      requireCurrent(signal)
      // GC tombstones were atomically installed with the last-reference removal;
      // add/restore cannot acquire that ID after this point, including other windows.
      try { await storage.blob.delete(row.value); await storage.kv.delete(row.key); removed.push(row.value) } catch { /* Retry later; losing a file is worse than delaying cleanup. */ }
    }
    return removed
  }
  async function purgeExpiredTrash(options: { signal?: AbortSignal } = {}): Promise<PruneResult> {
    await store.ready()
    const result = emptyPrune()
    const page = await storage.kv.page<TrashRecord>({ prefix: TRASH, limit: 32 })
    for (const row of page.entries) {
      requireCurrent(options.signal)
      if (row.value.purgeAfter > Date.now()) break
      const removed = await store.mutate(async (state) => {
        requireCurrent(options.signal)
        const trash = await storage.kv.get<TrashRecord>(row.key)
        if (!trash || trash.purgeAfter > Date.now()) return { result: undefined, operations: [] }
        const ops = await store.adjustBlobs([{ meta: trash.metadata, delta: -1 }])
        return { result: trash.metadata, next: { ...state, trash: state.trash - 1 }, operations: [...ops, { type: 'delete', key: row.key }, { type: 'delete', key: TRASH_ID + trash.metadata.id }, { type: 'delete', key: ITEM + trash.metadata.id }] }
      }, () => requireCurrent(options.signal))
      if (removed) { result.removedCount++; result.removedBytes += removed.byteSize }
    }
    result.removedBlobIds = await collectBlobGarbage(options.signal)
    if (result.removedCount) notify()
    return result
  }
  async function pruneItems(policy: ClipboardHistoryPrunePolicy, options: { signal?: AbortSignal } = {}): Promise<PruneResult> {
    await store.ready()
    const cutoff = historyRetentionCutoff(Date.now(), policy.retentionMonths ?? 3)
    const result = emptyPrune()
    const state = await store.state()
    const cursorKey = ROOT + 'prune-cursor'
    const cursor = await storage.kv.get<string>(cursorKey)
    const page = await storage.kv.page<HistoryMetadata>({ prefix: ORDER, after: cursor, limit: 64, order: 'desc' })
    for (const row of page.entries) {
      requireCurrent(options.signal)
      const entry = row.value
      if (entry.isFavorite || (entry.legacy && !state.legacyEnabledAt) || Math.max(entry.lastCopiedAt, entry.retentionStartedAt ?? 0, entry.legacy ? state.legacyEnabledAt ?? 0 : 0) >= cutoff) continue
      const removed = await softDelete(entry.id, 'expired', cutoff, options.signal)
      if (removed) { result.removedCount++; result.removedBytes += removed.byteSize }
    }
    requireCurrent(options.signal)
    if (page.nextCursor) await storage.kv.set(cursorKey, page.nextCursor)
    else await storage.kv.delete(cursorKey)
    result.hasMore = Boolean(page.nextCursor)
    return result
  }
  async function clearAll() {
    // Explicit clear traverses bounded pages and remains recoverable for 30 days.
    let cursor: string | undefined
    do {
      const page = await getPage({ limit: 100, cursor })
      for (const item of page.items) await deleteItem(item.id)
      cursor = page.nextCursor
    } while (cursor)
  }
  async function setFavorite(id: string, favorite: boolean, title?: string) {
    return update(id, (item) => ({ ...item, isFavorite: favorite, favoriteTitle: favorite ? title?.trim() || item.favoriteTitle : undefined, favoritedAt: favorite ? item.favoritedAt ?? Date.now() : undefined }))
  }
  return {
    addItem, getItem, getTrashItem, getPage, getRetentionStatus, enableLegacyRetention, restoreItem, purgeExpiredTrash,
    // Compatibility methods are bounded to one page. Cross-search snapshots pass
    // their explicit selected IDs, never rely on a global list membership read.
    getAllItems: () => getFreshListItems(), getListItems: () => getFreshListItems(), getFreshListItems,
    getListItemsSync: () => { const cached = getCachedIndex(); return cached ? indexToListItems(cached) : null },
    deleteItem, clearAll, pruneItems, findByHash,
    recordPaste: (id) => update(id, (item) => ({ ...item, pasteCount: (item.pasteCount ?? 0) + 1, lastPastedAt: Date.now() })),
    setFavorite,
    toggleFavorite: (id) => update(id, (item) => ({ ...item, isFavorite: !item.isFavorite, favoritedAt: !item.isFavorite ? Date.now() : undefined, favoriteTitle: !item.isFavorite ? item.favoriteTitle : undefined })),
    updateFavoriteTitle: (id, title) => update(id, (item) => item.isFavorite ? { ...item, favoriteTitle: title.trim() || undefined } : item),
    updateText: async (id, expectedText, text, maxBytes, isCurrent = () => true) => {
      const result = await update(id, (item) => {
        if (item.kind !== 'text') throw new Error('missing')
        if (item.text !== expectedText) throw new Error('changed')
        const byteSize = new TextEncoder().encode(text).byteLength
        if (byteSize > maxBytes) throw new Error('tooLarge')
        let hash = 2166136261
        const payload = `text:${text}`
        for (let i = 0; i < payload.length; i++) { hash ^= payload.charCodeAt(i); hash = Math.imul(hash, 16777619) }
        return { ...item, text, byteSize, hash: (hash >>> 0).toString(36), preview: makeTextPreview(text) }
      }, isCurrent)
      if (!result || result.kind !== 'text') throw new Error('missing')
      return result
    },
  }
}
