/**
 * Hard-attach policy for clipboard → Object Block.
 *
 * Product rule: only attach when content is a high-confidence structured object
 * that has real tool recommendations, or a local path with an explicit read action.
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
 * absolute text-file paths may attach as literal text for the explicit read action.
 */
export function findStrongClipboardAttachHits(text: string): StrongAttachHit[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (isSoftClipboardOperand(trimmed)) return []

  // Content signals, especially sensitive material, take precedence over path spelling.
  const detections: ContentDetection[] = typeof detectContent === 'function' ? detectContent(trimmed) : []
  const hits: StrongAttachHit[] = []
  for (const d of detections) {
    if (!STRONG_ATTACH_CONTENT_KINDS.has(d.kind)) continue
    if (d.confidence < STRONG_ATTACH_MIN_CONFIDENCE) continue
    hits.push({ kind: d.kind, confidence: d.confidence })
  }
  const sensitive = hits.filter((hit) => hit.kind === 'secret' || hit.kind === 'secret-like')
  if (sensitive.length) return sensitive
  if (hits.length) return hits

  // Keep the explicit read affordance for a copied local path, but never infer
  // JSON/CSV contents or read it here. A bare filename is not enough.
  const filePath = detectClipboardFilePath(trimmed)
  if (filePath) {
    const absolute = (filePath.path.startsWith('/') && !filePath.path.startsWith('//')) || /^[A-Za-z]:[\\/]/.test(filePath.path)
    if (absolute) return [{ kind: 'text', confidence: 0.95 }]
  }
  return []
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
