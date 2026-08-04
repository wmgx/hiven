/**
 * Clipboard History Plugin — Repository
 *
 * Pure business logic for clipboard history management:
 * - Add items with deduplication
 * - CRUD operations
 * - Paste usage + favorites
 * - Prune by maxItems, retentionDays, maxTotalCacheBytes (favorites exempt)
 * - Blob cleanup on image deletion
 */

import type { PluginPrivateStorageApi } from '@hiven/plugin'
import { createClipboardHistoryStore, type ClipboardHistoryStore } from './clipboardHistoryStore'
import { getCachedIndex, setCachedIndex, clearCachedIndex } from './clipboardHistoryCache'
import type {
  AddItemInput,
  ClipboardHistoryItem,
  ClipboardHistoryIndex,
  ClipboardHistoryIndexEntry,
  ClipboardHistoryPrunePolicy,
  PruneResult,
  ClipboardTextHistoryItem,
  ClipboardImageHistoryItem,
  ClipboardFilesHistoryItem,
} from './clipboardHistoryTypes'

export type ClipboardHistoryRepository = {
  addItem(input: AddItemInput): Promise<ClipboardHistoryItem>
  getItem(id: string): Promise<ClipboardHistoryItem | undefined>
  getAllItems(): Promise<ClipboardHistoryItem[]>
  getListItems(): Promise<ClipboardHistoryItem[]>
  getFreshListItems(): Promise<ClipboardHistoryItem[]>
  getListItemsSync(): ClipboardHistoryItem[] | null
  deleteItem(id: string): Promise<void>
  clearAll(): Promise<void>
  pruneItems(policy: ClipboardHistoryPrunePolicy): Promise<PruneResult>
  findByHash(hash: string): Promise<ClipboardHistoryItem | undefined>
  recordPaste(id: string): Promise<ClipboardHistoryItem | undefined>
  setFavorite(id: string, favorite: boolean, title?: string): Promise<ClipboardHistoryItem | undefined>
  updateFavoriteTitle(id: string, title: string): Promise<ClipboardHistoryItem | undefined>
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function makeTextPreview(text: string, maxLength = 200): string {
  const singleLine = text.replace(/\n/g, ' ').trim()
  if (singleLine.length <= maxLength) return singleLine
  return singleLine.slice(0, maxLength) + '…'
}

function usageFieldsFromItem(item: ClipboardHistoryItem): Pick<
  ClipboardHistoryIndexEntry,
  'pasteCount' | 'lastPastedAt' | 'isFavorite' | 'favoriteTitle' | 'favoritedAt' | 'copyCount' | 'sourceApp' | 'lastCopiedAt'
> {
  return {
    lastCopiedAt: item.lastCopiedAt,
    copyCount: item.copyCount,
    sourceApp: item.sourceApp,
    pasteCount: item.pasteCount ?? 0,
    lastPastedAt: item.lastPastedAt,
    isFavorite: item.isFavorite ?? false,
    favoriteTitle: item.favoriteTitle,
    favoritedAt: item.favoritedAt,
  }
}

function isFavoriteEntry(entry: ClipboardHistoryIndexEntry): boolean {
  return entry.isFavorite === true
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
  const store: ClipboardHistoryStore = createClipboardHistoryStore(storage)

  /**
   * Serialize index/item mutations. Clipboard watch fires onChange without awaiting,
   * so concurrent addItem/prune used to race on read-modify-write of history/index
   * and drop entries (intermittent "clipboard not recorded").
   */
  let writeTail: Promise<unknown> = Promise.resolve()
  function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = writeTail.then(fn, fn)
    writeTail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Save index to storage and update in-memory cache. */
  async function saveIndexAndCache(index: ClipboardHistoryIndex): Promise<void> {
    await store.saveIndex(index)
    setCachedIndex(index)
  }

  async function updateItemAndIndex(
    id: string,
    mutate: (item: ClipboardHistoryItem) => ClipboardHistoryItem,
  ): Promise<ClipboardHistoryItem | undefined> {
    const existing = await store.getItem(id)
    if (!existing) return undefined
    const updated = mutate(existing)
    await store.saveItem(updated)
    const index = await store.getIndex()
    const entries = index.entries.map((entry) =>
      entry.id === id ? { ...entry, ...usageFieldsFromItem(updated) } : entry,
    )
    await saveIndexAndCache({ entries, updatedAt: Date.now() })
    return updated
  }

  async function findByHash(hash: string): Promise<ClipboardHistoryItem | undefined> {
    const index = await store.getIndex()
    const entry = index.entries.find((e) => e.hash === hash)
    if (!entry) return undefined
    return store.getItem(entry.id)
  }

  async function addItem(input: AddItemInput): Promise<ClipboardHistoryItem> {
    const now = Date.now()
    const index = await store.getIndex()

    // Deduplication: if same hash exists, update it
    const existingEntry = index.entries.find((e) => e.hash === input.hash)
    if (existingEntry) {
      const existing = await store.getItem(existingEntry.id)
      if (existing) {
        const updated: ClipboardHistoryItem = {
          ...existing,
          lastCopiedAt: now,
          copyCount: existing.copyCount + 1,
          sourceApp: input.sourceApp ?? existing.sourceApp,
        }
        await store.saveItem(updated)

        // Move to top of index and update fields
        const filtered = index.entries.filter((e) => e.id !== existingEntry.id)
        const updatedEntry: ClipboardHistoryIndexEntry = {
          ...existingEntry,
          ...usageFieldsFromItem(updated),
        }
        filtered.unshift(updatedEntry)
        await saveIndexAndCache({ entries: filtered, updatedAt: now })

        return updated
      }
    }

    // Create new item
    const id = generateId()
    let item: ClipboardHistoryItem

    switch (input.kind) {
      case 'text':
        item = {
          id,
          kind: 'text',
          hash: input.hash,
          firstCopiedAt: now,
          lastCopiedAt: now,
          copyCount: 1,
          pasteCount: 0,
          byteSize: input.byteSize,
          sourceApp: input.sourceApp,
          text: input.text,
          preview: makeTextPreview(input.text),
        } satisfies ClipboardTextHistoryItem
        break
      case 'image':
        item = {
          id,
          kind: 'image',
          hash: input.hash,
          firstCopiedAt: now,
          lastCopiedAt: now,
          copyCount: 1,
          pasteCount: 0,
          byteSize: input.byteSize,
          sourceApp: input.sourceApp,
          blobId: input.blobId,
          previewBlobId: input.previewBlobId,
          contentType: input.contentType,
          width: input.width,
          height: input.height,
        } satisfies ClipboardImageHistoryItem
        break
      case 'files':
        item = {
          id,
          kind: 'files',
          hash: input.hash,
          firstCopiedAt: now,
          lastCopiedAt: now,
          copyCount: 1,
          pasteCount: 0,
          byteSize: input.byteSize,
          sourceApp: input.sourceApp,
          paths: input.paths,
          fileNames: input.fileNames,
        } satisfies ClipboardFilesHistoryItem
        break
    }

    await store.saveItem(item)

    // Add to top of index
    const newEntry: ClipboardHistoryIndexEntry = {
      id,
      kind: input.kind,
      hash: input.hash,
      lastCopiedAt: now,
      byteSize: input.byteSize,
      sourceApp: input.sourceApp,
      firstCopiedAt: now,
      copyCount: 1,
      pasteCount: 0,
      isFavorite: false,
      ...(input.kind === 'text' ? { preview: makeTextPreview(input.text) } : {}),
      ...(input.kind === 'image' ? { contentType: input.contentType, width: input.width, height: input.height, previewBlobId: input.previewBlobId } : {}),
      ...(input.kind === 'files' ? { fileNames: input.fileNames } : {}),
    }
    index.entries.unshift(newEntry)
    await saveIndexAndCache({ entries: index.entries, updatedAt: now })

    return item
  }

  async function getItem(id: string): Promise<ClipboardHistoryItem | undefined> {
    return store.getItem(id)
  }

  async function getAllItems(): Promise<ClipboardHistoryItem[]> {
    const index = await store.getIndex()
    const items = await Promise.all(
      index.entries.map((entry) => store.getItem(entry.id))
    )
    return items.filter(Boolean) as ClipboardHistoryItem[]
  }

  async function getListItems(): Promise<ClipboardHistoryItem[]> {
    const cached = getCachedIndex()
    if (cached) return indexToListItems(cached)
    const index = await store.getIndex()
    setCachedIndex(index)
    return indexToListItems(index)
  }

  async function getFreshListItems(): Promise<ClipboardHistoryItem[]> {
    const index = await store.getIndex()
    setCachedIndex(index)
    return indexToListItems(index)
  }

  function getListItemsSync(): ClipboardHistoryItem[] | null {
    const cached = getCachedIndex()
    if (!cached) return null
    return indexToListItems(cached)
  }

  async function recordPaste(id: string): Promise<ClipboardHistoryItem | undefined> {
    const now = Date.now()
    return updateItemAndIndex(id, (item) => ({
      ...item,
      pasteCount: (item.pasteCount ?? 0) + 1,
      lastPastedAt: now,
    }))
  }

  async function setFavorite(
    id: string,
    favorite: boolean,
    title?: string,
  ): Promise<ClipboardHistoryItem | undefined> {
    const now = Date.now()
    return updateItemAndIndex(id, (item) => {
      if (!favorite) {
        const { favoriteTitle: _t, favoritedAt: _a, ...rest } = item
        return { ...rest, isFavorite: false, favoriteTitle: undefined, favoritedAt: undefined }
      }
      const trimmed = title?.trim()
      return {
        ...item,
        isFavorite: true,
        favoritedAt: item.favoritedAt ?? now,
        favoriteTitle: trimmed ? trimmed : item.favoriteTitle,
      }
    })
  }

  async function updateFavoriteTitle(
    id: string,
    title: string,
  ): Promise<ClipboardHistoryItem | undefined> {
    return updateItemAndIndex(id, (item) => {
      if (!item.isFavorite) return item
      const trimmed = title.trim()
      return {
        ...item,
        favoriteTitle: trimmed || undefined,
      }
    })
  }

  async function deleteItem(id: string): Promise<void> {
    const item = await store.getItem(id)
    if (!item) return

    // Clean up blobs for image items
    if (item.kind === 'image') {
      await store.deleteBlob(item.blobId)
      await store.deleteBlob(item.previewBlobId)
    }

    await store.deleteItem(id)

    // Remove from index
    const index = await store.getIndex()
    const filtered = index.entries.filter((e) => e.id !== id)
    await saveIndexAndCache({ entries: filtered, updatedAt: Date.now() })
  }

  async function clearAll(): Promise<void> {
    const index = await store.getIndex()

    // Clean up blobs for all image items
    for (const entry of index.entries) {
      if (entry.kind === 'image') {
        const item = await store.getItem(entry.id)
        if (item && item.kind === 'image') {
          await store.deleteBlob(item.blobId)
          await store.deleteBlob(item.previewBlobId)
        }
      }
    }

    await store.clear()
    clearCachedIndex()
  }

  async function pruneItems(policy: ClipboardHistoryPrunePolicy): Promise<PruneResult> {
    const index = await store.getIndex()
    const now = Date.now()
    const toRemove: Set<string> = new Set()
    let removedBytes = 0
    const removedBlobIds: string[] = []

    // Sort entries by lastCopiedAt descending (newest first) - index is already in this order
    const entries = [...index.entries]

    const markRemovable = (entry: ClipboardHistoryIndexEntry) => {
      if (isFavoriteEntry(entry)) return
      if (toRemove.has(entry.id)) return
      toRemove.add(entry.id)
      removedBytes += entry.byteSize
    }

    // Prune by retentionDays
    if (policy.retentionDays != null && policy.retentionDays > 0) {
      const cutoff = now - policy.retentionDays * 24 * 60 * 60 * 1000
      for (const entry of entries) {
        if (entry.lastCopiedAt < cutoff) {
          markRemovable(entry)
        }
      }
    }

    // Prune by maxItems (keep newest; favorites always kept)
    if (policy.maxItems != null && policy.maxItems > 0) {
      const remaining = entries.filter((e) => !toRemove.has(e.id))
      if (remaining.length > policy.maxItems) {
        const excess = remaining.slice(policy.maxItems)
        for (const entry of excess) {
          markRemovable(entry)
        }
      }
    }

    // Prune by maxTotalCacheBytes (keep newest; favorites always kept)
    if (policy.maxTotalCacheBytes != null && policy.maxTotalCacheBytes > 0) {
      const remaining = entries.filter((e) => !toRemove.has(e.id))
      let totalBytes = remaining.reduce((sum, e) => sum + e.byteSize, 0)
      // Remove oldest until under limit
      for (let i = remaining.length - 1; i >= 0 && totalBytes > policy.maxTotalCacheBytes; i--) {
        const entry = remaining[i]
        if (isFavoriteEntry(entry)) continue
        if (toRemove.has(entry.id)) continue
        toRemove.add(entry.id)
        totalBytes -= entry.byteSize
        removedBytes += entry.byteSize
      }
    }

    // Execute removals
    for (const id of toRemove) {
      const item = await store.getItem(id)
      if (item && item.kind === 'image') {
        removedBlobIds.push(item.blobId, item.previewBlobId)
        await store.deleteBlob(item.blobId)
        await store.deleteBlob(item.previewBlobId)
      }
      await store.deleteItem(id)
    }

    // Update index
    const newEntries = entries.filter((e) => !toRemove.has(e.id))
    await saveIndexAndCache({ entries: newEntries, updatedAt: now })

    return {
      removedCount: toRemove.size,
      removedBytes,
      removedBlobIds,
    }
  }

  return {
    addItem: (input) => withWriteLock(() => addItem(input)),
    getItem,
    getAllItems,
    getListItems,
    getFreshListItems,
    getListItemsSync,
    deleteItem: (id) => withWriteLock(() => deleteItem(id)),
    clearAll: () => withWriteLock(() => clearAll()),
    pruneItems: (policy) => withWriteLock(() => pruneItems(policy)),
    findByHash,
    recordPaste: (id) => withWriteLock(() => recordPaste(id)),
    setFavorite: (id, favorite, title) => withWriteLock(() => setFavorite(id, favorite, title)),
    updateFavoriteTitle: (id, title) => withWriteLock(() => updateFavoriteTitle(id, title)),
  }
}
