/**
 * Launcher Mixed Ranking
 *
 * One scoring pipeline for both surfaces. There is no "Common Features" group —
 * a single ranked list is produced.
 *
 *   score = matchScore + usageScore(surface) + hostStaticPriority
 *     + installFreshnessScore + textMatchBoost + dynamicBoost
 *     + intentScore + contextBoost
 *
 * Rules:
 *  - Match relevance dominates (match tier contributes thousands; the rest are
 *    bounded well below one tier so a strong match always beats a weak match
 *    with high usage).
 *  - Intent slots are large (1.6k–2.4k) but still below exact title match (6k).
 *  - Usage is per surface.
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
const MAX_STATIC_PRIORITY = 300 // host-only ceiling, still < 1000
const TEXT_MATCH_BOOST = 800 // strong boost when tool can process the content; below match tier (1000) so an exact name match still wins
const DYNAMIC_ITEM_BOOST = 900 // dynamic items are plugin-asserted matches; rank above static items without text match

/** Content conf ≥ 0.85 or exact accepts.alias match. */
const INTENT_SCORE_STRONG = 2400
/** Weaker content intent (detected kind, conf > 0, or regex hit). */
const INTENT_SCORE_MEDIUM = 1600
/** Cap when combining alias/content intent pathways (they take max, not sum). */
const INTENT_SCORE_CAP = 2800
/** accepts.apps matches foregroundApp. */
const CONTEXT_BOOST_MAX = 400
/**
 * When clipboard/content is a strong text structure (jwt/json/…), demote host
 * app rows so content tools can rank above heavily-used apps. Pure `url` is
 * excluded so web-open / direct-open can still compete with apps.
 */
/** Demote host navigation targets (app/window/tab) under strong text content intent. */
const STRONG_TEXT_INTENT_NAV_PENALTY = 2500
const STRONG_TEXT_CONTENT_KINDS = new Set([
  'jwt',
  'json',
  'base64',
  'csv',
  'timestamp',
  'url-encoded',
  'yaml',
  'xml',
  'sql',
  'tsv',
  'query-string',
  'markdown',
  'secret',
  'secret-like',
])

export type RankContext = {
  query: string
  locale: Locale
  surfaceId: LauncherSurfaceId
  usage: LauncherUsageBySurface
  now: number
  /** Text to test against textMatch (clipboard content or raw user input). */
  contentText?: string
  /** Content detections from host (kind/confidence); drives intentScore. */
  detections?: Array<{ kind: string; confidence: number; normalized: string }>
  /** Foreground application name when available; drives contextBoost. */
  foregroundApp?: string
}

/** Inline normalize (trim + lower + collapse whitespace). Avoids intentEngine import for test harnesses that stub ranking imports. */
function normalizeIntentQueryLocal(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
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

function isHostAppLauncherItem(item: LauncherItem): boolean {
  return item.systemKey.startsWith('host:app-launcher:app:')
}

/** App / window / tab navigation rows eligible for strong-text demotion. */
function isDesktopNavigationItem(item: LauncherItem): boolean {
  if (isHostAppLauncherItem(item)) return true
  if (item.systemKey.startsWith('host:window:focus:')) return true
  if (item.systemKey.startsWith('host.window:')) return true
  if (item.systemKey.startsWith('host:tab:focus:')) return true
  if (item.systemKey.startsWith('browser.chromium:')) return true
  // DesktopTarget ids: host.window:… / host.app:…
  if (item.systemKey.startsWith('host.window:') || item.systemKey.startsWith('host.app:')) return true
  if (item.display.kindLabelI18n || item.requiredCapabilities?.includes('desktop-windows')) {
    if (item.systemKey.includes(':focus:') || item.systemKey.includes(':window:')) return true
  }
  return item.requiredCapabilities?.includes('desktop-browser-tabs') === true
}

/** True when detections include a high-confidence structured-text kind (not plain url). */
function hasStrongTextContentIntent(
  detections: RankContext['detections'] | undefined,
): boolean {
  if (!detections?.length) return false
  for (const d of detections) {
    if ((d.confidence ?? 0) >= 0.85 && STRONG_TEXT_CONTENT_KINDS.has(d.kind)) return true
  }
  return false
}

function toSearchableFields(item: LauncherItem, locale: Locale): SearchableFields {
  // Host app items: never match internal systemKey (path hashes) or filesystem
  // subtitles (.app paths). Title / titleI18n / human aliases only.
  if (isHostAppLauncherItem(item)) {
    return {
      id: '',
      title: localizedDisplay(item.display.title, item.display.titleI18n, locale),
      titleI18n: item.display.titleI18n,
      aliases: item.display.aliases,
      usageKey: item.systemKey,
    }
  }
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
  if (searchableFieldsMatch(getCachedSearchableFields(item, locale), q, locale)) return true
  // accepts.aliases alone can admit the item (exact normalized match).
  const aliases = item.accepts?.aliases
  if (aliases?.length) {
    const nq = normalizeIntentQueryLocal(query)
    if (nq && aliases.some((alias) => normalizeIntentQueryLocal(alias) === nq)) return true
  }
  return false
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
 * Intent score from accepts.aliases / accepts.kinds(+detections) / accepts.regex.
 * Takes max of alias and content pathways (not summed); capped at INTENT_SCORE_CAP.
 */
export function intentScore(item: LauncherItem, ctx: RankContext): number {
  const accepts = item.accepts
  if (!accepts) return 0

  let aliasScore = 0
  if (accepts.aliases?.length) {
    const nq = normalizeIntentQueryLocal(ctx.query ?? '')
    if (nq && accepts.aliases.some((alias) => normalizeIntentQueryLocal(alias) === nq)) {
      aliasScore = INTENT_SCORE_STRONG
    }
  }

  let contentScore = 0
  if (accepts.kinds?.length) {
    const detections = ctx.detections ?? []
    let maxConf = 0
    const kinds = accepts.kinds as readonly string[]
    for (const d of detections) {
      if (kinds.includes(d.kind)) {
        maxConf = Math.max(maxConf, d.confidence ?? 0)
      }
    }
    if (maxConf >= 0.85) contentScore = INTENT_SCORE_STRONG
    else if (maxConf > 0) contentScore = INTENT_SCORE_MEDIUM
  }

  if (accepts.regex) {
    const text = ctx.contentText ?? ''
    if (text) {
      try {
        if (new RegExp(accepts.regex).test(text)) {
          contentScore = Math.max(contentScore, INTENT_SCORE_MEDIUM)
        }
      } catch {
        // invalid regex — ignore
      }
    }
  }

  return Math.min(INTENT_SCORE_CAP, Math.max(aliasScore, contentScore))
}

/**
 * Context boost when accepts.apps matches foregroundApp (case-insensitive).
 */
export function contextBoost(item: LauncherItem, ctx: RankContext): number {
  const apps = item.accepts?.apps
  if (!apps?.length || !ctx.foregroundApp) return 0
  const fg = ctx.foregroundApp.toLowerCase()
  if (!fg) return 0
  if (apps.some((name) => name.toLowerCase() === fg)) return CONTEXT_BOOST_MAX
  return 0
}

/**
 * Score one item for one surface. Combines match score with launcher usage,
 * host static priority, install freshness, content textMatch, dynamic boost,
 * intent score, and context boost.
 *
 * Usage is solely from `launcherUsageBySurface` via {@link usageScore}.
 */
export function scoreLauncherItem(ctx: RankContext, item: LauncherItem): number {
  const q = ctx.query.trim().toLowerCase()
  const matchScore = scoreSearchableFields(getCachedSearchableFields(item, ctx.locale), q, ctx.locale)
  const textMatchBoost = ctx.contentText && item.textMatch
    ? (safeTextMatch(item.textMatch, ctx.contentText) ? TEXT_MATCH_BOOST : 0)
    : 0
  const dynamicBoost = item.kind === 'dynamic' ? DYNAMIC_ITEM_BOOST : 0
  const providerPriorityBoost = Math.max(
    0,
    Math.min(50, item.ranking?.providerPriorityBoost ?? 0),
  )
  let score =
    matchScore +
    usageScore(ctx, item) +
    staticPriority(item) +
    installFreshnessScore(ctx, item) +
    textMatchBoost +
    dynamicBoost +
    intentScore(item, ctx) +
    contextBoost(item, ctx) +
    providerPriorityBoost
  if (isDesktopNavigationItem(item) && hasStrongTextContentIntent(ctx.detections)) {
    score -= STRONG_TEXT_INTENT_NAV_PENALTY
  }
  return score
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
 * dropped. In query-empty mode all items are kept and ordered by usage +
 * static priority + content/dynamic boosts. Stable: ties preserve input order.
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
