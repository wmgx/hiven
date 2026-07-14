/**
 * Favicon cache module for web-open plugin.
 *
 * Prefer the site's own icons (many internal hosts don't work with Google s2).
 * Fetch via plugin network (Tauri reqwest — no CORS) with responseType binary,
 * then store in plugin blob. Host only ever sees plugin-blob:* or Globe.
 */

import type { PluginNetworkApi, PluginPrivateStorageApi } from '@hiven/plugin'

const FAVICON_KV_PREFIX = 'favicon-map/'
const FAVICON_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const FAVICON_FETCH_TIMEOUT_MS = 4000
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

/**
 * Candidate image URLs for a domain, origin-first then public CDN.
 * cloud.bytedance.net uses /logo.png (favicon.ico returns HTML).
 */
export function domainFaviconCandidates(domain: string, size = 64): string[] {
  const host = domain.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
  if (!host) return []
  return [
    `https://${host}/logo.png`,
    `https://${host}/favicon.png`,
    `https://${host}/apple-touch-icon.png`,
    `https://${host}/apple-touch-icon-precomposed.png`,
    `https://${host}/favicon.ico`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`,
  ]
}

function buildIconRef(source: string, pluginId: string, blobId: string): string {
  return `plugin-blob:${source}:${pluginId}:${blobId}`
}

function isExpired(fetchedAt: number): boolean {
  return Date.now() - fetchedAt > FAVICON_MAX_AGE_MS
}

function isImageContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase()
  return ct.startsWith('image/') || ct.includes('icon') || ct.includes('svg')
}

function looksLikeImageBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && (bytes[2] === 0x01 || bytes[2] === 0x02)) return true
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return true
  const head = new TextDecoder().decode(bytes.slice(0, 64)).trimStart()
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return true
  return false
}

function guessContentType(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif'
  if (bytes[0] === 0x00 && bytes[1] === 0x00) return 'image/x-icon'
  const head = new TextDecoder().decode(bytes.slice(0, 32)).trimStart()
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml'
  return 'image/png'
}

/**
 * Resolve favicon for launcher list without blocking on network.
 * 1. Memory hit → plugin-blob ref
 * 2. Otherwise FALLBACK and warm blob cache in background (needs network)
 */
export function resolveFaviconIconForLauncher(
  domain: string,
  storage: PluginPrivateStorageApi | undefined,
  source: string,
  pluginId: string,
  network?: PluginNetworkApi,
): string {
  const memoryCached = memoryCache.get(domain)
  if (memoryCached && !isExpired(memoryCached.fetchedAt)) {
    return memoryCached.iconRef
  }

  if (storage && network) {
    warmFaviconCache(domain, storage, source, pluginId, network)
  }
  return FALLBACK_ICON
}

/** Fire-and-forget warm of plugin-internal favicon cache (kv + blob + memory). */
export function warmFaviconCache(
  domain: string,
  storage: PluginPrivateStorageApi,
  source: string,
  pluginId: string,
  network: PluginNetworkApi,
): void {
  const host = domain.trim()
  if (!host) return
  if (warmingDomains.has(host)) return
  warmingDomains.add(host)
  void getFaviconIcon(host, storage, source, pluginId, network)
    .catch((error) => {
      if (import.meta.env.DEV) {
        console.warn('[web-open] favicon warm failed:', host, error)
      }
      return FALLBACK_ICON
    })
    .finally(() => {
      warmingDomains.delete(host)
    })
}

/**
 * Warm favicons for many domains (settings save / startup).
 * Dedupes and skips in-flight domains. Does not block.
 */
export function warmFaviconDomains(
  domains: Iterable<string>,
  storage: PluginPrivateStorageApi,
  source: string,
  pluginId: string,
  network: PluginNetworkApi,
): void {
  const seen = new Set<string>()
  for (const raw of domains) {
    const host = raw.trim()
    if (!host || seen.has(host)) continue
    seen.add(host)
    warmFaviconCache(host, storage, source, pluginId, network)
  }
}

async function fetchFaviconImage(
  domain: string,
  network: PluginNetworkApi,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const candidates = domainFaviconCandidates(domain)
  for (const url of candidates) {
    try {
      const response = await Promise.race([
        network.request({ url, method: 'GET', responseType: 'binary' }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('favicon fetch timeout')), FAVICON_FETCH_TIMEOUT_MS)
        }),
      ])
      if (response.status < 200 || response.status >= 300) continue
      const contentType = response.headers['content-type']
        ?? response.headers['Content-Type']
        ?? ''
      if (contentType && !isImageContentType(contentType) && !contentType.includes('octet-stream')) {
        continue
      }
      if (!response.bodyBytes || response.bodyBytes.length === 0) continue
      const bytes = new Uint8Array(response.bodyBytes)
      if (!looksLikeImageBytes(bytes)) continue
      const resolvedType = contentType && isImageContentType(contentType)
        ? contentType.split(';')[0]!.trim()
        : guessContentType(bytes)
      return { bytes, contentType: resolvedType }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[web-open] favicon candidate failed:', url, error)
      }
    }
  }
  return null
}

export async function getFaviconIcon(
  domain: string,
  storage: PluginPrivateStorageApi,
  source: string,
  pluginId: string,
  network: PluginNetworkApi,
): Promise<string> {
  const memoryCached = memoryCache.get(domain)
  if (memoryCached && !isExpired(memoryCached.fetchedAt)) {
    return memoryCached.iconRef
  }

  const kvKey = `${FAVICON_KV_PREFIX}${domain}`
  try {
    const cached = await storage.kv.get<FaviconCacheEntry>(kvKey)
    if (cached && cached.blobId && !isExpired(cached.fetchedAt)) {
      const iconRef = buildIconRef(source, pluginId, cached.blobId)
      memoryCache.set(domain, { iconRef, fetchedAt: cached.fetchedAt })
      return iconRef
    }

    const image = await fetchFaviconImage(domain, network)
    if (!image) return FALLBACK_ICON

    const extension = image.contentType.includes('svg')
      ? 'svg'
      : image.contentType.includes('jpeg') || image.contentType.includes('jpg')
        ? 'jpg'
        : image.contentType.includes('gif')
          ? 'gif'
          : image.contentType.includes('icon')
            ? 'ico'
            : 'png'

    try {
      const blobRef = await storage.blob.put({
        bytes: image.bytes,
        contentType: image.contentType,
        extension,
      })

      const entry: FaviconCacheEntry = { blobId: blobRef.blobId, fetchedAt: Date.now() }
      await storage.kv.set(kvKey, entry)

      if (cached && cached.blobId && cached.blobId !== blobRef.blobId) {
        await storage.blob.delete(cached.blobId).catch(() => {})
      }

      const iconRef = buildIconRef(source, pluginId, blobRef.blobId)
      memoryCache.set(domain, { iconRef, fetchedAt: entry.fetchedAt })
      return iconRef
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[web-open] favicon blob put failed:', domain, error)
      }
      return FALLBACK_ICON
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[web-open] favicon get failed:', domain, error)
    }
    return FALLBACK_ICON
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

/**
 * Read favicon from memory + plugin kv only (no network, no blob put).
 */
export async function getCachedFaviconIcon(
  domain: string,
  storage: PluginPrivateStorageApi,
  source: string,
  pluginId: string,
): Promise<string | undefined> {
  const memoryCached = memoryCache.get(domain)
  if (memoryCached && !isExpired(memoryCached.fetchedAt)) {
    return memoryCached.iconRef
  }

  const kvKey = `${FAVICON_KV_PREFIX}${domain}`
  try {
    const cached = await storage.kv.get<FaviconCacheEntry>(kvKey)
    if (cached && cached.blobId && !isExpired(cached.fetchedAt)) {
      const iconRef = buildIconRef(source, pluginId, cached.blobId)
      memoryCache.set(domain, { iconRef, fetchedAt: cached.fetchedAt })
      return iconRef
    }
  } catch {
    // ignore
  }
  return undefined
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
