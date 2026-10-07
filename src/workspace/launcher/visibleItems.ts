export const MAX_VISIBLE_IDLE = 12

/**
 * Compose a visible list from candidates already filtered for availability.
 * Idle recommendations retain their ranking and cap. Unavailable favorites are
 * removed, and available favorites extend that list in saved order. Search keeps
 * its ranking, and browse shows all items.
 */
export function selectLauncherVisibleItems<T>(options: {
  rankedItems: readonly T[]
  availableItems: readonly T[]
  favoriteKeys: readonly string[]
  query: string
  browse?: boolean
  keyOf: (item: T) => string
}): T[] {
  const { rankedItems, availableItems, favoriteKeys, query, browse, keyOf } = options

  if (!browse && query.trim()) return [...rankedItems]

  if (browse) {
    const seen = new Set<string>()
    return availableItems.filter((item) => {
      const key = keyOf(item)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  const baseItems = rankedItems.slice(0, MAX_VISIBLE_IDLE)
  if (favoriteKeys.length === 0) return baseItems

  const availableByKey = new Map<string, T>()
  for (const item of availableItems) {
    const key = keyOf(item)
    if (!availableByKey.has(key)) availableByKey.set(key, item)
  }
  const favorites = new Set(favoriteKeys)
  // A stale ranked favorite must not survive revoked availability. Slice before
  // filtering so removing it does not admit ordinary rows outside the idle cap.
  const visibleItems = baseItems.filter((item) => {
    const key = keyOf(item)
    return !favorites.has(key) || availableByKey.has(key)
  })
  const seen = new Set(visibleItems.map(keyOf))
  for (const key of favoriteKeys) {
    if (seen.has(key) || !availableByKey.has(key)) continue
    visibleItems.push(availableByKey.get(key)!)
    seen.add(key)
  }
  return visibleItems
}
