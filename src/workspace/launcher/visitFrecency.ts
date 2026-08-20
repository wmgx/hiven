/**
 * Two-scale visit frecency (generic — pure).
 *
 * Ranks anything the user returns to (browser tabs, history entries, pages) from
 * nothing but visit timestamps. No urls, no site lists, no product semantics.
 *
 * Why two scales: a single decay rate cannot rank both kinds of returning:
 *
 *   habit  — an AI site opened a few times a week for months
 *   burst  — the PRD / MR / design doc for the feature shipping this week,
 *            cold the moment it ships
 *
 * A slow half-life leaves shipped bursts cluttering the list for weeks; a fast
 * one forgets habits over a quiet stretch. So we score on both scales and keep
 * the better one.
 *
 * The catch that makes it work: a dead burst still scores well on the SLOW scale
 * (25 visits, 20 days cold, 45-day half-life → most of the weight survives). So
 * the slow scale is gated on how long the visits actually SPAN — three days of
 * frantic clicking cannot masquerade as a months-long habit no matter how many
 * visits it packs in.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Captures "what I'm working on right now" — a week off and it's gone. */
const FAST_HALF_LIFE_MS = 2 * DAY_MS
/** Captures "what I always come back to" — survives quiet stretches. */
const SLOW_HALF_LIFE_MS = 45 * DAY_MS
/**
 * Visit span at which something counts as a fully-established habit. Below this
 * the slow score is scaled down proportionally, so short-lived bursts can't earn
 * habit-scale staying power.
 */
const HABIT_SPAN_MS = 30 * DAY_MS
/** A burst is "still hot" while its newest visit is within this window. */
const BURST_HOT_MS = 3 * DAY_MS

/** Exponentially-weighted visit count at one time scale. */
function decayedCount(visits: readonly number[], now: number, halfLife: number): number {
  let total = 0
  for (const ts of visits) {
    // Clamp future timestamps (clock skew) to "just now" rather than letting
    // a negative age blow the exponent up.
    const age = Math.max(0, now - ts)
    total += Math.pow(0.5, age / halfLife)
  }
  return total
}

/** Milliseconds between the first and last visit. */
function visitSpan(visits: readonly number[]): number {
  if (visits.length < 2) return 0
  let min = Infinity
  let max = -Infinity
  for (const ts of visits) {
    if (ts < min) min = ts
    if (ts > max) max = ts
  }
  return Math.max(0, max - min)
}

/** Most recent visit, or null. */
function lastVisit(visits: readonly number[]): number | null {
  let max: number | null = null
  for (const ts of visits) {
    if (max === null || ts > max) max = ts
  }
  return max
}

/**
 * How habit-like this visit pattern is, 0–1, from its span alone.
 * This is the gate that stops a 3-day sprint from scoring as a 3-month habit.
 */
function habitFactor(visits: readonly number[]): number {
  return Math.min(1, visitSpan(visits) / HABIT_SPAN_MS)
}

/**
 * Rank score for a set of visit timestamps. Higher = should appear sooner.
 * Returns 0 for no visits. Never negative, never NaN.
 */
export function visitFrecency(visits: readonly number[], now: number = Date.now()): number {
  if (visits.length === 0) return 0

  // Normalize each scale by its own half-life before comparing them. Raw decayed
  // counts are NOT comparable across scales: a slow half-life keeps far more of
  // the history in scope, so it always accumulates more and would win every
  // max(). Dividing by the half-life turns both into the same unit — visits per
  // day at that time scale — so "7.8/day right now" can be weighed against
  // "0.7/day as a long-run habit".
  const fast = decayedCount(visits, now, FAST_HALF_LIFE_MS) / (FAST_HALF_LIFE_MS / DAY_MS)
  const slow = (decayedCount(visits, now, SLOW_HALF_LIFE_MS) * habitFactor(visits))
    / (SLOW_HALF_LIFE_MS / DAY_MS)

  // max, not sum: the two scales describe different reasons to surface
  // something, and summing would let a long-lived habit permanently outrank
  // whatever the user is actually doing today.
  return Math.max(fast, slow)
}

export type VisitPattern = 'habit' | 'burst' | 'stale'

/**
 * Classify why (or whether) something deserves to surface. Exposed for grouping
 * and for reading telemetry — the score alone doesn't say which scale won.
 *
 *   habit — visits span long enough to be a routine
 *   burst — short-lived but currently hot
 *   stale — short-lived and cold, or long abandoned
 */
export function classifyVisitPattern(
  visits: readonly number[],
  now: number = Date.now(),
): VisitPattern {
  const last = lastVisit(visits)
  if (last === null) return 'stale'
  const hot = now - last <= BURST_HOT_MS
  if (habitFactor(visits) >= 1) {
    // An established habit that has gone quiet for many half-lives is stale too.
    return now - last > SLOW_HALF_LIFE_MS ? 'stale' : 'habit'
  }
  return hot ? 'burst' : 'stale'
}

/**
 * Score from a browser-history SUMMARY rather than real timestamps.
 *
 * Chrome's history API exposes only `visitCount` + `lastVisitTime` — no visit
 * list, no first-visit time — so the span signal that separates a habit from a
 * burst is simply not available from that source. This approximates it: recency
 * decays on the fast scale, and volume is treated as weak habit evidence on the
 * slow scale (log-damped, because a count with no time distribution behind it
 * says much less than the same count spread over months).
 *
 * Prefer {@link visitFrecency} with observed timestamps wherever they exist;
 * this is the cold-start path.
 */
export function visitFrecencyFromSummary(
  visitCount: number,
  lastVisitTime: number | null | undefined,
  now: number = Date.now(),
): number {
  const count = Math.max(0, visitCount || 0)
  if (count === 0 || lastVisitTime == null) return 0
  const age = Math.max(0, now - lastVisitTime)

  // Recency on the fast scale — one visit's worth of "is this hot right now".
  const hot = Math.pow(0.5, age / FAST_HALF_LIFE_MS) * count / (FAST_HALF_LIFE_MS / DAY_MS)
  // Volume on the slow scale, log-damped: 500 visits is meaningfully more than
  // 50, but not 10× more, and without a span we can't tell habit from binge.
  const volume = Math.log1p(count) * Math.pow(0.5, age / SLOW_HALF_LIFE_MS)
    / (SLOW_HALF_LIFE_MS / DAY_MS)
  return Math.max(hot, volume)
}

export interface VisitFrecencyEntry {
  visits: readonly number[]
}

/**
 * Sort entries by visit frecency, strongest first. Stable for equal scores
 * (Array.prototype.sort is stable), so callers can pre-order deterministically.
 */
export function rankByVisitFrecency<T extends VisitFrecencyEntry>(
  entries: readonly T[],
  now: number = Date.now(),
): T[] {
  return entries
    .map((entry) => ({ entry, score: visitFrecency(entry.visits, now) }))
    .sort((a, b) => b.score - a.score)
    .map((scored) => scored.entry)
}
