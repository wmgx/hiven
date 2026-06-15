/**
 * Plugin Private Storage — Host Implementation
 *
 * Provides per-plugin isolated KV storage (localStorage) and native blob storage.
 * Plugins access this through PluginPrivateStorageApi; they never touch localStorage directly.
 */

import type { PluginPrivateStorageApi, PluginBlobRef, PluginStoragePrunePolicy, PluginPermissionSnapshot } from './pluginTypes'
import type { PluginSettingsSource } from './pluginSettingsStore'
import { requirePluginPermissions } from './pluginPermissions'

const KV_PREFIX = 'hiven-plugin-kv:'
const KV_META_PREFIX = 'hiven-plugin-kv-meta:'
const LEGACY_BLOB_PREFIX = 'hiven-plugin-blob:'
const legacyBlobCleanupDone = new Set<string>()

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

function legacyBlobPrefixForPlugin(source: PluginSettingsSource, pluginId: string): string {
  return `${LEGACY_BLOB_PREFIX}${source}:${pluginId}:`
}

type NativeBlobReadResult = {
  bytes: number[] | Uint8Array
  contentType: string
}

const blobUrlCache = new Map<string, string>()
let blobCounter = 0

function isTauri(): boolean {
  return !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(command, args)
}

function revokeCachedBlobUrl(blobId: string): void {
  const url = blobUrlCache.get(blobId)
  if (!url) return
  if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  blobUrlCache.delete(blobId)
}

function clearLegacyBlobLocalStorage(source: PluginSettingsSource, pluginId: string): void {
  const cleanupKey = `${source}:${pluginId}`
  if (legacyBlobCleanupDone.has(cleanupKey)) return
  legacyBlobCleanupDone.add(cleanupKey)

  const prefix = legacyBlobPrefixForPlugin(source, pluginId)
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i)
    if (!key?.startsWith(prefix)) continue
    localStorage.removeItem(key)
  }
}

export function clearPluginPrivateStorage(source: PluginSettingsSource, pluginId: string): void {
  const prefixes = [kvPrefixForPlugin(source, pluginId), kvMetaPrefixForPlugin(source, pluginId), legacyBlobPrefixForPlugin(source, pluginId)]
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i)
    if (!key || !prefixes.some((prefix) => key.startsWith(prefix))) continue
    localStorage.removeItem(key)
  }

  const blobIdPrefix = `blob-${source}-${pluginId}-`
  for (const blobId of Array.from(blobUrlCache.keys())) {
    if (!blobId.startsWith(blobIdPrefix)) continue
    revokeCachedBlobUrl(blobId)
  }

  if (isTauri()) {
    void invoke<void>('plugin_blob_clear', { source, pluginId }).catch((error) => {
      console.warn('[hiven] Failed to clear plugin blob storage:', error)
    })
  }
}

export function createPluginPrivateStorage(
  source: PluginSettingsSource,
  pluginId: string,
  permissions?: PluginPermissionSnapshot,
): PluginPrivateStorageApi {
  clearLegacyBlobLocalStorage(source, pluginId)

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
        if (!isTauri()) {
          throw new Error('Plugin blob storage requires the desktop app')
        }
        const blobId = `blob-${source}-${pluginId}-${++blobCounter}-${Date.now().toString(36)}`
        await invoke('plugin_blob_save', {
          source,
          pluginId,
          blobId,
          bytes: Array.from(input.bytes),
          contentType: input.contentType,
          extension: input.extension,
        })
        return { blobId, byteSize: input.bytes.length, contentType: input.contentType }
      },

      async get(blobId: string): Promise<Uint8Array | undefined> {
        requireBlob()
        if (!isTauri()) return undefined
        const result = await invoke<NativeBlobReadResult | null>('plugin_blob_read', { source, pluginId, blobId })
        if (!result) return undefined
        return result.bytes instanceof Uint8Array ? result.bytes : new Uint8Array(result.bytes)
      },

      async delete(blobId: string): Promise<void> {
        requireBlob()
        if (isTauri()) {
          await invoke<void>('plugin_blob_delete', { source, pluginId, blobId })
        }
        revokeCachedBlobUrl(blobId)
      },

      async url(blobId: string): Promise<string> {
        requireBlob()
        const cached = blobUrlCache.get(blobId)
        if (cached) return cached
        if (!isTauri()) return ''
        const path = await invoke<string | null>('plugin_blob_path', { source, pluginId, blobId })
        if (!path) return ''
        const { convertFileSrc } = await import('@tauri-apps/api/core')
        const url = convertFileSrc(path)
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
