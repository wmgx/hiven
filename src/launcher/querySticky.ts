/**
 * Sticky launcher query — keep typed input across blur / temporary dismiss
 * so users can leave to copy the next operand and resume a formula.
 *
 * Not Object Block state. Only the search-box string.
 *
 * Persistence: memory + sessionStorage.
 * sessionStorage survives StrictMode remount and brief webview thrash;
 * memory is the fast path for the same JS context.
 */

export const LAUNCHER_QUERY_STICKY_TTL_MS = 3 * 60 * 1000
/** Guard against accidental huge paste sitting in sticky memory. */
export const LAUNCHER_QUERY_STICKY_MAX_CHARS = 2_000

const STORAGE_PREFIX = 'hiven-launcher-query-sticky:'

type StickyRecord = {
  query: string
  savedAt: number
}

const stickyBySurface = new Map<string, StickyRecord>()

function storageKey(surfaceId: string): string {
  return `${STORAGE_PREFIX}${surfaceId}`
}

function readStorage(surfaceId: string): StickyRecord | null {
  try {
    const raw = sessionStorage.getItem(storageKey(surfaceId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StickyRecord
    if (!parsed || typeof parsed.query !== 'string' || typeof parsed.savedAt !== 'number') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeStorage(surfaceId: string, record: StickyRecord): void {
  try {
    sessionStorage.setItem(storageKey(surfaceId), JSON.stringify(record))
  } catch {
    // quota / private mode — memory still works for same context
  }
}

function removeStorage(surfaceId: string): void {
  try {
    sessionStorage.removeItem(storageKey(surfaceId))
  } catch {
    // ignore
  }
}

function isFresh(record: StickyRecord, now: number, ttlMs: number): boolean {
  return now - record.savedAt <= ttlMs && Boolean(record.query.trim())
}

function loadRecord(surfaceId: string): StickyRecord | null {
  const mem = stickyBySurface.get(surfaceId)
  if (mem) return mem
  const stored = readStorage(surfaceId)
  if (stored) stickyBySurface.set(surfaceId, stored)
  return stored
}

/**
 * Save non-empty query. Empty string is a no-op (does not wipe).
 * Use {@link clearStickyLauncherQuery} to drop intentionally.
 */
export function saveStickyLauncherQuery(
  surfaceId: string,
  query: string,
  now: number = Date.now(),
): void {
  if (!query.trim()) return
  const record: StickyRecord = {
    query: query.slice(0, LAUNCHER_QUERY_STICKY_MAX_CHARS),
    savedAt: now,
  }
  stickyBySurface.set(surfaceId, record)
  writeStorage(surfaceId, record)
}

/**
 * Peek without removing. Prefer this on open — one-shot consume races
 * React StrictMode remount (second mount sees empty and clears the input).
 */
export function peekStickyLauncherQuery(
  surfaceId: string,
  now: number = Date.now(),
  ttlMs: number = LAUNCHER_QUERY_STICKY_TTL_MS,
): string | null {
  const record = loadRecord(surfaceId)
  if (!record) return null
  if (!isFresh(record, now, ttlMs)) {
    clearStickyLauncherQuery(surfaceId)
    return null
  }
  return record.query
}

/**
 * Peek + clear. Prefer {@link peekStickyLauncherQuery} for open restore.
 * Kept for tests / explicit one-shot handoff.
 */
export function consumeStickyLauncherQuery(
  surfaceId: string,
  now: number = Date.now(),
  ttlMs: number = LAUNCHER_QUERY_STICKY_TTL_MS,
): string | null {
  const value = peekStickyLauncherQuery(surfaceId, now, ttlMs)
  if (value != null) clearStickyLauncherQuery(surfaceId)
  return value
}

export function clearStickyLauncherQuery(surfaceId: string): void {
  stickyBySurface.delete(surfaceId)
  removeStorage(surfaceId)
}

/** Test helper. */
export function clearAllStickyLauncherQueries(): void {
  for (const surfaceId of [...stickyBySurface.keys()]) {
    removeStorage(surfaceId)
  }
  stickyBySurface.clear()
  // Also sweep known prefix keys in sessionStorage
  try {
    const keys: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key)
    }
    for (const key of keys) sessionStorage.removeItem(key)
  } catch {
    // ignore
  }
}
