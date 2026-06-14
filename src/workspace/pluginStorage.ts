/**
 * Plugin Private Storage — Host Implementation
 *
 * Provides per-plugin isolated KV storage (localStorage) and blob storage (in-memory + object URLs).
 * Plugins access this through PluginPrivateStorageApi; they never touch localStorage directly.
 */

import type { PluginPrivateStorageApi, PluginBlobRef, PluginStoragePrunePolicy } from './pluginTypes'

const KV_PREFIX = 'hiven-plugin-kv:'
const KV_META_PREFIX = 'hiven-plugin-kv-meta:'

function kvKey(pluginId: string, key: string): string {
  return `${KV_PREFIX}${pluginId}:${key}`
}

function kvMetaKey(pluginId: string, key: string): string {
  return `${KV_META_PREFIX}${pluginId}:${key}`
}

function kvPrefixForPlugin(pluginId: string): string {
  return `${KV_PREFIX}${pluginId}:`
}

// In-memory blob store (per session; images are cached here)
const blobStore = new Map<string, { bytes: Uint8Array; contentType: string; pluginId: string }>()
const blobUrlCache = new Map<string, string>()
let blobCounter = 0

export function createPluginPrivateStorage(pluginId: string): PluginPrivateStorageApi {
  return {
    kv: {
      async get<T = unknown>(key: string): Promise<T | undefined> {
        const raw = localStorage.getItem(kvKey(pluginId, key))
        if (raw === null) return undefined
        try {
          return JSON.parse(raw) as T
        } catch {
          return undefined
        }
      },

      async set<T = unknown>(key: string, value: T): Promise<void> {
        localStorage.setItem(kvKey(pluginId, key), JSON.stringify(value))
        localStorage.setItem(kvMetaKey(pluginId, key), JSON.stringify({ updatedAt: Date.now() }))
      },

      async delete(key: string): Promise<void> {
        localStorage.removeItem(kvKey(pluginId, key))
        localStorage.removeItem(kvMetaKey(pluginId, key))
      },

      async list(prefix?: string): Promise<Array<{ key: string; updatedAt: number }>> {
        const pluginPrefix = kvPrefixForPlugin(pluginId)
        const fullPrefix = prefix ? `${pluginPrefix}${prefix}` : pluginPrefix
        const results: Array<{ key: string; updatedAt: number }> = []

        for (let i = 0; i < localStorage.length; i++) {
          const storageKey = localStorage.key(i)
          if (!storageKey || !storageKey.startsWith(fullPrefix)) continue
          // Strip the plugin prefix to get the user-facing key
          const userKey = storageKey.slice(pluginPrefix.length)
          const metaRaw = localStorage.getItem(kvMetaKey(pluginId, userKey))
          let updatedAt = 0
          if (metaRaw) {
            try { updatedAt = JSON.parse(metaRaw).updatedAt ?? 0 } catch { /* ignore */ }
          }
          results.push({ key: userKey, updatedAt })
        }
        return results
      },
    },

    blob: {
      async put(input: { bytes: Uint8Array; contentType: string; extension?: string }): Promise<PluginBlobRef> {
        const blobId = `blob-${pluginId}-${++blobCounter}-${Date.now().toString(36)}`
        blobStore.set(blobId, { bytes: input.bytes, contentType: input.contentType, pluginId })
        return { blobId, byteSize: input.bytes.length, contentType: input.contentType }
      },

      async get(blobId: string): Promise<Uint8Array | undefined> {
        const entry = blobStore.get(blobId)
        if (!entry || entry.pluginId !== pluginId) return undefined
        return entry.bytes
      },

      async delete(blobId: string): Promise<void> {
        const entry = blobStore.get(blobId)
        if (entry && entry.pluginId === pluginId) {
          blobStore.delete(blobId)
          // Revoke object URL if cached
          const url = blobUrlCache.get(blobId)
          if (url) {
            URL.revokeObjectURL(url)
            blobUrlCache.delete(blobId)
          }
        }
      },

      async url(blobId: string): Promise<string> {
        const cached = blobUrlCache.get(blobId)
        if (cached) return cached
        const entry = blobStore.get(blobId)
        if (!entry || entry.pluginId !== pluginId) return ''
        const blob = new Blob([entry.bytes], { type: entry.contentType })
        const url = URL.createObjectURL(blob)
        blobUrlCache.set(blobId, url)
        return url
      },
    },

    quota: {
      async usage(): Promise<{ bytes: number; itemCount: number }> {
        const pluginPrefix = kvPrefixForPlugin(pluginId)
        let bytes = 0
        let itemCount = 0
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (!key || !key.startsWith(pluginPrefix)) continue
          const value = localStorage.getItem(key)
          if (value) {
            bytes += value.length * 2 // approximate: UTF-16
            itemCount++
          }
        }
        // Add blob sizes
        for (const [, entry] of blobStore) {
          if (entry.pluginId === pluginId) {
            bytes += entry.bytes.length
            itemCount++
          }
        }
        return { bytes, itemCount }
      },

      async prune(policy: PluginStoragePrunePolicy): Promise<{ removedBytes: number; removedItems: number }> {
        // Simple prune: remove oldest KV items if over limits
        let removedBytes = 0
        let removedItems = 0

        if (policy.maxItems || policy.maxBytes) {
          const pluginPrefix = kvPrefixForPlugin(pluginId)
          const items: Array<{ key: string; size: number; updatedAt: number }> = []

          for (let i = 0; i < localStorage.length; i++) {
            const storageKey = localStorage.key(i)
            if (!storageKey || !storageKey.startsWith(pluginPrefix)) continue
            const value = localStorage.getItem(storageKey)
            const userKey = storageKey.slice(pluginPrefix.length)
            const metaRaw = localStorage.getItem(kvMetaKey(pluginId, userKey))
            let updatedAt = 0
            if (metaRaw) {
              try { updatedAt = JSON.parse(metaRaw).updatedAt ?? 0 } catch { /* ignore */ }
            }
            items.push({ key: userKey, size: (value?.length ?? 0) * 2, updatedAt })
          }

          // Sort by updatedAt descending (keep newest)
          items.sort((a, b) => b.updatedAt - a.updatedAt)

          let totalBytes = items.reduce((sum, item) => sum + item.size, 0)
          let totalItems = items.length

          for (let i = items.length - 1; i >= 0; i--) {
            const shouldRemove =
              (policy.maxItems && totalItems > policy.maxItems) ||
              (policy.maxBytes && totalBytes > policy.maxBytes)
            if (!shouldRemove) break
            const item = items[i]
            localStorage.removeItem(kvKey(pluginId, item.key))
            localStorage.removeItem(kvMetaKey(pluginId, item.key))
            removedBytes += item.size
            removedItems++
            totalBytes -= item.size
            totalItems--
          }
        }

        return { removedBytes, removedItems }
      },
    },
  }
}
