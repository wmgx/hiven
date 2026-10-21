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

/** Token-shaped secrets only; bare words like "password" or "1password" must not match. */
const SECRET_RES: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\b(?:authorization|password|passwd|api[_-]?key|secret|access[_-]?token|token)["']?\s*[:=]\s*["']?[^\s"']{3,}/i,
  /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{16,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]

/** Where the text came from. Typed queries only get structured strong kinds. */
export type DetectContentSource = 'clipboard' | 'query'

export type DetectContentOptions = { source?: DetectContentSource }

export function hasSecretShape(text: string): boolean {
  return SECRET_RES.some((re) => re.test(text))
}
const URL_RE = /^https?:\/\//i
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const TIMESTAMP_RE = /^(?:\d{10}|\d{13})$/
const TIMESTAMP_MIN_MS = Date.UTC(2000, 0, 1)
const TIMESTAMP_MAX_MS = Date.UTC(2101, 0, 1)
const XML_RE = /^<\?xml|^<[A-Za-z][\s\S]*>$/
const CSS_RE = /^[.#]?[A-Za-z0-9_-]+\s*\{[\s\S]*\}$/
const SQL_IDENT = '[\\w.`"\\[\\]]+'
const SQL_RES: readonly RegExp[] = [
  new RegExp(`^\\s*select\\s+[\\s\\S]+?\\s+from\\s+${SQL_IDENT}\\s*(?:$|;|\\)|\\b(?:where|join|inner|left|right|full|cross|group|order|limit|having|union|as)\\b)`, 'i'),
  new RegExp(`^\\s*insert\\s+into\\s+${SQL_IDENT}\\s*(?:\\(|values\\b|select\\b)`, 'i'),
  new RegExp(`^\\s*update\\s+${SQL_IDENT}\\s+set\\s+${SQL_IDENT}\\s*=`, 'i'),
  new RegExp(`^\\s*delete\\s+from\\s+${SQL_IDENT}`, 'i'),
  new RegExp(`^\\s*(?:create|alter|drop)\\s+table\\s+\\S+`, 'i'),
]
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
function decodeBase64Bytes(trimmed: string): Uint8Array | null {
  try {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(trimmed, 'base64'))
    if (typeof atob === 'function') {
      const bin = atob(trimmed)
      return Uint8Array.from(bin, (c) => c.charCodeAt(0))
    }
  } catch {
    // fall through
  }
  return null
}

/** Share of decoded characters that are ordinary printable text (strict UTF-8). */
function printableRatio(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0
  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return 0
  }
  let ok = 0
  for (const ch of decoded) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127 && code !== 0xfffd)) ok += 1
  }
  return ok / [...decoded].length
}

/**
 * Base64 must look like an encoded payload: valid alphabet/length AND
 * the decoded bytes are readable text. Plain long words ("visualstudiocode")
 * decode to binary garbage and are rejected.
 */
function detectBase64(trimmed: string): ContentDetection | null {
  if (trimmed.length < 8) return null
  if (!BASE64_BODY_RE.test(trimmed)) return null
  if (trimmed.length % 4 !== 0) return null

  const bytes = decodeBase64Bytes(trimmed)
  if (!bytes || bytes.length === 0) return null
  if (printableRatio(bytes) < 0.9) return null

  const decoded = new TextDecoder('utf-8').decode(bytes)
  return {
    kind: 'base64',
    confidence: /[+/=]/.test(trimmed) || trimmed.length >= 16 ? 0.92 : 0.65,
    normalized: trimmed,
    captures: { decoded: decoded.slice(0, 256) },
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

  const unit = trimmed.length === 13 ? 'ms' : 's'
  const timestampMs = unit === 'ms' ? n : n * 1000
  if (timestampMs < TIMESTAMP_MIN_MS || timestampMs >= TIMESTAMP_MAX_MS) return null

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
export function detectContent(text: string, options?: DetectContentOptions): ContentDetection[] {
  const fromQuery = options?.source === 'query'
  if (text === '') {
    return [{ kind: 'unknown', confidence: 1, normalized: '' }]
  }

  const normalized = text.trim()
  if (!normalized) {
    return [{ kind: 'unknown', confidence: 1, normalized: '' }]
  }

  const results: ContentDetection[] = []

  // 1. Secret / secret-like (highest priority for security UX)
  if (!fromQuery && hasSecretShape(normalized)) {
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
  if (SQL_RES.some((re) => re.test(normalized))) {
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
  const b64 = fromQuery ? null : detectBase64(normalized)
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
