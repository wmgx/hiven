/**
 * Plugin Private Storage — Host Implementation
 *
 * Provides per-plugin isolated KV storage (localStorage) and blob storage (in-memory + object URLs).
 * Plugins access this through PluginPrivateStorageApi; they never touch localStorage directly.
 */

import type { PluginPrivateStorageApi, PluginBlobRef, PluginStoragePrunePolicy, PluginPermissionSnapshot } from './pluginTypes'
import type { PluginSettingsSource } from './pluginSettingsStore'
import { requirePluginPermissions } from './pluginPermissions'

const KV_PREFIX = 'hiven-plugin-kv:'
const KV_META_PREFIX = 'hiven-plugin-kv-meta:'
const BLOB_PREFIX = 'hiven-plugin-blob:'

function kvKey(source: PluginSettingsSource, pluginId: string, key: string): string {
  return `${KV_PREFIX}${source}:${pluginId}:${key}`
}

function kvMetaKey(source: PluginSettingsSource, pluginId: string, key: string): string {
  return `${KV_META_PREFIX}${source}:${pluginId}:${key}`
}

function kvPrefixForPlugin(source: PluginSettingsSource, pluginId: string): string {
  return `${KV_PREFIX}${source}:${pluginId}:`
}

function kvMetaPrefixForPlugin(source: PluginSettingsSource, pluginId: string): string {
  return `${KV_META_PREFIX}${source}:${pluginId}:`
}

function blobKey(source: PluginSettingsSource, pluginId: string, blobId: string): string {
  return `${BLOB_PREFIX}${source}:${pluginId}:${blobId}`
}

function blobPrefixForPlugin(source: PluginSettingsSource, pluginId: string): string {
  return `${BLOB_PREFIX}${source}:${pluginId}:`
}

type BlobEntry = {
  bytes: Uint8Array
  contentType: string
  source: PluginSettingsSource
  pluginId: string
}

type StoredBlobEntry = {
  bytesBase64: string
  contentType: string
  updatedAt: number
}

// In-memory blob store is a cache over persisted per-plugin blob storage.
const blobStore = new Map<string, BlobEntry>()
const blobUrlCache = new Map<string, string>()
let blobCounter = 0

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function readPersistedBlob(source: PluginSettingsSource, pluginId: string, blobId: string): BlobEntry | undefined {
  const raw = localStorage.getItem(blobKey(source, pluginId, blobId))
  if (!raw) return undefined
  try {
    const stored = JSON.parse(raw) as StoredBlobEntry
    return {
      bytes: base64ToBytes(stored.bytesBase64),
      contentType: stored.contentType,
      source,
      pluginId,
    }
  } catch {
    return undefined
  }
}

function getBlobEntry(source: PluginSettingsSource, pluginId: string, blobId: string): BlobEntry | undefined {
  const cached = blobStore.get(blobId)
  if (cached && cached.pluginId === pluginId && cached.source === source) return cached
  const persisted = readPersistedBlob(source, pluginId, blobId)
  if (persisted) blobStore.set(blobId, persisted)
  return persisted
}

export function clearPluginPrivateStorage(source: PluginSettingsSource, pluginId: string): void {
  const prefixes = [kvPrefixForPlugin(source, pluginId), kvMetaPrefixForPlugin(source, pluginId), blobPrefixForPlugin(source, pluginId)]
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i)
    if (!key || !prefixes.some((prefix) => key.startsWith(prefix))) continue
    localStorage.removeItem(key)
  }

  for (const [blobId, entry] of Array.from(blobStore)) {
    if (entry.source !== source || entry.pluginId !== pluginId) continue
    blobStore.delete(blobId)
    const url = blobUrlCache.get(blobId)
    if (url) {
      URL.revokeObjectURL(url)
      blobUrlCache.delete(blobId)
    }
  }
}

export function createPluginPrivateStorage(
  source: PluginSettingsSource,
  pluginId: string,
  permissions?: PluginPermissionSnapshot,
): PluginPrivateStorageApi {
  const requireKv = () => {
    if (permissions) requirePluginPermissions(permissions, ['storage.private'])
  }
  const requireBlob = () => {
    if (permissions) requirePluginPermissions(permissions, ['storage.blob'])
  }

  return {
    kv: {
      async get<T = unknown>(key: string): Promise<T | undefined> {
        requireKv()
        const raw = localStorage.getItem(kvKey(source, pluginId, key))
        if (raw === null) return undefined
        try {
          return JSON.parse(raw) as T
        } catch {
          return undefined
        }
      },

      async set<T = unknown>(key: string, value: T): Promise<void> {
        requireKv()
        localStorage.setItem(kvKey(source, pluginId, key), JSON.stringify(value))
        localStorage.setItem(kvMetaKey(source, pluginId, key), JSON.stringify({ updatedAt: Date.now() }))
      },

      async delete(key: string): Promise<void> {
        requireKv()
        localStorage.removeItem(kvKey(source, pluginId, key))
        localStorage.removeItem(kvMetaKey(source, pluginId, key))
      },

      async list(prefix?: string): Promise<Array<{ key: string; updatedAt: number }>> {
        requireKv()
        const pluginPrefix = kvPrefixForPlugin(source, pluginId)
        const fullPrefix = prefix ? `${pluginPrefix}${prefix}` : pluginPrefix
        const results: Array<{ key: string; updatedAt: number }> = []

        for (let i = 0; i < localStorage.length; i++) {
          const storageKey = localStorage.key(i)
          if (!storageKey || !storageKey.startsWith(fullPrefix)) continue
          // Strip the plugin prefix to get the user-facing key
          const userKey = storageKey.slice(pluginPrefix.length)
          const metaRaw = localStorage.getItem(kvMetaKey(source, pluginId, userKey))
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
        requireBlob()
        const blobId = `blob-${source}-${pluginId}-${++blobCounter}-${Date.now().toString(36)}`
        blobStore.set(blobId, { bytes: input.bytes, contentType: input.contentType, source, pluginId })
        localStorage.setItem(blobKey(source, pluginId, blobId), JSON.stringify({
          bytesBase64: bytesToBase64(input.bytes),
          contentType: input.contentType,
          updatedAt: Date.now(),
        } satisfies StoredBlobEntry))
        return { blobId, byteSize: input.bytes.length, contentType: input.contentType }
      },

      async get(blobId: string): Promise<Uint8Array | undefined> {
        requireBlob()
        return getBlobEntry(source, pluginId, blobId)?.bytes
      },

      async delete(blobId: string): Promise<void> {
        requireBlob()
        const entry = blobStore.get(blobId)
        if (entry && (entry.pluginId !== pluginId || entry.source !== source)) return
        blobStore.delete(blobId)
        localStorage.removeItem(blobKey(source, pluginId, blobId))
        const url = blobUrlCache.get(blobId)
        if (url) {
          URL.revokeObjectURL(url)
          blobUrlCache.delete(blobId)
        }
      },

      async url(blobId: string): Promise<string> {
        requireBlob()
        const cached = blobUrlCache.get(blobId)
        if (cached) return cached
        const entry = getBlobEntry(source, pluginId, blobId)
        if (!entry) return ''
        const blob = new Blob([entry.bytes], { type: entry.contentType })
        const url = URL.createObjectURL(blob)
        blobUrlCache.set(blobId, url)
        return url
      },
    },

    quota: {
      async usage(): Promise<{ bytes: number; itemCount: number }> {
        requireKv()
        const pluginPrefix = kvPrefixForPlugin(source, pluginId)
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
        const blobPrefix = blobPrefixForPlugin(source, pluginId)
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (!key || !key.startsWith(blobPrefix)) continue
          const value = localStorage.getItem(key)
          if (value) {
            bytes += value.length * 2
            itemCount++
          }
        }
        return { bytes, itemCount }
      },

      async prune(policy: PluginStoragePrunePolicy): Promise<{ removedBytes: number; removedItems: number }> {
        requireKv()
        // Simple prune: remove oldest KV items if over limits
        let removedBytes = 0
        let removedItems = 0

        if (policy.maxItems || policy.maxBytes) {
          const pluginPrefix = kvPrefixForPlugin(source, pluginId)
          const items: Array<{ key: string; size: number; updatedAt: number }> = []

          for (let i = 0; i < localStorage.length; i++) {
            const storageKey = localStorage.key(i)
            if (!storageKey || !storageKey.startsWith(pluginPrefix)) continue
            const value = localStorage.getItem(storageKey)
            const userKey = storageKey.slice(pluginPrefix.length)
            const metaRaw = localStorage.getItem(kvMetaKey(source, pluginId, userKey))
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
            localStorage.removeItem(kvKey(source, pluginId, item.key))
            localStorage.removeItem(kvMetaKey(source, pluginId, item.key))
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
