/**
 * Keep launcher highlight on the same item when async results append / re-rank.
 *
 * Only a **user-pinned** selection (arrow keys / intentional hover) is sticky.
 * Default highlight (top of list after open / query change) must NOT pin — it
 * should follow ranking as partials arrive.
 */

export type SelectableKeyItem = {
  systemKey: string
}

/**
 * Resolve the index to highlight after `items` changes.
 *
 * - If `selectedKey` is set (user-pinned) and still in the list → follow that item.
 * - If the pinned key is gone → fall back to default (index 0, no pin).
 * - If no key (default selection) → always index 0; do not adopt a sticky key.
 */
export function resolvePreservedSelection(options: {
  selectedKey: string | null
  selectedIndex: number
  items: SelectableKeyItem[]
}): { index: number; key: string | null } {
  const { selectedKey, items } = options
  if (items.length === 0) {
    return { index: 0, key: null }
  }

  if (selectedKey) {
    const found = items.findIndex((item) => item.systemKey === selectedKey)
    if (found >= 0) {
      return { index: found, key: selectedKey }
    }
    // User's item left the list — drop pin, show new ranking top.
    return { index: 0, key: null }
  }

  // Default selection: always track the current top result.
  return { index: 0, key: null }
}
