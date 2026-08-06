/**
 * Hard-attach policy for clipboard → Object Block.
 *
 * Product rule: only attach when content is a high-confidence structured object
 * that has real tool recommendations — not generic "maybe encode this" text.
 *
 * Age/freshness stays in clipboardSnapshot; this file owns content eligibility.
 */

import { detectContent } from '../../kits/content/index'
import type { ContentDetection, ContentKind } from '../../kits/content/types'
import {
  detectClipboardFilePath,
  isSoftClipboardOperand,
} from './clipboardSnapshot'

/** Minimum content-kit confidence to treat a kind as attach-worthy. */
export const STRONG_ATTACH_MIN_CONFIDENCE = 0.75

/**
 * Structured kinds with dedicated tools / accepts catalogs.
 * Explicitly excludes plain `text` / `command` / `markdown` / `unknown`
 * so generic textMatch (e.g. "not base64 → encode") cannot force a block.
 */
export const STRONG_ATTACH_CONTENT_KINDS: ReadonlySet<ContentKind> = new Set([
  'json',
  'url',
  'jwt',
  'csv',
  'tsv',
  'yaml',
  'xml',
  'sql',
  'css',
  'timestamp',
  'query-string',
  'base64',
  'url-encoded',
  'secret',
  'secret-like',
])

export type StrongAttachHit = {
  kind: ContentKind
  confidence: number
}

/**
 * Pure content gate: soft operands / plain text stay silent;
 * only strong detections (or known file paths) qualify for hard-attach.
 */
export function findStrongClipboardAttachHits(text: string): StrongAttachHit[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (isSoftClipboardOperand(trimmed)) return []

  // Clipboard holds a path with a known structured extension (csv/json/…).
  const filePath = detectClipboardFilePath(trimmed)
  if (filePath) {
    return [{ kind: filePath.kind as ContentKind, confidence: 0.95 }]
  }

  if (typeof detectContent !== 'function') return []

  const detections: ContentDetection[] = detectContent(trimmed)
  const hits: StrongAttachHit[] = []
  for (const d of detections) {
    if (!STRONG_ATTACH_CONTENT_KINDS.has(d.kind)) continue
    if (d.confidence < STRONG_ATTACH_MIN_CONFIDENCE) continue
    hits.push({ kind: d.kind, confidence: d.confidence })
  }
  return hits
}

/**
 * True when clipboard text is eligible for Object Block hard-attach
 * (ignoring age / dismiss / sticky — callers layer those separately).
 *
 * "Has recommendation" is implied by strong kinds: each kind maps to a
 * dedicated action catalog or plugin `accepts` (json/url/jwt/base64/…).
 * Generic text encode/decode is intentionally not a gate.
 */
export function isStrongClipboardAttachEligible(text: string): boolean {
  return findStrongClipboardAttachHits(text).length > 0
}
