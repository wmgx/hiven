/**
 * Launcher Favorites — pure helpers for user-pinned launcher items.
 *
 * Favorites are global (not per-surface): a pin in Global Launcher also boosts
 * the same system key in the editor command bar. Persistence is owned by the store.
 */

import type { SystemLauncherItemKey } from './types'

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
 * Toggle pin for `itemKey`, or apply an explicit pin/unpin intent.
 * Immutable, with new pins at the front; repeating a pin keeps its position.
 * Explicit pins remain until the user removes them; the UI owns list sizing.
 */
export function toggleLauncherFavorite(
  favorites: readonly SystemLauncherItemKey[],
  itemKey: SystemLauncherItemKey,
  pinned?: boolean,
): SystemLauncherItemKey[] {
  const key = itemKey.trim()
  if (!key) return [...favorites]
  const wasPinned = favorites.includes(key)
  if (!(pinned ?? !wasPinned)) {
    return favorites.filter((k) => k !== key)
  }
  if (wasPinned) return [...favorites]
  return [key, ...favorites.filter((k) => k !== key)]
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
  }
  return out
}
