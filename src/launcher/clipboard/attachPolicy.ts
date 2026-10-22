/**
 * Hard-attach policy for clipboard → Object Block.
 *
 * Product rule: attach only when content is a high-confidence object that some
 * active plugin declared it can act on — the host owns no list of "useful" kinds.
 *   signal:      content kit detections (generic, shared by all plugins)
 *   declaration: tool/item `accepts.kinds`, or `launcher.claimsObjectText`
 *
 * Age/freshness stays in clipboardSnapshot; this file owns content eligibility.
 */

import { detectContent } from '../../kits/content/index'
import type { ContentDetection, ContentKind } from '../../kits/content/types'
import {
  detectClipboardFilePath,
  isSoftClipboardOperand,
} from './clipboardSnapshot'

/** Minimum content-kit confidence to treat a detection as an object. */
export const STRONG_ATTACH_MIN_CONFIDENCE = 0.75

/** Kit kinds that describe prose rather than an object; never an attach signal. */
const NON_OBJECT_CONTENT_KINDS: ReadonlySet<ContentKind> = new Set(['text', 'command', 'markdown', 'unknown'])

/**
 * Typed query text: misfire guard, not a usefulness list. secret/base64/sql/url-encoded
 * stay clipboard-only because ordinary search words collide with them.
 */
export const STRONG_QUERY_ATTACH_CONTENT_KINDS: ReadonlySet<ContentKind> = new Set([
  'json',
  'url',
  'jwt',
  'xml',
  'timestamp',
  'query-string',
])

/** What active plugins declared they can act on. */
export type ObjectAcceptance = {
  /** Union of `accepts.kinds` over currently available launcher items. */
  acceptedKinds: ReadonlySet<string>
  /** A plugin claims this exact clipboard text (`launcher.claimsObjectText`). */
  isClaimedByPlugin?: (text: string) => boolean
}

export type StrongAttachHit = {
  kind: ContentKind
  confidence: number
}

/**
 * Pure content signal: soft operands / plain text stay silent; returns the
 * high-confidence object kinds (or a known file path's kind) for this text.
 */
export function findStrongClipboardAttachHits(
  text: string,
  source: 'clipboard' | 'query' = 'clipboard',
): StrongAttachHit[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (isSoftClipboardOperand(trimmed)) return []

  const detections: ContentDetection[] = typeof detectContent === 'function' ? detectContent(trimmed, { source }) : []
  const hits: StrongAttachHit[] = []
  for (const d of detections) {
    if (NON_OBJECT_CONTENT_KINDS.has(d.kind)) continue
    if (source === 'query' && !STRONG_QUERY_ATTACH_CONTENT_KINDS.has(d.kind)) continue
    if (d.confidence < STRONG_ATTACH_MIN_CONFIDENCE) continue
    hits.push({ kind: d.kind, confidence: d.confidence })
  }
  // Sensitive hits keep every other hit alongside them; masking is decided elsewhere.
  const hasSensitive = hits.some((hit) => hit.kind === 'secret' || hit.kind === 'secret-like')
  if (hasSensitive || source === 'query') return hits

  // Preserve the mainline extension-based path attach behavior for other content.
  const filePath = detectClipboardFilePath(trimmed)
  if (filePath) {
    return [{ kind: filePath.kind as ContentKind, confidence: 0.95 }]
  }
  return hits
}

/**
 * True when text is an object some active plugin accepts
 * (ignoring age / dismiss / sticky — callers layer those separately).
 * Secret hits only mask; they never make text eligible on their own.
 */
export function isStrongClipboardAttachEligible(
  text: string,
  acceptance: ObjectAcceptance,
  source: 'clipboard' | 'query' = 'clipboard',
): boolean {
  const accepted = findStrongClipboardAttachHits(text, source)
    .some((hit) => hit.kind !== 'secret' && hit.kind !== 'secret-like' && acceptance.acceptedKinds.has(hit.kind))
  if (accepted) return true
  // Plugin claims are a clipboard affordance; typed queries already reach plugins directly.
  return source === 'clipboard' && acceptance.isClaimedByPlugin?.(text) === true
}
