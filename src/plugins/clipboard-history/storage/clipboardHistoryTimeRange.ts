export type ClipboardHistoryTimeRange = 'all' | 'today' | 'last7Days'

/** Stable local-calendar identity used to refresh a visible surface after midnight. */
export function getClipboardHistoryLocalDayKey(now = Date.now()): string {
  const date = new Date(now)
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

/**
 * Inclusive local-calendar boundary for the selected range. setDate is
 * intentional: "last 7 days" means today plus six local calendar days, even
 * across daylight-saving transitions.
 */
export function getClipboardHistoryCopiedSince(
  range: ClipboardHistoryTimeRange,
  now = Date.now(),
): number | undefined {
  if (range === 'all') return undefined
  const boundary = new Date(now)
  boundary.setHours(0, 0, 0, 0)
  if (range === 'last7Days') boundary.setDate(boundary.getDate() - 6)
  return boundary.getTime()
}
