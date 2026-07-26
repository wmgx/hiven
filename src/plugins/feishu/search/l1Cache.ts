/**
 * Short TTL cache + latest-query gate for L1 CLI searches.
 * Prevents intermediate keystrokes from stacking multi-second lark-cli processes.
 */

export type L1Domain = 'docs' | 'chats' | 'contacts'

type CacheEntry<T> = {
  at: number
  value: T
}

const TTL_MS = 45_000
const cache = new Map<string, CacheEntry<unknown>>()

/** Latest generation per domain — stale completions are dropped. */
const generationByDomain = new Map<L1Domain, number>()

export function l1CacheKey(domain: L1Domain, query: string): string {
  return `${domain}::${query.trim().toLowerCase()}`
}

export function getL1Cache<T>(domain: L1Domain, query: string): T | undefined {
  const key = l1CacheKey(domain, query)
  const hit = cache.get(key) as CacheEntry<T> | undefined
  if (!hit) return undefined
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key)
    return undefined
  }
  return hit.value
}

export function setL1Cache<T>(domain: L1Domain, query: string, value: T): void {
  cache.set(l1CacheKey(domain, query), { at: Date.now(), value })
  // Soft bound
  if (cache.size > 80) {
    const first = cache.keys().next().value
    if (first) cache.delete(first)
  }
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

export const L1_SEARCH_TIMEOUT_MS = 3500
export const L1_PAGE_SIZE = 8
