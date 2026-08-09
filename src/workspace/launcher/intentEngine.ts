/**
 * Two-level hybrid Intent engine.
 *
 *   evaluateAccepts(accepts, ctx) → boolean   pure data filter; never calls match
 *   passesIntentMatchFilter(match, ctx) → boolean   optional fine filter
 *   runIntentMatchers(matchers, ctx, options?) → IntentHit[]
 *
 * Match semantics (single, locked for production ranking + recommendation):
 *   **filter** — after accepts hits, optional match() must return a non-empty
 *   IntentHit[] within budget; empty/null/throw/timeout → intent does not apply.
 *   Match is not a separate score pathway and does not inject extra list rows.
 */

import type {
  ContentAccepts,
  IntentHit,
  IntentMatchContext,
  IntentMatcher,
  IntentRunOptions,
} from './intentTypes'

const DEFAULT_MATCH_TIMEOUT_MS = 8
const DEFAULT_MAX_HITS_PER_PLUGIN = 3
const DEFAULT_MAX_HITS_GLOBAL = 12

/** Lowercase + collapse internal whitespace + trim. */
export function normalizeIntentQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function defaultNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

/**
 * Pure-data accepts evaluation. Does not call plugin match functions.
 * Missing / undefined accepts → false (item does not participate in intent).
 *
 * Pathway OR (content | alias | apps):
 *   - content path active when kinds and/or regex declared; declared dimensions AND
 *   - alias path active when aliases declared
 *   - apps path active when apps declared
 *   - final true when at least one active path succeeds
 *   - no path active (e.g. {}) → vacuous true
 */
export function evaluateAccepts(
  accepts: ContentAccepts | undefined | null,
  ctx: IntentMatchContext,
): boolean {
  if (accepts == null) return false

  const hasKinds = accepts.kinds !== undefined
  const hasRegex = accepts.regex !== undefined
  const hasAliases = accepts.aliases !== undefined
  const hasApps = accepts.apps !== undefined

  const contentActive = hasKinds || hasRegex
  const aliasActive = hasAliases
  const appsActive = hasApps

  // No pathway declared → vacuous true (e.g. accepts is {}).
  if (!contentActive && !aliasActive && !appsActive) return true

  if (contentActive) {
    let contentOk = true
    if (hasKinds) {
      const kinds = accepts.kinds!
      const detections = ctx.detections ?? []
      contentOk = detections.some((d) => kinds.includes(d.kind))
    }
    if (contentOk && hasRegex) {
      const text = ctx.contentText ?? ''
      try {
        contentOk = new RegExp(accepts.regex!).test(text)
      } catch {
        contentOk = false
      }
    }
    if (contentOk) return true
  }

  if (aliasActive) {
    const normalizedQuery = normalizeIntentQuery(ctx.query ?? '')
    const aliases = accepts.aliases!
    const ok = aliases.some((alias) => normalizeIntentQuery(alias) === normalizedQuery)
    if (ok) return true
  }

  if (appsActive) {
    const app = (ctx.foregroundApp ?? '').toLowerCase()
    if (app) {
      const apps = accepts.apps!
      const ok = apps.some((name) => name.toLowerCase() === app)
      if (ok) return true
    }
  }

  // At least one path was active, but none succeeded.
  return false
}

/**
 * Optional match fine-filter (filter semantics).
 * - no match fn → pass (accepts alone is enough)
 * - non-empty IntentHit[] within budget → pass
 * - empty / null / throw / timeout → fail
 */
export function passesIntentMatchFilter(
  match: IntentMatcher['match'] | undefined | null,
  ctx: IntentMatchContext,
  options?: Pick<IntentRunOptions, 'matchTimeoutMs' | 'now'>,
): boolean {
  if (typeof match !== 'function') return true

  const matchTimeoutMs = options?.matchTimeoutMs ?? DEFAULT_MATCH_TIMEOUT_MS
  const now = options?.now ?? defaultNow
  const t0 = now()
  try {
    const produced = match(ctx)
    if (now() - t0 > matchTimeoutMs) return false
    if (produced == null || !Array.isArray(produced) || produced.length === 0) return false
    return true
  } catch {
    return false
  }
}

/**
 * Combined eligibility: accepts coarse filter then optional match fine filter.
 * This is the production path used by ranking intentScore and content recommend.
 */
export function isIntentEligible(
  accepts: ContentAccepts | undefined | null,
  match: IntentMatcher['match'] | undefined | null,
  ctx: IntentMatchContext,
  options?: Pick<IntentRunOptions, 'matchTimeoutMs' | 'now'>,
): boolean {
  if (!evaluateAccepts(accepts, ctx)) return false
  return passesIntentMatchFilter(match, ctx, options)
}

/**
 * Run intent matchers:
 *  - sort by priority desc (optional priority, default 0)
 *  - skip match when accepts fails
 *  - no match field → no hits
 *  - match throw → catch and continue
 *  - soft timeout via now() budget → discard that matcher's hits
 *  - per-plugin / global caps
 */
export function runIntentMatchers(
  matchers: readonly IntentMatcher[],
  ctx: IntentMatchContext,
  options?: IntentRunOptions,
): IntentHit[] {
  const matchTimeoutMs = options?.matchTimeoutMs ?? DEFAULT_MATCH_TIMEOUT_MS
  const maxHitsPerPlugin = options?.maxHitsPerPlugin ?? DEFAULT_MAX_HITS_PER_PLUGIN
  const maxHitsGlobal = options?.maxHitsGlobal ?? DEFAULT_MAX_HITS_GLOBAL
  const now = options?.now ?? defaultNow

  const ordered = matchers
    .map((m, index) => ({ m, index }))
    .sort((a, b) => {
      const pa = a.m.priority ?? 0
      const pb = b.m.priority ?? 0
      if (pb !== pa) return pb - pa
      return a.index - b.index
    })
    .map(({ m }) => m)

  const hits: IntentHit[] = []
  const perPluginCount = new Map<string, number>()

  for (const matcher of ordered) {
    if (hits.length >= maxHitsGlobal) break

    if (!evaluateAccepts(matcher.accepts, ctx)) {
      continue
    }

    if (typeof matcher.match !== 'function') {
      continue
    }

    let produced: IntentHit[] | null = null
    const t0 = now()
    try {
      produced = matcher.match(ctx)
    } catch {
      continue
    }
    const elapsed = now() - t0
    if (elapsed > matchTimeoutMs) {
      continue
    }

    if (produced == null || !Array.isArray(produced) || produced.length === 0) {
      continue
    }

    const pluginId = matcher.pluginId
    let kept = perPluginCount.get(pluginId) ?? 0

    for (const hit of produced) {
      if (hits.length >= maxHitsGlobal) break
      if (kept >= maxHitsPerPlugin) break
      hits.push(hit)
      kept += 1
    }
    perPluginCount.set(pluginId, kept)
  }

  return hits
}
