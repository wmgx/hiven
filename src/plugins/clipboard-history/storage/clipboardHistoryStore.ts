/**
 * Clipboard History Plugin — Storage Store
 *
 * Thin adapter over PluginPrivateStorageApi for clipboard history persistence.
 * All data access goes through host-provided storage API.
 */

import type { PluginPrivateStorageApi } from '@hiven/plugin'
import type {
  ClipboardHistoryItem,
  ClipboardHistoryIndex,
  ClipboardHistoryIndexEntry,
} from './clipboardHistoryTypes'

const KV_PREFIX_ITEMS = 'history/items/'
const KV_KEY_INDEX = 'history/index'

export type ClipboardHistoryStore = {
  getIndex(): Promise<ClipboardHistoryIndex>
  saveIndex(index: ClipboardHistoryIndex): Promise<void>
  getItem(id: string): Promise<ClipboardHistoryItem | undefined>
  saveItem(item: ClipboardHistoryItem): Promise<void>
  deleteItem(id: string): Promise<void>
  deleteBlob(blobId: string): Promise<void>
  clear(): Promise<void>
}

export function createClipboardHistoryStore(storage: PluginPrivateStorageApi): ClipboardHistoryStore {
  return {
    async getIndex(): Promise<ClipboardHistoryIndex> {
      const index = await storage.kv.get<ClipboardHistoryIndex>(KV_KEY_INDEX)
      return index ?? { entries: [], updatedAt: Date.now() }
    },

    async saveIndex(index: ClipboardHistoryIndex): Promise<void> {
      await storage.kv.set(KV_KEY_INDEX, index)
    },

    async getItem(id: string): Promise<ClipboardHistoryItem | undefined> {
      return storage.kv.get<ClipboardHistoryItem>(`${KV_PREFIX_ITEMS}${id}`)
    },

    async saveItem(item: ClipboardHistoryItem): Promise<void> {
      await storage.kv.set(`${KV_PREFIX_ITEMS}${item.id}`, item)
    },

    async deleteItem(id: string): Promise<void> {
      await storage.kv.delete(`${KV_PREFIX_ITEMS}${id}`)
    },

    async deleteBlob(blobId: string): Promise<void> {
      await storage.blob.delete(blobId)
    },

    async clear(): Promise<void> {
      const index = await this.getIndex()
      for (const entry of index.entries) {
        await storage.kv.delete(`${KV_PREFIX_ITEMS}${entry.id}`)
      }
      await storage.kv.set(KV_KEY_INDEX, { entries: [], updatedAt: Date.now() })
    },
  }
}
