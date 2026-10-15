export type DiffNavigationTarget = { leftLine: number; rightLine: number }

export function clampDiffHunkIndex(index: number, total: number): number {
  if (total <= 0) return 0
  return Math.max(0, Math.min(Math.floor(index), total - 1))
}

export function moveDiffHunkIndex(index: number, total: number, direction: -1 | 1): number | null {
  if (total <= 0) return null
  const current = clampDiffHunkIndex(index, total)
  return (current + direction + total) % total
}

/** Preserve the existing highlighted-line grouping for non-text diff modes. */
export function buildHighlightNavigationTargets(
  leftHighlights: readonly number[],
  rightHighlights: readonly number[],
  leftLineCount: number,
  rightLineCount: number,
): DiffNavigationTarget[] {
  const validLines = (lines: readonly number[]) => [...new Set(lines)]
    .filter((line) => Number.isFinite(line) && line >= 1)
    .map(Math.floor)
    .sort((a, b) => a - b)
  const left = validLines(leftHighlights)
  const right = validLines(rightHighlights)
  const combined = validLines([...left, ...right])
  const clampLine = (line: number, count: number) => Math.max(1, Math.min(line, Math.max(1, count)))
  const targets: DiffNavigationTarget[] = []

  for (let index = 0; index < combined.length;) {
    const start = combined[index]
    let end = start
    index += 1
    while (index < combined.length && combined[index] - end <= 1) {
      end = combined[index]
      index += 1
    }
    const leftLine = left.find((line) => line >= start && line <= end) ?? start
    const rightLine = right.find((line) => line >= start && line <= end) ?? start
    targets.push({
      leftLine: clampLine(leftLine, leftLineCount),
      rightLine: clampLine(rightLine, rightLineCount),
    })
  }
  return targets
}
