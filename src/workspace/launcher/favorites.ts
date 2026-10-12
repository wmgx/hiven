/**
 * Launcher Favorites — pure helpers for user-pinned launcher items.
 *
 * Favorites are global (not per-surface): a pin in Global Launcher also boosts
 * the same system key in the editor command bar. Persistence is owned by the store.
 */

import type { SystemLauncherItemKey } from './types'

export type LauncherFavoriteLabels = Record<string, string>

/** Only installed-app display names may be kept; content/plugin titles are not metadata. */
export function normalizeLauncherFavoriteLabel(itemKey: string, raw: unknown): string | undefined {
  const prefix = 'host:app-launcher:app:'
  if (!itemKey.startsWith(prefix) || !itemKey.slice(prefix.length).trim()
    || itemKey !== itemKey.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(itemKey)
    || typeof raw !== 'string' || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(raw)) return undefined
  const label = raw.trim()
  if (!label || Array.from(label).length > 80 || /[/\\]/.test(label)
    || /^[a-z][a-z\d+.-]*:/i.test(label)) return undefined
  return label
}

/** Missing labels stay missing; orphan labels cannot revive removed favorites. */
export function normalizeLauncherFavoriteLabels(
  raw: unknown,
  favorites: readonly SystemLauncherItemKey[],
): LauncherFavoriteLabels {
  const labels: LauncherFavoriteLabels = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return labels
  for (const key of favorites) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key)
    const label = normalizeLauncherFavoriteLabel(key, descriptor?.value)
    if (label !== undefined) labels[key] = label
  }
  return labels
}

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
