/**
 * Launcher Favorites — pure helpers for user-pinned launcher items.
 *
 * Favorites are global (not per-surface): a pin in Global Launcher also boosts
 * the same system key in the editor command bar. Persistence is owned by the store.
 */

import type { SystemLauncherItemKey } from './types'

/** Soft cap so the empty-open favorites section stays scannable. */
export const LAUNCHER_FAVORITES_MAX = 24

export function emptyLauncherFavorites(): SystemLauncherItemKey[] {
  return []
}

export function isLauncherFavorite(
  favorites: readonly SystemLauncherItemKey[],
  itemKey: SystemLauncherItemKey,
): boolean {
  return favorites.includes(itemKey)
}

/**
 * Toggle pin for `itemKey`. Immutable. Caps at {@link LAUNCHER_FAVORITES_MAX}
 * (new pins at the front; oldest overflow dropped when over cap).
 */
export function toggleLauncherFavorite(
  favorites: readonly SystemLauncherItemKey[],
  itemKey: SystemLauncherItemKey,
): SystemLauncherItemKey[] {
  const key = itemKey.trim()
  if (!key) return [...favorites]
  if (favorites.includes(key)) {
    return favorites.filter((k) => k !== key)
  }
  return [key, ...favorites.filter((k) => k !== key)].slice(0, LAUNCHER_FAVORITES_MAX)
}

/** Sanitize persisted favorites (drop non-strings / empty). */
export function normalizeLauncherFavorites(raw: unknown): SystemLauncherItemKey[] {
  if (!Array.isArray(raw)) return []
  const out: SystemLauncherItemKey[] = []
  const seen = new Set<string>()
  for (const row of raw) {
    if (typeof row !== 'string') continue
    const key = row.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
    if (out.length >= LAUNCHER_FAVORITES_MAX) break
  }
  return out
}
