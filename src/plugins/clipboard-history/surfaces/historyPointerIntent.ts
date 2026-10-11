/** Screen-coordinate changes, not viewport/layout movement, establish pointer intent. */
export function createHistoryPointerIntent() {
  let previous: { x: number; y: number } | undefined
  let active = false
  return {
    move(x: number, y: number, pointerType = 'mouse'): boolean {
      if (pointerType !== 'mouse' && pointerType !== 'pen') { active = false; return false }
      if (!Number.isFinite(x) || !Number.isFinite(y)) return active
      const moved = previous !== undefined && (previous.x !== x || previous.y !== y)
      previous = { x, y }
      if (moved) active = true
      return active
    },
    suspend(): void { active = false },
  }
}
