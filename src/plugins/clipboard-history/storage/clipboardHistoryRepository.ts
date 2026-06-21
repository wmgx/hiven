/**
 * Clipboard History Plugin — Repository
 *
 * Pure business logic for clipboard history management:
 * - Add items with deduplication
 * - CRUD operations
 * - Prune by maxItems, retentionDays, maxTotalCacheBytes
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
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function makeTextPreview(text: string, maxLength = 200): string {
  const singleLine = text.replace(/\n/g, ' ').trim()
  if (singleLine.length <= maxLength) return singleLine
  return singleLine.slice(0, maxLength) + '…'
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

  /** Save index to storage and update in-memory cache. */
  async function saveIndexAndCache(index: ClipboardHistoryIndex): Promise<void> {
    await store.saveIndex(index)
    setCachedIndex(index)
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
          lastCopiedAt: now,
          copyCount: updated.copyCount,
          sourceApp: updated.sourceApp,
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

    // Prune by retentionDays
    if (policy.retentionDays != null && policy.retentionDays > 0) {
      const cutoff = now - policy.retentionDays * 24 * 60 * 60 * 1000
      for (const entry of entries) {
        if (entry.lastCopiedAt < cutoff) {
          toRemove.add(entry.id)
          removedBytes += entry.byteSize
        }
      }
    }

    // Prune by maxItems (keep newest)
    if (policy.maxItems != null && policy.maxItems > 0) {
      const remaining = entries.filter((e) => !toRemove.has(e.id))
      if (remaining.length > policy.maxItems) {
        const excess = remaining.slice(policy.maxItems)
        for (const entry of excess) {
          toRemove.add(entry.id)
          removedBytes += entry.byteSize
        }
      }
    }

    // Prune by maxTotalCacheBytes (keep newest)
    if (policy.maxTotalCacheBytes != null && policy.maxTotalCacheBytes > 0) {
      const remaining = entries.filter((e) => !toRemove.has(e.id))
      let totalBytes = remaining.reduce((sum, e) => sum + e.byteSize, 0)
      // Remove oldest until under limit
      for (let i = remaining.length - 1; i >= 0 && totalBytes > policy.maxTotalCacheBytes; i--) {
        toRemove.add(remaining[i].id)
        totalBytes -= remaining[i].byteSize
        removedBytes += remaining[i].byteSize
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
    addItem,
    getItem,
    getAllItems,
    getListItems,
    getFreshListItems,
    getListItemsSync,
    deleteItem,
    clearAll,
    pruneItems,
    findByHash,
  }
}
