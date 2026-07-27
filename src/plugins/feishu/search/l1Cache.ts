/**
 * L1 CLI search cache for Feishu launcher mix-ins.
 *
 * Layers (fast → slow):
 * 1. Exact query result cache (10 min)
 * 2. Entity index local filter (30 days; visited up to 90 days, ranked first)
 * 3. Prefix parent query reuse (filter a broader cached result set)
 * 4. In-flight promise coalescing (same domain+query shares one CLI call)
 *
 * Visited (opened from launcher) entities are sticky: longer TTL, eviction
 * protection, and match-score boost so “我打开过的人/群/文档”优先秒开。
 */

export type L1Domain = 'docs' | 'chats' | 'contacts'

/** Minimum fields needed for local match + open. */
export type L1Matchable = {
  id: string
  title: string
  subtitle?: string
  keywords?: string[]
  openUrl?: string
  /** Lucide name, https avatar, or data:image SVG. */
  icon?: string
  meta?: { url?: string }
}

type CacheEntry<T> = {
  at: number
  value: T
}

type EntityEntry = {
  /** Last search/warm sighting. */
  at: number
  /** Last time user opened this entity from launcher. */
  accessedAt?: number
  accessCount: number
  row: L1Matchable
}

/** Exact query → rows. */
const QUERY_TTL_MS = 10 * 60_000
const MAX_QUERY_ENTRIES = 160

/** Seen via search/warm (not necessarily opened). */
const ENTITY_TTL_MS = 30 * 24 * 60 * 60_000 // 30 days
/** Opened from launcher — keep longer. */
const ENTITY_ACCESSED_TTL_MS = 90 * 24 * 60 * 60_000 // 90 days
const MAX_ENTITIES_PER_DOMAIN = 2000
/** Soft reserve for visited items during eviction. */
const MAX_ACCESSED_RESERVE = 800

const queryCache = new Map<string, CacheEntry<unknown>>()
const entityIndex = new Map<L1Domain, Map<string, EntityEntry>>()
const inflight = new Map<string, Promise<unknown>>()

/** Latest generation per domain — stale completions are dropped. */
const generationByDomain = new Map<L1Domain, number>()

export function l1CacheKey(domain: L1Domain, query: string): string {
  return `${domain}::${normalizeQuery(query)}`
}

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

export function getL1Cache<T>(domain: L1Domain, query: string): T | undefined {
  const key = l1CacheKey(domain, query)
  const hit = queryCache.get(key) as CacheEntry<T> | undefined
  if (!hit) return undefined
  if (Date.now() - hit.at > QUERY_TTL_MS) {
    queryCache.delete(key)
    return undefined
  }
  // LRU touch: re-insert
  queryCache.delete(key)
  queryCache.set(key, hit)
  return hit.value
}

export function setL1Cache<T>(domain: L1Domain, query: string, value: T): void {
  const key = l1CacheKey(domain, query)
  queryCache.set(key, { at: Date.now(), value })
  trimQueryCache()
  if (Array.isArray(value)) {
    rememberL1Entities(domain, value as L1Matchable[])
  }
}

function trimQueryCache(): void {
  while (queryCache.size > MAX_QUERY_ENTRIES) {
    const first = queryCache.keys().next().value
    if (first == null) break
    queryCache.delete(first)
  }
}

function ensureEntityMap(domain: L1Domain): Map<string, EntityEntry> {
  let map = entityIndex.get(domain)
  if (!map) {
    map = new Map()
    entityIndex.set(domain, map)
  }
  return map
}

function mergeRow(prev: L1Matchable | undefined, next: L1Matchable): L1Matchable {
  if (!prev) return { ...next }
  const keywords = [...new Set([...(prev.keywords ?? []), ...(next.keywords ?? [])].filter(Boolean))]
  return {
    id: next.id || prev.id,
    title: next.title || prev.title,
    subtitle: next.subtitle || prev.subtitle,
    keywords: keywords.length ? keywords : undefined,
    openUrl: next.openUrl || prev.openUrl,
    icon: next.icon || prev.icon,
    meta: next.meta ?? prev.meta,
  }
}

/**
 * Upsert rows into the long-lived entity index so later queries can match
 * without CLI (e.g. searched "孙文" → later "孙文韬" is instant).
 * Does not mark as visited.
 */
export function rememberL1Entities(domain: L1Domain, rows: L1Matchable[]): void {
  if (!rows.length) return
  const map = ensureEntityMap(domain)
  const now = Date.now()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const id = String(row.id ?? '').trim()
    if (!id) continue
    const prev = map.get(id)
    map.set(id, {
      at: now,
      accessedAt: prev?.accessedAt,
      accessCount: prev?.accessCount ?? 0,
      row: mergeRow(prev?.row, row),
    })
  }
  trimEntityMap(map)
}

/**
 * Mark entity as visited (user opened from launcher). Sticky retention + rank boost.
 */
export function touchL1EntityAccess(domain: L1Domain, row: L1Matchable): void {
  if (!row || typeof row !== 'object') return
  const id = String(row.id ?? '').trim()
  if (!id) return
  const map = ensureEntityMap(domain)
  const now = Date.now()
  const prev = map.get(id)
  map.set(id, {
    at: now,
    accessedAt: now,
    accessCount: (prev?.accessCount ?? 0) + 1,
    row: mergeRow(prev?.row, row),
  })
  trimEntityMap(map)
}

function isEntityAlive(entry: EntityEntry, now: number): boolean {
  if (entry.accessedAt != null) {
    return now - entry.accessedAt <= ENTITY_ACCESSED_TTL_MS
  }
  return now - entry.at <= ENTITY_TTL_MS
}

/**
 * Evict expired first; then non-visited oldest; never drop recent visited until reserve exceeded.
 */
function trimEntityMap(map: Map<string, EntityEntry>): void {
  const now = Date.now()
  for (const [id, entry] of map) {
    if (!isEntityAlive(entry, now)) map.delete(id)
  }
  if (map.size <= MAX_ENTITIES_PER_DOMAIN) return

  const entries = [...map.entries()]
  // Sort: non-visited first (by at), then visited (by accessedAt) — drop from front
  entries.sort((a, b) => {
    const aVisited = a[1].accessedAt != null
    const bVisited = b[1].accessedAt != null
    if (aVisited !== bVisited) return aVisited ? 1 : -1
    const aTime = aVisited ? (a[1].accessedAt ?? 0) : a[1].at
    const bTime = bVisited ? (b[1].accessedAt ?? 0) : b[1].at
    return aTime - bTime
  })

  let need = map.size - MAX_ENTITIES_PER_DOMAIN
  for (const [id, entry] of entries) {
    if (need <= 0) break
    // Keep a reserve of visited items when possible
    if (entry.accessedAt != null) {
      const visitedCount = [...map.values()].filter((e) => e.accessedAt != null).length
      if (visitedCount <= MAX_ACCESSED_RESERVE) continue
    }
    map.delete(id)
    need -= 1
  }
  // If still over (too many visited), drop oldest visited
  if (map.size > MAX_ENTITIES_PER_DOMAIN) {
    const visited = [...map.entries()]
      .filter(([, e]) => e.accessedAt != null)
      .sort((a, b) => (a[1].accessedAt ?? 0) - (b[1].accessedAt ?? 0))
    let extra = map.size - MAX_ENTITIES_PER_DOMAIN
    for (const [id] of visited) {
      if (extra <= 0) break
      map.delete(id)
      extra -= 1
    }
  }
}

function accessBoost(entry: EntityEntry | undefined, now: number): number {
  if (!entry?.accessedAt) return 0
  const age = now - entry.accessedAt
  // Opened in last day
  if (age < 24 * 60 * 60_000) return 35
  // Last week
  if (age < 7 * 24 * 60 * 60_000) return 28
  // Last month
  if (age < 30 * 24 * 60 * 60_000) return 22
  // Within 90d visited window
  return 15 + Math.min(10, entry.accessCount)
}

export function scoreL1Match(row: L1Matchable, query: string): number {
  const q = normalizeQuery(query)
  if (!q) return 0
  const title = normalizeQuery(row.title ?? '')
  if (!title && !(row.keywords?.length || row.subtitle)) return 0
  if (title === q) return 100
  if (title.startsWith(q)) return 92
  if (title.includes(q)) return 80

  const parts = [row.title ?? '', row.subtitle ?? '', ...(row.keywords ?? [])]
  const hay = normalizeQuery(parts.join(' '))
  if (hay.includes(q)) return 65

  // Sequential char match (useful for CJK progressive typing)
  let qi = 0
  for (let i = 0; i < title.length && qi < q.length; i++) {
    if (title[i] === q[qi]) qi += 1
  }
  if (qi === q.length && q.length >= 2) return 45

  return 0
}

export function filterL1Rows<T extends L1Matchable>(
  rows: T[],
  query: string,
  limit: number,
  boostById?: Map<string, number>,
): T[] {
  const scored: { row: T; score: number }[] = []
  for (const row of rows) {
    let score = scoreL1Match(row, query)
    if (score <= 0) continue
    if (boostById) score += boostById.get(row.id) ?? 0
    scored.push({ row, score })
  }
  scored.sort((a, b) => b.score - a.score || a.row.title.localeCompare(b.row.title))
  return scored.slice(0, limit).map((s) => s.row)
}

/** Filter entity index for domain; visited items get rank boost. */
export function queryL1Entities<T extends L1Matchable>(
  domain: L1Domain,
  query: string,
  limit: number,
): T[] {
  const map = entityIndex.get(domain)
  if (!map || map.size === 0) return []
  const now = Date.now()
  const alive: T[] = []
  const boost = new Map<string, number>()
  for (const [id, entry] of map) {
    if (!isEntityAlive(entry, now)) {
      map.delete(id)
      continue
    }
    alive.push(entry.row as T)
    const b = accessBoost(entry, now)
    if (b > 0) boost.set(id, b)
  }
  return filterL1Rows(alive, query, limit, boost)
}

/**
 * Reuse a broader cached query result when the user refined the query
 * (e.g. cache["孙文"] → filter for "孙文韬").
 */
export function queryL1PrefixCache<T extends L1Matchable>(
  domain: L1Domain,
  query: string,
  limit: number,
): T[] {
  const q = normalizeQuery(query)
  if (q.length < 2) return []
  const prefix = `${domain}::`
  const now = Date.now()
  let bestParent = ''
  let bestRows: T[] | undefined

  for (const [key, entry] of queryCache) {
    if (!key.startsWith(prefix)) continue
    if (now - entry.at > QUERY_TTL_MS) {
      queryCache.delete(key)
      continue
    }
    const cachedQ = key.slice(prefix.length)
    if (!cachedQ || cachedQ === q) continue
    // Current query refines a previous broader search
    if (q.startsWith(cachedQ) && cachedQ.length >= 2) {
      if (cachedQ.length > bestParent.length && Array.isArray(entry.value)) {
        bestParent = cachedQ
        bestRows = entry.value as T[]
      }
    }
  }
  if (!bestRows?.length) return []

  // Apply access boost from entity index when filtering prefix rows
  const map = entityIndex.get(domain)
  const boost = new Map<string, number>()
  if (map) {
    for (const row of bestRows) {
      const e = map.get(row.id)
      const b = accessBoost(e, now)
      if (b > 0) boost.set(row.id, b)
    }
  }
  return filterL1Rows(bestRows, q, limit, boost)
}

/**
 * Fast path: exact → entity index → prefix parent. No CLI.
 * Returns undefined when nothing usable (caller should fetch).
 */
export function getL1FastHits<T extends L1Matchable>(
  domain: L1Domain,
  query: string,
  limit: number,
): T[] | undefined {
  const exact = getL1Cache<T[]>(domain, query)
  if (exact) return exact.slice(0, limit)

  const fromEntities = queryL1Entities<T>(domain, query, limit)
  if (fromEntities.length > 0) return fromEntities

  const fromPrefix = queryL1PrefixCache<T>(domain, query, limit)
  if (fromPrefix.length > 0) return fromPrefix

  return undefined
}

/** Coalesce concurrent identical searches. */
export function withL1Inflight<T>(
  domain: L1Domain,
  query: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = l1CacheKey(domain, query)
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>
  const pending = (async () => {
    try {
      return await fn()
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, pending)
  return pending
}

/**
 * Resolve L1 list: fast local cache first, else single coalesced fetch.
 * On fetch success, writes exact cache + entity index.
 */
export async function resolveL1List<T extends L1Matchable>(options: {
  domain: L1Domain
  query: string
  limit: number
  signal?: AbortSignal
  fetch: () => Promise<T[]>
}): Promise<T[]> {
  const q = options.query.trim()
  if (!q) return []

  const fast = getL1FastHits<T>(options.domain, q, options.limit)
  if (fast) return fast

  if (options.signal?.aborted) return []

  return withL1Inflight(options.domain, q, async () => {
    // Another waiter may have filled cache while we queued
    const again = getL1FastHits<T>(options.domain, q, options.limit)
    if (again) return again
    if (options.signal?.aborted) return []

    const rows = await options.fetch()
    if (options.signal?.aborted) return rows.slice(0, options.limit)

    const sliced = rows.slice(0, options.limit)
    setL1Cache(options.domain, q, sliced)
    return sliced
  })
}

export function beginL1Generation(domain: L1Domain): number {
  const next = (generationByDomain.get(domain) ?? 0) + 1
  generationByDomain.set(domain, next)
  return next
}

export function isL1GenerationCurrent(domain: L1Domain, generation: number): boolean {
  return generationByDomain.get(domain) === generation
}

/**
 * Minimum query length before firing network/CLI for L1 mix-in.
 * Single CJK character is often too broad and very slow.
 */
export function isL1QueryReady(query: string): boolean {
  const q = query.trim()
  if (q.length < 2) return false
  // Pure latin: wait for 3 chars (IME / pinyin fragments are costly)
  if (/^[a-zA-Z0-9.\-_@]+$/.test(q) && q.length < 3) return false
  return true
}

/** Test / settings helper. */
export function clearL1Caches(): void {
  queryCache.clear()
  entityIndex.clear()
  inflight.clear()
  generationByDomain.clear()
}

export const L1_SEARCH_TIMEOUT_MS = 3500
export const L1_PAGE_SIZE = 8

/** Exposed for tests / diagnostics. */
export const L1_CACHE_TTL_MS = QUERY_TTL_MS
export const L1_ENTITY_TTL_MS = ENTITY_TTL_MS
export const L1_ENTITY_ACCESSED_TTL_MS = ENTITY_ACCESSED_TTL_MS
