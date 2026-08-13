/**
 * Self-learning · frecency (P3, generic — pure).
 *
 * A learned rule's live weight decays with time since last use (exponential
 * half-life), so rules you keep using stay strong and rank high, while ones you
 * never fire fade and eventually get forgotten. Firing bumps strength; the rest
 * is time. Pure: no imports, no side effects — the store/fire layers apply it.
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §4.4 (⑥) / §8 (P3).
 */

/** Weight bump applied each time a rule fires (typed token → opened). */
export const FIRE_STRENGTH_BONUS = 1

const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
/** Below this effective weight a rule is considered forgotten. */
const FORGET_FLOOR = 0.75

export interface FrecencyRule {
  strength: number
  createdAt: number
  lastUsedAt?: number
}

/** Time-decayed weight: strength halved for every 30 days since last use. */
export function effectiveStrength(rule: FrecencyRule, now: number = Date.now()): number {
  const reference = rule.lastUsedAt ?? rule.createdAt
  const age = Math.max(0, now - reference)
  return rule.strength * Math.pow(0.5, age / HALF_LIFE_MS)
}

/** True once a rule has decayed below the floor (unused long enough to forget). */
export function isForgettable(rule: FrecencyRule, now: number = Date.now()): boolean {
  return effectiveStrength(rule, now) < FORGET_FLOOR
}

/** Ranking nudge (staticPriority) for a learned direct-answer item, from its weight. */
export function firePriority(rule: FrecencyRule, now: number = Date.now()): number {
  const base = 45
  return base + Math.min(Math.round(effectiveStrength(rule, now) * 6), 35)
}
