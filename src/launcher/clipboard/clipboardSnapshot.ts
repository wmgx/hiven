/**
 * Clipboard Snapshot — Freshness detection for system clipboard content.
 *
 * Design: hiven_clipboard_object_block_recommendation_ai_task.md §5.1
 *
 * Phase R0: track clipboard text hash and change time to determine freshness.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ClipboardDetectedType =
  | 'json'
  | 'url'
  | 'text'
  | 'command'
  | 'secret'
  | 'unknown'
  | 'sql'
  | 'css'
  | 'xml'
  | 'csv'
  | 'jwt'
  | 'timestamp'
  | 'secret-like'

export type ClipboardSnapshot = {
  text: string
  hash: string
  detectedType: ClipboardDetectedType
  firstSeenAt: number
  lastSeenAt: number
  changedAt?: number
  ageConfidence: 'known' | 'unknown'
}

// ─── Configuration ─────────────────────────────────────────────────────────────

/** Clipboard copied within this window is "fresh" and auto-attaches. */
export const FRESH_CLIPBOARD_TTL_MS = 2 * 60 * 1000

/** Clipboard older than fresh but within this window shows a weak hint. */
export const RECENT_CLIPBOARD_HINT_TTL_MS = 10 * 60 * 1000

/** Unknown-age clipboard is never auto-attached. */
export const UNKNOWN_AGE_AUTO_ATTACH = false

// ─── Hash ──────────────────────────────────────────────────────────────────────

export function hashClipboardText(text: string): string {
  // Simple djb2-style hash for fast comparison without crypto dependency.
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0
  }
  return `djb2:${(h >>> 0).toString(36)}`
}

// ─── Detection ─────────────────────────────────────────────────────────────────

export function detectClipboardType(text: string): ClipboardDetectedType {
  const trimmed = text.trim()
  if (!trimmed) return 'unknown'

  // Secret detection (high priority — before JSON/URL)
  if (/(?:sk-|token|password|Authorization|Bearer)/i.test(trimmed)) return 'secret-like'

  // JSON
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && isValidJson(trimmed)) return 'json'

  // URL
  if (/^https?:\/\//i.test(trimmed)) return 'url'

  // JWT
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) return 'jwt'

  // Timestamp
  if (/^\d{10,13}$/.test(trimmed)) return 'timestamp'

  // XML / CSS / CSV / SQL heuristics
  if (/^<\?xml|^<[A-Za-z][\s\S]*>$/.test(trimmed)) return 'xml'
  if (/^[.#]?[A-Za-z0-9_-]+\s*\{[\s\S]*\}$/.test(trimmed)) return 'css'
  if (/\bselect\b[\s\S]+\bfrom\b|\binsert\s+into\b|\bupdate\b[\s\S]+\bset\b/i.test(trimmed)) return 'sql'
  if (looksLikeDelimitedTable(trimmed)) return 'csv'

  // Command
  if (/^(?:ssh|curl|npm|git|brew|pip|docker|kubectl|cargo|go |apt)\b/i.test(trimmed)) return 'command'

  // Text (language heuristic)
  return 'text'
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function looksLikeDelimitedTable(text: string): boolean {
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return false
  return [',', '\t', ';', '|'].some((delimiter) => lines.every((line) => line.includes(delimiter)))
}

// ─── Snapshot creation / update ────────────────────────────────────────────────

let lastSnapshot: ClipboardSnapshot | null = null

export function getLastClipboardSnapshot(): ClipboardSnapshot | null {
  return lastSnapshot
}

export function updateClipboardSnapshot(text: string): ClipboardSnapshot {
  const now = Date.now()
  const hash = hashClipboardText(text)

  if (lastSnapshot && lastSnapshot.hash === hash) {
    // Same content — just update lastSeenAt, keep changedAt.
    lastSnapshot = { ...lastSnapshot, lastSeenAt: now }
    return lastSnapshot
  }

  // New content
  lastSnapshot = {
    text,
    hash,
    detectedType: detectClipboardType(text),
    firstSeenAt: now,
    lastSeenAt: now,
    changedAt: now,
    ageConfidence: 'known',
  }
  return lastSnapshot
}

export function createClipboardSnapshotFromUnknownAge(text: string): ClipboardSnapshot {
  const now = Date.now()
  const hash = hashClipboardText(text)
  lastSnapshot = {
    text,
    hash,
    detectedType: detectClipboardType(text),
    firstSeenAt: now,
    lastSeenAt: now,
    changedAt: undefined,
    ageConfidence: 'unknown',
  }
  return lastSnapshot
}

export function clearClipboardSnapshot(): void {
  lastSnapshot = null
}

// ─── Freshness rules ───────────────────────────────────────────────────────────

export function shouldAutoAttachClipboard(snapshot: ClipboardSnapshot, now: number = Date.now()): boolean {
  return (
    snapshot.ageConfidence === 'known' &&
    snapshot.changedAt !== undefined &&
    now - snapshot.changedAt <= FRESH_CLIPBOARD_TTL_MS
  )
}

export function shouldShowRecentClipboardHint(snapshot: ClipboardSnapshot, now: number = Date.now()): boolean {
  return (
    snapshot.ageConfidence === 'known' &&
    snapshot.changedAt !== undefined &&
    now - snapshot.changedAt > FRESH_CLIPBOARD_TTL_MS &&
    now - snapshot.changedAt <= RECENT_CLIPBOARD_HINT_TTL_MS
  )
}

export function isClipboardExpired(snapshot: ClipboardSnapshot, now: number = Date.now()): boolean {
  if (snapshot.ageConfidence === 'unknown') return true
  if (snapshot.changedAt === undefined) return true
  return now - snapshot.changedAt > RECENT_CLIPBOARD_HINT_TTL_MS
}
