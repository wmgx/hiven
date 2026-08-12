/**
 * Self-learning · input feature extraction (P1, generic — no product semantics).
 *
 * Pure functions only: no imports, no side effects. Derives a coarse,
 * privacy-safe signature of an input's SHAPE so repeated shapes can be
 * clustered by the learner. The observer layer supplies detectedType /
 * persistence; this module never touches the clipboard or the registry.
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §4.3 / §12.
 */

export type InputCharset = 'digits' | 'hex' | 'base64' | 'alpha' | 'alnum' | 'mixed'

export interface InputFeatures {
  /** Trimmed length. */
  len: number
  charset: InputCharset
  hasSpace: boolean
  hasNewline: boolean
  lineCount: number
  looksUrl: boolean
  looksEmail: boolean
}

const URL_RE = /^https?:\/\/\S+$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function extractFeatures(text: string): InputFeatures {
  const s = text ?? ''
  const trimmed = s.trim()
  const hasNewline = /\r|\n/.test(s)
  const lineCount = hasNewline ? s.split(/\r\n|\r|\n/).length : 1
  return {
    len: trimmed.length,
    charset: detectCharset(trimmed),
    hasSpace: /\s/.test(trimmed),
    hasNewline,
    lineCount,
    looksUrl: URL_RE.test(trimmed),
    looksEmail: EMAIL_RE.test(trimmed),
  }
}

function detectCharset(s: string): InputCharset {
  if (!s) return 'mixed'
  if (/^\d+$/.test(s)) return 'digits'
  if (/^[0-9a-fA-F]+$/.test(s)) return 'hex'
  if (s.length >= 8 && s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s)) return 'base64'
  if (/^[A-Za-z]+$/.test(s)) return 'alpha'
  if (/^[A-Za-z0-9]+$/.test(s)) return 'alnum'
  return 'mixed'
}

function lenBucket(n: number): string {
  if (n < 8) return 'xs'
  if (n < 16) return 's'
  if (n < 32) return 'm'
  if (n < 128) return 'l'
  return 'xl'
}

/**
 * Coarse clustering key: same signature = "same kind of input" for the learner.
 * Deliberately lossy — the induced matcher (P2) refines within a cluster.
 */
export function featureSignature(f: InputFeatures): string {
  const parts = [`cs:${f.charset}`, `len:${lenBucket(f.len)}`]
  if (f.hasNewline) parts.push('ml')
  else if (f.hasSpace) parts.push('sp')
  if (f.looksUrl) parts.push('url')
  if (f.looksEmail) parts.push('email')
  return parts.join('|')
}

// ─── token helpers (content→URL pairing, scenarios A / D) ──────────────────────

const QUOTE_RE = /^["'`]+|["'`]+$/g

export function normalizeToken(s: string): string {
  return (s ?? '').trim().replace(QUOTE_RE, '')
}

/** Single-line, bounded, whitespace-free — a candidate for URL substitution. */
export function isPlausibleToken(s: string): boolean {
  const t = normalizeToken(s)
  if (t.length < 3 || t.length > 200) return false
  if (/\s/.test(t)) return false
  return true
}

export type TokenKind = 'hex' | 'number' | 'uuid' | 'psm' | 'token'

export function classifyToken(s: string): TokenKind {
  const t = normalizeToken(s)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return 'uuid'
  if (/^\d+$/.test(t)) return 'number'
  if (/^[0-9a-f]{7,40}$/i.test(t)) return 'hex'
  if (/^[a-z0-9_]+\.[a-z0-9_]+\.[a-z0-9_]+$/i.test(t)) return 'psm'
  return 'token'
}
