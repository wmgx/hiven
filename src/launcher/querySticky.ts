/**
 * Sticky launcher query — keep typed input across blur / temporary dismiss
 * so users can leave to copy the next operand and resume a formula.
 *
 * Not Object Block state. Only the search-box string.
 */

export const LAUNCHER_QUERY_STICKY_TTL_MS = 3 * 60 * 1000
/** Guard against accidental huge paste sitting in sticky memory. */
export const LAUNCHER_QUERY_STICKY_MAX_CHARS = 2_000

type StickyRecord = {
  query: string
  savedAt: number
}

const stickyBySurface = new Map<string, StickyRecord>()

export function saveStickyLauncherQuery(
  surfaceId: string,
  query: string,
  now: number = Date.now(),
): void {
  const trimmed = query
  if (!trimmed.trim()) {
    stickyBySurface.delete(surfaceId)
    return
  }
  stickyBySurface.set(surfaceId, {
    query: trimmed.slice(0, LAUNCHER_QUERY_STICKY_MAX_CHARS),
    savedAt: now,
  })
}

/**
 * Peek + clear sticky if fresh. Expired or empty → null and remove.
 */
export function consumeStickyLauncherQuery(
  surfaceId: string,
  now: number = Date.now(),
  ttlMs: number = LAUNCHER_QUERY_STICKY_TTL_MS,
): string | null {
  const record = stickyBySurface.get(surfaceId)
  if (!record) return null
  stickyBySurface.delete(surfaceId)
  if (now - record.savedAt > ttlMs) return null
  if (!record.query.trim()) return null
  return record.query
}

export function peekStickyLauncherQuery(
  surfaceId: string,
  now: number = Date.now(),
  ttlMs: number = LAUNCHER_QUERY_STICKY_TTL_MS,
): string | null {
  const record = stickyBySurface.get(surfaceId)
  if (!record) return null
  if (now - record.savedAt > ttlMs) {
    stickyBySurface.delete(surfaceId)
    return null
  }
  return record.query.trim() ? record.query : null
}

export function clearStickyLauncherQuery(surfaceId: string): void {
  stickyBySurface.delete(surfaceId)
}

/** Test helper. */
export function clearAllStickyLauncherQueries(): void {
  stickyBySurface.clear()
}
