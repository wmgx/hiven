import { selectLauncherBrowseItems } from './browseItems'
import type { LauncherBrowseCategory, LauncherBrowseItem } from './browseItems'

export const MAX_VISIBLE_IDLE = 12

/** Idle shows saved favorites, then at most five recent available items. */
export function selectLauncherVisibleItems<T>(options: {
  rankedItems: readonly T[]
  availableItems: readonly T[]
  favoriteKeys: readonly string[]
  recentKeys?: readonly string[]
  hasMaterial?: boolean
  query: string
  browse?: boolean
  browseCategory?: LauncherBrowseCategory
  browseItemOf?: (item: T) => LauncherBrowseItem
  keyOf: (item: T) => string
}): T[] {
  const { rankedItems, availableItems, favoriteKeys, query, browse, keyOf } = options

  if (query.trim()) return [...rankedItems]

  if (browse) {
    return selectLauncherBrowseItems({
      items: availableItems,
      category: options.browseCategory,
      keyOf,
      itemOf: options.browseItemOf,
    })
  }

  if (options.hasMaterial) return [...rankedItems]

  const availableByKey = new Map<string, T>()
  for (const item of availableItems) {
    const row = options.browseItemOf?.(item)
    if (row?.behavior?.type === 'perform' && row.requiredCapabilities?.some(capability =>
      capability === 'desktop-windows' || capability === 'desktop-browser-tabs')) continue
    const key = keyOf(item)
    if (!availableByKey.has(key)) availableByKey.set(key, item)
  }
  const visible: T[] = []
  const seen = new Set<string>()
  let recentCount = 0
  for (const key of favoriteKeys) {
    if (seen.has(key) || !availableByKey.has(key)) continue
    visible.push(availableByKey.get(key)!)
    seen.add(key)
  }
  for (const key of options.recentKeys ?? []) {
    if (seen.has(key) || !availableByKey.has(key)) continue
    visible.push(availableByKey.get(key)!)
    seen.add(key)
    if (++recentCount === 5) break
  }
  return visible
}
