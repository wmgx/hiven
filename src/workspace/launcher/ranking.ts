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
  return searchableFieldsMatch(toSearchableFields(item, locale), q, locale)
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
  const matchScore = scoreSearchableFields(toSearchableFields(item, ctx.locale), q, ctx.locale, [], {})
  const textMatchBoost = ctx.contentText && item.textMatch
    ? (safeTextMatch(item.textMatch, ctx.contentText) ? TEXT_MATCH_BOOST : 0)
    : 0
  const dynamicBoost = item.kind === 'dynamic' ? DYNAMIC_ITEM_BOOST : 0
  return matchScore + usageScore(ctx, item) + pinnedBoost(ctx, item) + staticPriority(item) + installFreshnessScore(ctx, item) + textMatchBoost + dynamicBoost
}

function safeTextMatch(matcher: (text: string) => boolean, text: string): boolean {
  try { return matcher(text) } catch { return false }
}

/**
 * Rank items for a surface. In query-present mode, non-matching items are
 * dropped. In query-empty mode all items are kept and ordered by usage + pinned
 * + static priority. Stable: ties preserve input order.
 *
 * The result is capped at MAX_RANKED_RESULTS to avoid scoring and sorting
 * hundreds of items when only ~15 are visible in the launcher viewport.
 */
const MAX_RANKED_RESULTS = 50

export function rankLauncherItems(ctx: RankContext, items: LauncherItem[]): LauncherItem[] {
  const q = ctx.query.trim().toLowerCase()
  const candidates = q
    ? items.filter((item) => itemMatchesQuery(item, q, ctx.locale) || itemMatchesContent(item, ctx.contentText))
    : items.slice()

  // When there are far more candidates than can be displayed, score all but
  // only fully sort a partial set (partial sort via selection-like approach).
  const scored = candidates.map((item, index) => ({ item, index, score: scoreLauncherItem(ctx, item) }))
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index))

  const limit = Math.min(scored.length, MAX_RANKED_RESULTS)
  const result: LauncherItem[] = new Array(limit)
  for (let i = 0; i < limit; i++) {
    result[i] = scored[i].item
  }
  return result
}

/** Check if the item's textMatch function matches the content text. */
function itemMatchesContent(item: LauncherItem, contentText?: string): boolean {
  if (!contentText || !item.textMatch) return false
  return safeTextMatch(item.textMatch, contentText)
}
