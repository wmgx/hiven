/**
 * Favicon cache module for web-open plugin.
 * Fetches favicons via Google's favicon service, caches them in plugin blob + KV storage.
 * Memory cache keeps launcher path off the network hot path.
 */

import type { PluginPrivateStorageApi } from '@hiven/plugin'

const FAVICON_KV_PREFIX = 'favicon-map/'
const FAVICON_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const FAVICON_FETCH_TIMEOUT_MS = 3000
const FALLBACK_ICON = 'Globe'

type FaviconCacheEntry = {
  blobId: string
  fetchedAt: number
}

export type FaviconCacheListEntry = {
  domain: string
  blobId: string
  fetchedAt: number
  iconRef?: string
}

// In-memory cache to avoid repeated kv lookups within a session
const memoryCache = new Map<string, { iconRef: string; fetchedAt: number }>()
/** Domains currently warming via network so we do not stampede. */
const warmingDomains = new Set<string>()

export function extractDomain(urlOrTemplate: string): string | undefined {
  try {
    const cleaned = urlOrTemplate.replace(/\{query\}/g, 'placeholder')
    const url = new URL(cleaned)
    return url.hostname
  } catch {
    return undefined
  }
}

function buildFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`
}

function buildIconRef(source: string, pluginId: string, blobId: string): string {
  return `plugin-blob:${source}:${pluginId}:${blobId}`
}

function isExpired(fetchedAt: number): boolean {
  return Date.now() - fetchedAt > FAVICON_MAX_AGE_MS
}

/**
 * Resolve favicon for launcher list without blocking on network.
 * 1. Memory hit → icon immediately
 * 2. Otherwise return FALLBACK and warm plugin-internal cache in background
 */
export function resolveFaviconIconForLauncher(
  domain: string,
  storage: PluginPrivateStorageApi | undefined,
  source: string,
  pluginId: string,
): string {
  const memoryCached = memoryCache.get(domain)
  if (memoryCached && !isExpired(memoryCached.fetchedAt)) {
    return memoryCached.iconRef
  }

  if (storage) {
    warmFaviconCache(domain, storage, source, pluginId)
  }
  return FALLBACK_ICON
}

/** Fire-and-forget warm of plugin-internal favicon cache (kv + blob + memory). */
function warmFaviconCache(
  domain: string,
  storage: PluginPrivateStorageApi,
  source: string,
  pluginId: string,
): void {
  if (warmingDomains.has(domain)) return
  warmingDomains.add(domain)
  void getFaviconIcon(domain, storage, source, pluginId)
    .catch(() => FALLBACK_ICON)
    .finally(() => {
      warmingDomains.delete(domain)
    })
}

export async function getFaviconIcon(
  domain: string,
  storage: PluginPrivateStorageApi,
  source: string,
  pluginId: string,
): Promise<string> {
  // 1. Check memory cache
  const memoryCached = memoryCache.get(domain)
  if (memoryCached && !isExpired(memoryCached.fetchedAt)) {
    return memoryCached.iconRef
  }

  // 2. Check kv cache (plugin-internal)
  const kvKey = `${FAVICON_KV_PREFIX}${domain}`
  try {
    const cached = await storage.kv.get<FaviconCacheEntry>(kvKey)
    if (cached && cached.blobId && !isExpired(cached.fetchedAt)) {
      const iconRef = buildIconRef(source, pluginId, cached.blobId)
      memoryCache.set(domain, { iconRef, fetchedAt: cached.fetchedAt })
      return iconRef
    }

    // 3. Fetch favicon
    const faviconUrl = buildFaviconUrl(domain)
    const response = await fetchWithTimeout(faviconUrl, FAVICON_FETCH_TIMEOUT_MS)
    if (!response.ok) return FALLBACK_ICON

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length === 0) return FALLBACK_ICON

    const contentType = response.headers.get('content-type') || 'image/png'
    const extension = contentType.includes('svg') ? 'svg' : 'png'

    // 4. Store in blob
    const blobRef = await storage.blob.put({ bytes, contentType, extension })

    // 5. Update kv mapping
    const entry: FaviconCacheEntry = { blobId: blobRef.blobId, fetchedAt: Date.now() }
    await storage.kv.set(kvKey, entry)

    // 6. Delete old blob if existed
    if (cached && cached.blobId && cached.blobId !== blobRef.blobId) {
      await storage.blob.delete(cached.blobId).catch(() => {})
    }

    // 7. Update memory cache
    const iconRef = buildIconRef(source, pluginId, blobRef.blobId)
    memoryCache.set(domain, { iconRef, fetchedAt: entry.fetchedAt })
    return iconRef
  } catch {
    return FALLBACK_ICON
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Get favicon icon synchronously from memory cache only.
 * Returns FALLBACK_ICON if not cached yet.
 */
export function getFaviconIconSync(domain: string): string {
  const cached = memoryCache.get(domain)
  if (cached && !isExpired(cached.fetchedAt)) {
    return cached.iconRef
  }
  return FALLBACK_ICON
}

/** List plugin-internal favicon cache entries for the settings UI. */
export async function listFaviconCacheEntries(
  storage: PluginPrivateStorageApi,
  source: string,
  pluginId: string,
): Promise<FaviconCacheListEntry[]> {
  try {
    const keys = await storage.kv.list(FAVICON_KV_PREFIX)
    const results: FaviconCacheListEntry[] = []
    for (const { key } of keys) {
      if (!key.startsWith(FAVICON_KV_PREFIX)) continue
      const domain = key.slice(FAVICON_KV_PREFIX.length)
      if (!domain) continue
      const entry = await storage.kv.get<FaviconCacheEntry>(key)
      if (!entry?.blobId) continue
      const iconRef = buildIconRef(source, pluginId, entry.blobId)
      // Keep memory in sync for launcher path
      if (!isExpired(entry.fetchedAt)) {
        memoryCache.set(domain, { iconRef, fetchedAt: entry.fetchedAt })
      }
      results.push({
        domain,
        blobId: entry.blobId,
        fetchedAt: entry.fetchedAt,
        iconRef,
      })
    }
    results.sort((a, b) => b.fetchedAt - a.fetchedAt)
    return results
  } catch {
    return []
  }
}

/** Remove one domain from plugin-internal favicon cache. */
export async function removeFaviconCacheEntry(
  storage: PluginPrivateStorageApi,
  domain: string,
): Promise<void> {
  const kvKey = `${FAVICON_KV_PREFIX}${domain}`
  try {
    const cached = await storage.kv.get<FaviconCacheEntry>(kvKey)
    if (cached?.blobId) {
      await storage.blob.delete(cached.blobId).catch(() => {})
    }
    await storage.kv.delete(kvKey)
  } catch {
    // best effort
  }
  memoryCache.delete(domain)
}

/** Clear all plugin-internal favicon cache entries. */
export async function clearFaviconCache(storage: PluginPrivateStorageApi): Promise<number> {
  let removed = 0
  try {
    const keys = await storage.kv.list(FAVICON_KV_PREFIX)
    for (const { key } of keys) {
      if (!key.startsWith(FAVICON_KV_PREFIX)) continue
      const domain = key.slice(FAVICON_KV_PREFIX.length)
      const cached = await storage.kv.get<FaviconCacheEntry>(key)
      if (cached?.blobId) {
        await storage.blob.delete(cached.blobId).catch(() => {})
      }
      await storage.kv.delete(key)
      memoryCache.delete(domain)
      removed += 1
    }
  } catch {
    // best effort
  }
  return removed
}

export { FALLBACK_ICON, FAVICON_KV_PREFIX }
