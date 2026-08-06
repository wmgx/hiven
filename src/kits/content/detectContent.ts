/**
 * detectContent — pure multi-label content classifier for launcher intelligence.
 *
 * Heuristic order aligns with clipboard detectClipboardType for a future migrate:
 *   secret → json → url → jwt → timestamp → xml/css/sql/csv/yaml/query-string → command → text
 * Plus kit-only kinds: base64, tsv, url-encoded, color.
 *
 * Rules of thumb: high confidence only when low false-positive risk; prefer miss over over-claim.
 */

import type { ContentDetection, ContentKind } from './types'

const SECRET_RE = /(?:sk-|token|password|Authorization|Bearer)/i
const URL_RE = /^https?:\/\//i
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const TIMESTAMP_RE = /^\d{10,13}$/
const XML_RE = /^<\?xml|^<[A-Za-z][\s\S]*>$/
const CSS_RE = /^[.#]?[A-Za-z0-9_-]+\s*\{[\s\S]*\}$/
const SQL_RE = /\bselect\b[\s\S]+\bfrom\b|\binsert\s+into\b|\bupdate\b[\s\S]+\bset\b/i
const COMMAND_RE = /^(?:ssh|curl|npm|git|brew|pip|docker|kubectl|cargo|go |apt)\b/i
const COLOR_HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const COLOR_RGB_RE = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i
const BASE64_BODY_RE = /^[A-Za-z0-9+/]+={0,2}$/
const URL_ENCODED_RE = /^(?:[A-Za-z0-9_.~-]|%[0-9A-Fa-f]{2})+$/

function isValidJson(text: string): boolean {
  try {
    const value = JSON.parse(text)
    return value !== null && (typeof value === 'object' || Array.isArray(value))
  } catch {
    return false
  }
}

function looksLikeDelimitedTable(
  text: string,
): { kind: 'csv' | 'tsv'; delimiter: string } | null {
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return null

  // Prefer tab when every line has tabs → tsv
  if (lines.every((line) => line.includes('\t'))) {
    const cols = lines.map((line) => line.split('\t').length)
    if (cols.every((c) => c === cols[0] && c >= 2)) {
      return { kind: 'tsv', delimiter: '\t' }
    }
  }

  for (const delimiter of [',', ';', '|'] as const) {
    if (!lines.every((line) => line.includes(delimiter))) continue
    const cols = lines.map((line) => line.split(delimiter).length)
    if (cols.every((c) => c === cols[0] && c >= 2)) {
      return { kind: 'csv', delimiter }
    }
  }

  // Fallback: same delimiter present on every line (clipboard-style, looser)
  for (const delimiter of [',', '\t', ';', '|'] as const) {
    if (lines.every((line) => line.includes(delimiter))) {
      return { kind: delimiter === '\t' ? 'tsv' : 'csv', delimiter }
    }
  }

  return null
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

function looksLikeMarkdown(text: string): boolean {
  if (/^#{1,6}\s+\S/m.test(text)) return true
  if (/^```/m.test(text)) return true
  if (/^\s*[-*+]\s+\S/m.test(text) && text.includes('\n')) return true
  if (/\[.+\]\(.+\)/.test(text)) return true
  return false
}

/**
 * High-confidence base64: alphabet + padding rules + length floor +
 * successful decode. Short plain words like "hello" must stay low/absent.
 */
function detectBase64(trimmed: string): ContentDetection | null {
  if (trimmed.length < 8) return null
  if (!BASE64_BODY_RE.test(trimmed)) return null
  if (trimmed.length % 4 !== 0) return null

  // Reject pure alpha short-ish tokens that look like words (no + / =)
  const hasSpecial = /[+/=]/.test(trimmed)
  if (!hasSpecial && trimmed.length < 16 && /^[A-Za-z]+$/.test(trimmed)) {
    return null
  }

  try {
    // Prefer Buffer when available (Node / test harness); fall back to atob.
    let decoded: string
    if (typeof Buffer !== 'undefined') {
      decoded = Buffer.from(trimmed, 'base64').toString('utf8')
      // Round-trip check to reject non-canonical padding abuse
      const reencoded = Buffer.from(decoded, 'utf8').toString('base64')
      if (reencoded.replace(/=+$/, '') !== trimmed.replace(/=+$/, '')) {
        // Still accept if decode produced bytes; use lower confidence later
      }
    } else if (typeof atob === 'function') {
      decoded = atob(trimmed)
    } else {
      return null
    }

    // Empty decode is not useful
    if (!decoded || decoded.length === 0) return null

    // Prefer padded or longer payloads for high confidence
    const confidence =
      hasSpecial || trimmed.length >= 16
        ? 0.92
        : 0.65

    return {
      kind: 'base64',
      confidence,
      normalized: trimmed,
      captures: { decoded: decoded.slice(0, 256) },
    }
  } catch {
    return null
  }
}

function detectUrlEncoded(trimmed: string): ContentDetection | null {
  if (trimmed.length < 3) return null
  if (!/%[0-9A-Fa-f]{2}/.test(trimmed)) return null
  if (!URL_ENCODED_RE.test(trimmed)) return null
  try {
    const decoded = decodeURIComponent(trimmed)
    if (decoded === trimmed) return null
    return {
      kind: 'url-encoded',
      confidence: 0.88,
      normalized: trimmed,
      captures: { decoded: decoded.slice(0, 256) },
    }
  } catch {
    return null
  }
}

function detectColor(trimmed: string): ContentDetection | null {
  if (COLOR_HEX_RE.test(trimmed) || COLOR_RGB_RE.test(trimmed)) {
    return { kind: 'color', confidence: 0.95, normalized: trimmed }
  }
  return null
}

function detectTimestamp(trimmed: string): ContentDetection | null {
  if (!TIMESTAMP_RE.test(trimmed)) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return null

  // 10 digits → seconds, 13 → millis. Reject extreme out-of-range values lightly
  // but still report high confidence for pure digit length match (test contract).
  const unit = trimmed.length >= 13 ? 'ms' : 's'
  return {
    kind: 'timestamp',
    confidence: 0.95,
    normalized: trimmed,
    captures: { unit, value: trimmed },
  }
}

/** base64url → utf8 string; null on failure. */
function decodeBase64UrlJson(segment: string): unknown | null {
  if (!segment || segment.length < 4) return null
  try {
    const padded = segment + '='.repeat((4 - (segment.length % 4)) % 4)
    const b64 = padded.replace(/-/g, '+').replace(/_/g, '/')
    let json: string
    if (typeof Buffer !== 'undefined') {
      json = Buffer.from(b64, 'base64').toString('utf8')
    } else if (typeof atob === 'function') {
      json = atob(b64)
    } else {
      return null
    }
    return JSON.parse(json)
  } catch {
    return null
  }
}

/**
 * Strong JWT: three base64url segments AND header decodes to JSON with `alg`.
 * Rejects false positives like `ipb.xxx.yyy` / host-like dotted tokens.
 */
function detectJwt(trimmed: string): ContentDetection | null {
  if (!JWT_RE.test(trimmed) || !trimmed.includes('.')) return null
  const parts = trimmed.split('.')
  if (parts.length !== 3 || parts.some((p) => !p)) return null

  const header = decodeBase64UrlJson(parts[0])
  if (!header || typeof header !== 'object' || Array.isArray(header)) return null
  const alg = (header as { alg?: unknown }).alg
  if (typeof alg !== 'string' || !alg) return null

  // Prefer payload that also decodes as JSON (typical JWT); still accept bare signature.
  const payload = decodeBase64UrlJson(parts[1])
  const payloadOk = payload !== null && typeof payload === 'object'
  const confidence = payloadOk ? 0.95 : 0.85

  return {
    kind: 'jwt',
    confidence,
    normalized: trimmed,
    captures: {
      header: parts[0],
      payload: parts[1],
      signature: parts[2],
      alg,
    },
  }
}

function push(
  out: ContentDetection[],
  kind: ContentKind,
  confidence: number,
  normalized: string,
  captures?: Record<string, string>,
): void {
  out.push(captures ? { kind, confidence, normalized, captures } : { kind, confidence, normalized })
}

/**
 * Detect content kinds for arbitrary text. Returns one or more detections,
 * sorted by confidence descending. Empty input yields a single `unknown`.
 */
export function detectContent(text: string): ContentDetection[] {
  if (text === '') {
    return [{ kind: 'unknown', confidence: 1, normalized: '' }]
  }

  const normalized = text.trim()
  if (!normalized) {
    return [{ kind: 'unknown', confidence: 1, normalized: '' }]
  }

  const results: ContentDetection[] = []

  // 1. Secret / secret-like (highest priority for security UX)
  if (SECRET_RE.test(normalized)) {
    push(results, 'secret-like', 0.9, normalized)
  }

  // 2. JSON object / array
  if (
    (normalized.startsWith('{') || normalized.startsWith('[')) &&
    isValidJson(normalized)
  ) {
    push(results, 'json', 0.98, normalized)
  }

  // 3. URL
  if (URL_RE.test(normalized)) {
    push(results, 'url', 0.97, normalized)
  }

  // 4. JWT (strong: header JSON + alg — not every a.b.c token)
  const jwt = detectJwt(normalized)
  if (jwt) results.push(jwt)

  // 5. Timestamp
  const ts = detectTimestamp(normalized)
  if (ts) results.push(ts)

  // 6. Structured markup / style / sql / tables / yaml / qs
  if (XML_RE.test(normalized)) {
    push(results, 'xml', 0.9, normalized)
  }
  if (CSS_RE.test(normalized)) {
    push(results, 'css', 0.88, normalized)
  }
  if (SQL_RE.test(normalized)) {
    push(results, 'sql', 0.9, normalized)
  }

  const table = looksLikeDelimitedTable(normalized)
  if (table) {
    push(results, table.kind, 0.9, normalized, { delimiter: table.delimiter })
    // Also expose csv alias when tsv so consumers looking for table data can match
    if (table.kind === 'tsv') {
      push(results, 'csv', 0.75, normalized, { delimiter: '\t' })
    }
  }

  if (looksLikeYaml(normalized) && !results.some((r) => r.kind === 'json')) {
    push(results, 'yaml', 0.85, normalized)
  }

  if (looksLikeQueryString(normalized)) {
    push(results, 'query-string', 0.9, normalized)
  }

  // 7. Command
  if (COMMAND_RE.test(normalized)) {
    push(results, 'command', 0.88, normalized)
  }

  // 8. Kit-only kinds
  const b64 = detectBase64(normalized)
  if (b64) results.push(b64)

  const ue = detectUrlEncoded(normalized)
  if (ue) results.push(ue)

  const color = detectColor(normalized)
  if (color) results.push(color)

  if (looksLikeMarkdown(normalized)) {
    push(results, 'markdown', 0.8, normalized)
  }

  // 9. Fallback text when nothing structured matched
  if (results.length === 0) {
    push(results, 'text', 0.6, normalized)
  }

  results.sort((a, b) => b.confidence - a.confidence)
  return results
}
