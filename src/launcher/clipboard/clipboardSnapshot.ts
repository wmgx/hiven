/**
 * Clipboard content identity, classification and change observation.
 *
 * Design: hiven_clipboard_object_block_recommendation_ai_task.md §5.1
 *
 * The existing poll also notices changes while the launcher is hidden.
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
  | 'base64'
  | 'color'
  | 'image'
  | 'files'

export type ClipboardSnapshot = {
  text: string
  hash: string
  detectedType: ClipboardDetectedType
  image?: { dataUrl: string; width: number; height: number }
  files?: string[]
}

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
    case 'color':
      return kind
    case 'url-encoded':
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
  for (const result of detectContent(text)) {
    const mapped = mapContentKindToClipboard(result.kind)
    if (mapped) return mapped
  }
  return 'text'
}

// ─── Snapshot creation / update ────────────────────────────────────────────────

let lastSnapshot: ClipboardSnapshot | null = null

export function getLastClipboardSnapshot(): ClipboardSnapshot | null {
  return lastSnapshot
}

export function updateClipboardSnapshot(value: string | ClipboardSnapshot): ClipboardSnapshot {
  const next = typeof value === 'string'
    ? { text: value, hash: hashClipboardText(value), detectedType: detectClipboardType(value) }
    : value
  if (lastSnapshot?.hash === next.hash) return lastSnapshot
  if (lastSnapshot) clearDismissState()
  lastSnapshot = next
  return next
}

let lastObservedText: string | null = null
export function observeClipboardText(text: string): ClipboardSnapshot | null {
  if (text === lastObservedText) return null
  if (lastObservedText !== null) clearDismissState()
  lastObservedText = text
  return { text, hash: hashClipboardText(text), detectedType: detectClipboardType(text) }
}

export function clearClipboardSnapshot(): void {
  lastSnapshot = null
}

// ─── Background age tracker ───────────────────────────────────────────────────

type ClipboardAgeReadFn = () => Promise<string>

let ageTrackerStop: (() => void) | null = null

// ─── Change subscription (passive observers: self-learning, etc.) ─────────────

type ClipboardChangeListener = (text: string, snapshot: ClipboardSnapshot) => void
const clipboardChangeListeners = new Set<ClipboardChangeListener>()

/**
 * Subscribe to distinct clipboard text changes seen by the background
 * observer. Fires only when the observed content actually changed (not on every
 * poll). Reuses the existing poll — no extra timer.
 */
export function subscribeClipboardChange(listener: ClipboardChangeListener): () => void {
  clipboardChangeListeners.add(listener)
  return () => clipboardChangeListeners.delete(listener)
}

function emitClipboardChange(text: string, snapshot: ClipboardSnapshot): void {
  for (const listener of clipboardChangeListeners) {
    try {
      listener(text, snapshot)
    } catch {
      // Isolate a bad subscriber from the tracker loop.
    }
  }
}

/** Existing background poll; retained to notice changes between launcher sessions. */
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
      {
        const snapshot = observeClipboardText(text)
        if (snapshot) emitClipboardChange(text, snapshot)
      }
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
  // Unix timestamps are strong content (date-time tools), not formula drafts.
  if (/^\d{10}$/.test(trimmed) || /^\d{13}$/.test(trimmed)) return false
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

// Store identity only, never clipboard content. No expiry: another copy resets it.
const DISMISSED_HINT_KEY = 'hiven-clipboard-hint-dismissed'
let dismissedHash: string | null = null

export function dismissClipboardHint(snapshot: ClipboardSnapshot): void {
  dismissedHash = snapshot.hash
  try { localStorage.setItem(DISMISSED_HINT_KEY, snapshot.hash) } catch { /* memory still suppresses it */ }
}

export function getDismissedClipboardHintHash(): string | null {
  try { return localStorage.getItem(DISMISSED_HINT_KEY) ?? dismissedHash } catch { return dismissedHash }
}

export function clearDismissState(): void {
  dismissedHash = null
  try { localStorage.removeItem(DISMISSED_HINT_KEY) } catch { /* memory is cleared */ }
}
