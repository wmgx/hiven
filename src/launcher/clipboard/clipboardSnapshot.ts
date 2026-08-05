/**
 * Clipboard Snapshot — Freshness detection for system clipboard content.
 *
 * Design: hiven_clipboard_object_block_recommendation_ai_task.md §5.1
 *
 * Phase R0: track clipboard text hash and change time to determine freshness.
 */

// Import the file entry (…/index), not the directory, so pure-TS test harnesses
// that resolve relative imports via existsSync() hit a real file, not EISDIR.
import { detectContent } from '../../kits/content/index'
import type { ContentKind } from '../../kits/content/types'

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
  | 'yaml'
  | 'query-string'
  | 'markdown'

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
export const FRESH_CLIPBOARD_TTL_MS = 30 * 1000

/** Clipboard older than fresh but within this window shows a weak hint. */
export const RECENT_CLIPBOARD_HINT_TTL_MS = 2 * 60 * 1000

/** Unknown-age clipboard is never auto-attached. */
export const UNKNOWN_AGE_AUTO_ATTACH = false

/** Background age tracker poll interval (ms). Keeps changedAt near real copy time. */
export const CLIPBOARD_AGE_TRACKER_INTERVAL_MS = 1000

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

/** Map a filesystem path extension to a clipboard kind (when clipboard is a path). */
const PATH_EXT_TO_KIND: Record<string, ClipboardDetectedType> = {
  csv: 'csv',
  tsv: 'csv',
  json: 'json',
  sql: 'sql',
  xml: 'xml',
  css: 'css',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  txt: 'text',
}

/**
 * Detect a single-line local file path / filename (absolute/relative/file:// / bare name)
 * with a known extension. Used when the user copies a path or a Finder file
 * (plain-text flavor is often only the bare filename).
 */
export function detectClipboardFilePath(text: string): { path: string; ext: string; kind: ClipboardDetectedType } | null {
  const trimmed = text.trim()
  if (!trimmed || /[\r\n]/.test(trimmed)) return null

  let path = trimmed
  // Strip surrounding quotes from shell/path copy
  if (
    (path.startsWith('"') && path.endsWith('"')) ||
    (path.startsWith("'") && path.endsWith("'"))
  ) {
    path = path.slice(1, -1).trim()
  }
  if (/^file:\/\//i.test(path)) {
    try {
      path = decodeURIComponent(path.replace(/^file:\/\//i, ''))
      // file:///Users/... → /Users/...
      if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1)
    } catch {
      return null
    }
  }

  const extMatch = path.match(/\.([A-Za-z0-9]+)$/)
  if (!extMatch) return null
  const ext = extMatch[1].toLowerCase()
  const kind = PATH_EXT_TO_KIND[ext]
  if (!kind) return null

  const looksLikeAbsoluteOrRelativePath =
    path.startsWith('/') ||
    path.startsWith('~/') ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.startsWith('\\\\') ||
    path.includes('/') ||
    path.includes('\\')

  // Bare filename with known extension (Finder text flavor often has no directory)
  const looksLikeBareFilename =
    !looksLikeAbsoluteOrRelativePath &&
    path.length <= 255 &&
    !/[/\\:*?"<>|]/.test(path) &&
    // single path segment, not a sentence
    !/\s{2,}/.test(path)

  if (!looksLikeAbsoluteOrRelativePath && !looksLikeBareFilename) return null
  return { path, ext, kind }
}

export function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/**
 * Map content-kit kinds onto clipboard taxonomy.
 * Kit-only kinds collapse to the closest clipboard label (no type expansion required).
 */
function mapContentKindToClipboard(kind: ContentKind): ClipboardDetectedType | null {
  switch (kind) {
    case 'json':
    case 'url':
    case 'text':
    case 'command':
    case 'secret':
    case 'unknown':
    case 'sql':
    case 'css':
    case 'xml':
    case 'csv':
    case 'jwt':
    case 'timestamp':
    case 'secret-like':
    case 'yaml':
    case 'query-string':
    case 'markdown':
      return kind
    case 'tsv':
      return 'csv'
    case 'base64':
    case 'url-encoded':
    case 'color':
      return 'text'
    default:
      return null
  }
}

export function detectClipboardType(text: string): ClipboardDetectedType {
  const trimmed = text.trim()
  if (!trimmed) return 'unknown'

  // File path with known extension (e.g. user copied /tmp/export.csv)
  const filePath = detectClipboardFilePath(trimmed)
  if (filePath) return filePath.kind

  // Delegate content classification to content-kit (confidence-ordered multi-label).
  // `typeof` guards isolated test harnesses that strip ESM imports before transpile.
  if (typeof detectContent === 'function') {
    const results = detectContent(text)
    for (const result of results) {
      const mapped = mapContentKindToClipboard(result.kind)
      if (mapped) return mapped
    }
    return 'text'
  }

  // Fallback when content-kit import is stripped (standalone transpile harnesses).
  return legacyDetectClipboardType(trimmed)
}

/** Pre-kit heuristics kept only for import-stripped unit harnesses. */
function legacyDetectClipboardType(trimmed: string): ClipboardDetectedType {
  if (/(?:sk-|token|password|Authorization|Bearer)/i.test(trimmed)) return 'secret-like'
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && isValidJson(trimmed)) return 'json'
  if (/^https?:\/\//i.test(trimmed)) return 'url'
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) return 'jwt'
  if (/^\d{10,13}$/.test(trimmed)) return 'timestamp'
  if (/^<\?xml|^<[A-Za-z][\s\S]*>$/.test(trimmed)) return 'xml'
  if (/^[.#]?[A-Za-z0-9_-]+\s*\{[\s\S]*\}$/.test(trimmed)) return 'css'
  if (/\bselect\b[\s\S]+\bfrom\b|\binsert\s+into\b|\bupdate\b[\s\S]+\bset\b/i.test(trimmed)) return 'sql'
  if (looksLikeDelimitedTable(trimmed)) return 'csv'
  if (looksLikeYaml(trimmed)) return 'yaml'
  if (looksLikeQueryString(trimmed)) return 'query-string'
  if (/^(?:ssh|curl|npm|git|brew|pip|docker|kubectl|cargo|go |apt)\b/i.test(trimmed)) return 'command'
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

function looksLikeYaml(text: string): boolean {
  if (text.startsWith('---')) return true
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return false
  const kvCount = lines.filter((l) => /^[\w.-]+:\s+\S/.test(l)).length
  return kvCount >= 2
}

function looksLikeQueryString(text: string): boolean {
  const qs = text.startsWith('?') ? text.slice(1) : text
  return /^[\w%+.-]+=[\w%+.*-]*(?:&[\w%+.-]+=[\w%+.*-]*)+$/.test(qs)
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

/**
 * Observe clipboard text without treating first discovery as a copy event.
 *
 * - No prior snapshot → baseline with unknown age (never auto-attach).
 * - Same content → leave age fields untouched (no thrash).
 * - Content change → known age with changedAt = now (real observation clock).
 */
export function observeClipboardText(text: string): ClipboardSnapshot | null {
  if (!text) return lastSnapshot
  const hash = hashClipboardText(text)
  if (!lastSnapshot) {
    return createClipboardSnapshotFromUnknownAge(text)
  }
  if (lastSnapshot.hash === hash) {
    return lastSnapshot
  }
  return updateClipboardSnapshot(text)
}

export function clearClipboardSnapshot(): void {
  lastSnapshot = null
}

// ─── Background age tracker ───────────────────────────────────────────────────

type ClipboardAgeReadFn = () => Promise<string>

let ageTrackerStop: (() => void) | null = null

/**
 * Poll clipboard in the background so changedAt reflects when content actually
 * changed while the app is running — not when Global Launcher happens to open.
 *
 * First observation is always unknown-age baseline; only subsequent changes are
 * marked known/fresh. Safe to call multiple times (idempotent).
 */
export function startClipboardAgeTracker(
  readClipboard: ClipboardAgeReadFn,
  intervalMs: number = CLIPBOARD_AGE_TRACKER_INTERVAL_MS,
): () => void {
  if (ageTrackerStop) return ageTrackerStop

  let stopped = false
  let polling = false

  const tick = async () => {
    if (stopped || polling) return
    polling = true
    try {
      const text = await readClipboard()
      if (stopped) return
      if (text) observeClipboardText(text)
    } catch {
      // Ignore transient clipboard / permission errors.
    } finally {
      polling = false
    }
  }

  // Seed baseline soon after start (don't wait a full interval).
  void tick()
  const intervalId = window.setInterval(() => {
    void tick()
  }, intervalMs)

  ageTrackerStop = () => {
    stopped = true
    window.clearInterval(intervalId)
    ageTrackerStop = null
  }
  return ageTrackerStop
}

export function stopClipboardAgeTracker(): void {
  ageTrackerStop?.()
}

// ─── Soft operands (formula / calculator path) ────────────────────────────────

/**
 * Short pure numbers / currency-like snippets should NOT hard-attach as Object Block.
 * User intent is usually "paste into a formula" or type around the value, not run
 * object-action on the number itself. forceAttach still bypasses this.
 *
 * Matches:
 *  - 42, -3.14, 1e6, 1,234.5, 12%
 *  - $12.5 / ¥100 / €3.14 / £9 (optional currency prefix)
 */
export function isSoftClipboardOperand(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  // Keep hard-attach for multi-line / long blobs even if first line looks numeric.
  if (trimmed.length > 32 || /[\r\n]/.test(trimmed)) return false
  // Pure number (optional thousands separators, decimal, scientific, trailing %)
  if (/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?%?$/.test(trimmed)) {
    return true
  }
  // Optional single currency prefix
  if (/^[¥$€£]\s*[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/.test(trimmed)) {
    return true
  }
  return false
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

// ─── Dismiss cooldown ─────────────────────────────────────────────────────────

/** How long after dismissing a clipboard block it won't auto-attach again. */
export const DISMISS_COOLDOWN_MS = 2 * 60 * 1000

type DismissRecord = { hash: string; dismissedAt: number }

let lastDismiss: DismissRecord | null = null

/** Record that user dismissed a clipboard block (clicked ×). */
export function dismissClipboardBlock(snapshot: ClipboardSnapshot): void {
  lastDismiss = { hash: snapshot.hash, dismissedAt: Date.now() }
}

/** Check if a snapshot was recently dismissed and still in cooldown. */
export function isClipboardDismissed(snapshot: ClipboardSnapshot, now: number = Date.now()): boolean {
  if (!lastDismiss) return false
  if (lastDismiss.hash !== snapshot.hash) return false
  return now - lastDismiss.dismissedAt <= DISMISS_COOLDOWN_MS
}

/** Clear dismiss state (e.g. for testing). */
export function clearDismissState(): void {
  lastDismiss = null
}
