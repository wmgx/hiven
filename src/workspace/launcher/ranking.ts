/**
 * Launcher Mixed Ranking
 *
 * One scoring pipeline for both surfaces. There is no "Common Features" group —
 * a single ranked list is produced.
 *
 *   score = matchScore + usageScore(surface) + pinnedBoost + hostStaticPriority
 *     + installFreshnessScore
 *
 * Rules (design doc §6):
 *  - Match relevance dominates (match tier contributes thousands; the rest are
 *    bounded well below one tier so a strong match always beats a weak match
 *    with high usage).
 *  - Usage is per surface.
 *  - Pinned is a mild boost, never absolute top placement.
 *  - Plugins cannot set static priority; only host-owned items may.
 *  - Query-empty and query-present modes use the same pipeline, different weights.
 */

import type { Locale } from '../../i18n'
import {
  scoreSearchableFields,
  searchableFieldsMatch,
  type SearchableFields,
} from '../searchRanking'
import type {
  LauncherItem,
  LauncherSurfaceId,
  LauncherUsageBySurface,
  SystemLauncherItemKey,
} from './types'
import { getUsageRecord } from './usage'
import { localizedDisplay } from './display'

// Bounded sub-components (kept below one match tier = 1000 so match dominates).
const USAGE_FREQ_WEIGHT = 6 // * log1p(count)  → ~ up to ~40 for very frequent
const USAGE_RECENCY_WEIGHT = 60 // decays over RECENCY_WINDOW_MS
const RECENCY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000 // 14 days
const INSTALL_FRESHNESS_WEIGHT = 70 // decays over INSTALL_FRESHNESS_WINDOW_MS
const INSTALL_FRESHNESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const PINNED_BOOST = 40 // mild; far below a one-tier (1000) jump
const MAX_STATIC_PRIORITY = 300 // host-only ceiling, still < 1000
const TEXT_MATCH_BOOST = 800 // strong boost when tool can process the content; below match tier (1000) so an exact name match still wins
const DYNAMIC_ITEM_BOOST = 900 // dynamic items are plugin-asserted matches; rank above static items without text match

export type RankContext = {
  query: string
  locale: Locale
  surfaceId: LauncherSurfaceId
  usage: LauncherUsageBySurface
  now: number
  /** Set of system item keys that are pinned (referenced by a pinned entry). */
  pinnedKeys?: Set<SystemLauncherItemKey>
  /** Text to test against textMatch (clipboard content or raw user input). */
  contentText?: string
}

/**
 * Per-ranking-call cache for toSearchableFields results.
 * Avoids repeated object allocation for the same item within a single ranking pass.
 */
let searchableFieldsCache: WeakMap<LauncherItem, SearchableFields> | null = null
let searchableFieldsCacheLocale: Locale | null = null

function getCachedSearchableFields(item: LauncherItem, locale: Locale): SearchableFields {
  if (searchableFieldsCache && searchableFieldsCacheLocale === locale) {
    const cached = searchableFieldsCache.get(item)
    if (cached) return cached
  }
  const fields = toSearchableFields(item, locale)
  if (searchableFieldsCache && searchableFieldsCacheLocale === locale) {
    searchableFieldsCache.set(item, fields)
  }
  return fields
}

function toSearchableFields(item: LauncherItem, locale: Locale): SearchableFields {
  return {
    id: item.systemKey,
    title: localizedDisplay(item.display.title, item.display.titleI18n, locale),
    titleI18n: item.display.titleI18n,
    description: item.display.subtitle,
    descriptionI18n: item.display.subtitleI18n,
    aliases: item.display.aliases,
    usageKey: item.systemKey,
  }
}

/** Whether the item matches the query at all (query-present mode filter). */
export function itemMatchesQuery(item: LauncherItem, query: string, locale: Locale): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return searchableFieldsMatch(getCachedSearchableFields(item, locale), q, locale)
}

/** Bounded usage contribution for a surface. Always < 1000. */
export function usageScore(ctx: RankContext, item: LauncherItem): number {
  let best = 0
  // Primary: the item's own system key.
  const keys: SystemLauncherItemKey[] = [item.systemKey, ...(item.legacyUsageKeys ?? [])]
  for (const key of keys) {
    const record = getUsageRecord(ctx.usage, ctx.surfaceId, key)
    if (!record) continue
    const freq = Math.log1p(record.count) * USAGE_FREQ_WEIGHT
    const age = Math.max(0, ctx.now - record.lastSelectedAt)
    const recency = age >= RECENCY_WINDOW_MS ? 0 : (1 - age / RECENCY_WINDOW_MS) * USAGE_RECENCY_WEIGHT
    best = Math.max(best, freq + recency)
  }
  return best
}

function pinnedBoost(ctx: RankContext, item: LauncherItem): number {
  return ctx.pinnedKeys?.has(item.systemKey) ? PINNED_BOOST : 0
}

function staticPriority(item: LauncherItem): number {
  // Only host-owned items may carry staticPriority; clamp to the ceiling.
  if (item.kind !== 'host' || item.staticPriority == null) return 0
  return Math.max(0, Math.min(MAX_STATIC_PRIORITY, item.staticPriority))
}

/** Small host-owned boost for newly installed applications. Always < 1000. */
export function installFreshnessScore(ctx: RankContext, item: LauncherItem): number {
  const installedAt = item.ranking?.installedAt
  if (!installedAt || installedAt > ctx.now) return 0
  const age = ctx.now - installedAt
  if (age >= INSTALL_FRESHNESS_WINDOW_MS) return 0
  return (1 - age / INSTALL_FRESHNESS_WINDOW_MS) * INSTALL_FRESHNESS_WEIGHT
}

/**
 * Score one item for one surface. Combines the shared match score (which uses
 * tier*1000 + small usage base) with launcher usage, pinned boost, and host
 * static priority.
 *
 * Note: `scoreSearchableFields` already adds a small recency/frequency base from
 * the *legacy* counts arrays. We pass empty arrays so launcher usage is the only
 * usage signal, keeping a single source of truth.
 */
export function scoreLauncherItem(ctx: RankContext, item: LauncherItem): number {
  const q = ctx.query.trim().toLowerCase()
  const matchScore = scoreSearchableFields(getCachedSearchableFields(item, ctx.locale), q, ctx.locale, [], {})
  const textMatchBoost = ctx.contentText && item.textMatch
    ? (safeTextMatch(item.textMatch, ctx.contentText) ? TEXT_MATCH_BOOST : 0)
    : 0
  const dynamicBoost = item.kind === 'dynamic' ? DYNAMIC_ITEM_BOOST : 0
  return matchScore + usageScore(ctx, item) + pinnedBoost(ctx, item) + staticPriority(item) + installFreshnessScore(ctx, item) + textMatchBoost + dynamicBoost
}

/** Maximum text length passed to plugin textMatch to prevent runaway matching. */
const TEXT_MATCH_MAX_LENGTH = 1000

function safeTextMatch(matcher: (text: string) => boolean, text: string): boolean {
  try {
    // Truncate excessively long text to prevent slow regex/matching in plugins
    const input = text.length > TEXT_MATCH_MAX_LENGTH ? text.slice(0, TEXT_MATCH_MAX_LENGTH) : text
    return matcher(input)
  } catch { return false }
}

/**
 * Rank items for a surface. In query-present mode, non-matching items are
 * dropped. In query-empty mode all items are kept and ordered by usage + pinned
 * + static priority. Stable: ties preserve input order.
 *
 * The result is capped at MAX_RANKED_RESULTS to avoid scoring and sorting
 * hundreds of items when only ~15 are visible in the launcher viewport.
 *
 * Uses a partial sort (quickselect-partition) when candidates exceed the limit,
 * avoiding a full O(n log n) sort for the entire array.
 */
const MAX_RANKED_RESULTS = 50

type ScoredItem = { item: LauncherItem; index: number; score: number }

export function rankLauncherItems(ctx: RankContext, items: LauncherItem[]): LauncherItem[] {
  // Initialize per-call cache
  searchableFieldsCache = new WeakMap()
  searchableFieldsCacheLocale = ctx.locale

  const q = ctx.query.trim().toLowerCase()
  // When query is present, filter strictly by name/keyword match only.
  // contentText (textMatch) only contributes to scoring, not filtering —
  // otherwise tools like Base64 that accept any text would appear for every query.
  const candidates = q
    ? items.filter((item) => itemMatchesQuery(item, q, ctx.locale))
    : items.slice()

  const scored: ScoredItem[] = candidates.map((item, index) => ({ item, index, score: scoreLauncherItem(ctx, item) }))

  const limit = Math.min(scored.length, MAX_RANKED_RESULTS)

  if (scored.length <= limit) {
    // Small enough — full sort is fine
    scored.sort((a, b) => (b.score - a.score) || (a.index - b.index))
  } else {
    // Partial sort: partition the top `limit` items, then sort only those
    partialSortTopK(scored, limit)
  }

  const result: LauncherItem[] = new Array(limit)
  for (let i = 0; i < limit; i++) {
    result[i] = scored[i].item
  }

  // Clear per-call cache
  searchableFieldsCache = null
  searchableFieldsCacheLocale = null

  return result
}

/**
 * In-place partial sort: ensures scored[0..k) contain the top-k items in
 * descending score order (ties broken by ascending index for stability).
 * Uses quickselect to partition, then sorts only the top-k portion.
 */
function partialSortTopK(arr: ScoredItem[], k: number): void {
  quickselect(arr, 0, arr.length - 1, k)
  // Sort only the top-k portion
  const top = arr.slice(0, k)
  top.sort((a, b) => (b.score - a.score) || (a.index - b.index))
  for (let i = 0; i < k; i++) arr[i] = top[i]
}

function scoredCompare(a: ScoredItem, b: ScoredItem): number {
  return (b.score - a.score) || (a.index - b.index)
}

/**
 * Quickselect: rearranges arr so that arr[0..k) contains the top-k elements
 * (not necessarily sorted). Average O(n).
 */
function quickselect(arr: ScoredItem[], lo: number, hi: number, k: number): void {
  while (lo < hi) {
    const pivotIndex = medianOfThree(arr, lo, hi)
    const p = partition(arr, lo, hi, pivotIndex)
    if (p === k) return
    if (p < k) {
      lo = p + 1
    } else {
      hi = p - 1
    }
  }
}

function medianOfThree(arr: ScoredItem[], lo: number, hi: number): number {
  const mid = (lo + hi) >>> 1
  if (scoredCompare(arr[lo], arr[mid]) > 0) swap(arr, lo, mid)
  if (scoredCompare(arr[lo], arr[hi]) > 0) swap(arr, lo, hi)
  if (scoredCompare(arr[mid], arr[hi]) > 0) swap(arr, mid, hi)
  return mid
}

function partition(arr: ScoredItem[], lo: number, hi: number, pivotIndex: number): number {
  const pivot = arr[pivotIndex]
  swap(arr, pivotIndex, hi)
  let store = lo
  for (let i = lo; i < hi; i++) {
    if (scoredCompare(arr[i], pivot) < 0) {
      swap(arr, i, store)
      store++
    }
  }
  swap(arr, store, hi)
  return store
}

function swap(arr: ScoredItem[], i: number, j: number): void {
  const tmp = arr[i]
  arr[i] = arr[j]
  arr[j] = tmp
}

/** Check if the item's textMatch function matches the content text. */
function itemMatchesContent(item: LauncherItem, contentText?: string): boolean {
  if (!contentText || !item.textMatch) return false
  return safeTextMatch(item.textMatch, contentText)
}
