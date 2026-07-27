/**
 * Keep launcher highlight on the same item when async results append / re-rank.
 * Selection is tracked by systemKey; index is re-resolved after list updates.
 */

export type SelectableKeyItem = {
  systemKey: string
}

/**
 * Resolve the index to highlight after `items` changes.
 *
 * - If `selectedKey` is still in the list → jump to that item (may move down as
 *   partials append above / ranking shifts).
 * - If the key is gone → clamp previous index and adopt the new item's key.
 * - If no key yet (fresh list) → clamp index and pin that item's key.
 */
export function resolvePreservedSelection(options: {
  selectedKey: string | null
  selectedIndex: number
  items: SelectableKeyItem[]
}): { index: number; key: string | null } {
  const { selectedKey, selectedIndex, items } = options
  if (items.length === 0) {
    return { index: 0, key: null }
  }

  if (selectedKey) {
    const found = items.findIndex((item) => item.systemKey === selectedKey)
    if (found >= 0) {
      return { index: found, key: selectedKey }
    }
  }

  const clamped = Math.max(0, Math.min(selectedIndex, items.length - 1))
  return {
    index: clamped,
    key: items[clamped]?.systemKey ?? null,
  }
}
