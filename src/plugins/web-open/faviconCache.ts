/**
 * Favicon cache module for web-open plugin.
 * Fetches favicons via Google's favicon service, caches them in plugin blob storage.
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

// In-memory cache to avoid repeated kv lookups within a session
const memoryCache = new Map<string, { iconRef: string; fetchedAt: number }>()

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

  // 2. Check kv cache
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
 * Use this in contexts where async is not ideal for display.
 */
export function getFaviconIconSync(domain: string): string {
  const cached = memoryCache.get(domain)
  if (cached && !isExpired(cached.fetchedAt)) {
    return cached.iconRef
  }
  return FALLBACK_ICON
}

export { FALLBACK_ICON }
