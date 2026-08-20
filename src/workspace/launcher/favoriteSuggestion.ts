/**
 * Favorite suggestion (generic — pure).
 *
 * Decides what is worth KEEPING, which is a different question from what is
 * worth showing right now.
 *
 * The distinction that drives this: the doc you hammered all week ships on
 * Friday and is dead weight in a favorites list forever after, while the site
 * you have opened weekly for months is exactly what belongs there. Intensity
 * today says nothing about value next month — so suggestions are gated on the
 * visit PATTERN (see classifyVisitPattern), never on raw frequency. A burst is
 * never suggested, however hot it is.
 *
 * No urls, no site knowledge — visit timestamps and a "already kept?" flag.
 */

import { classifyVisitPattern, visitFrecency } from './visitFrecency'

/** Visits required before a pattern is treated as an established habit. */
const MIN_VISITS_FOR_HABIT = 8
/** At most this many suggestions at once — a wall of them is its own nagging. */
const MAX_SUGGESTIONS = 3

export interface FavoriteCandidate {
  /** Stable identity of the thing (e.g. a normalized URL), opaque here. */
  key?: string
  visits: readonly number[]
  /** Already kept — never suggest it again. */
  isFavorite: boolean
}

/**
 * True if this is worth offering to keep: an established habit, still alive,
 * with enough visits behind it, and not already a favorite.
 */
export function shouldSuggestFavorite(
  candidate: FavoriteCandidate,
  now: number = Date.now(),
): boolean {
  if (!candidate || candidate.isFavorite) return false
  const visits = candidate.visits ?? []
  if (visits.length < MIN_VISITS_FOR_HABIT) return false
  // 'habit' excludes both bursts and anything long abandoned.
  return classifyVisitPattern(visits, now) === 'habit'
}

/**
 * The candidates worth suggesting, strongest first, capped.
 */
export function suggestFavorites<T extends FavoriteCandidate>(
  candidates: readonly T[],
  now: number = Date.now(),
): T[] {
  return candidates
    .filter((candidate) => shouldSuggestFavorite(candidate, now))
    .map((candidate) => ({ candidate, score: visitFrecency(candidate.visits, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS)
    .map((scored) => scored.candidate)
}
