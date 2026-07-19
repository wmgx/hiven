/**
 * Intent protocol types — two-level hybrid matching.
 *
 * Layer 1: declarative `ContentAccepts` (host evaluates pure data, never runs plugin code)
 * Layer 2: optional `match(ctx)` (only after accepts hits; host budgets/timeouts/caps results)
 */

import type { ContentDetection, ContentKind } from '../../kits/content'
import type { Locale } from '../../i18n'

/** Declarative coarse filter. All provided dimensions are AND-ed. */
export type ContentAccepts = {
  /** At least one detection.kind must be in this list. */
  kinds?: ContentKind[]
  /** Regex source tested against contentText ?? ''. */
  regex?: string
  /** Normalized query must equal one of these (lowercase, collapsed whitespace). */
  aliases?: string[]
  /** Case-insensitive match against foregroundApp. */
  apps?: string[]
}

export type IntentTarget =
  | { kind: 'systemKey' | 'command'; id: string }
  | { kind: 'inline'; item: unknown }

export type IntentHit = {
  id: string
  /** 0–1; host maps to ranking magnitude. */
  confidence: number
  target: IntentTarget
  reason?: 'content' | 'alias' | 'context' | 'query'
}

export type IntentMatchContext = {
  query: string
  locale: Locale | string
  /** Work-context snapshot; shape is host-owned and may grow. */
  context: Record<string, unknown>
  detections: ContentDetection[]
  /** Object Block > selection > clipboard (host-resolved). */
  contentText?: string
  /** Foreground application name when available. */
  foregroundApp?: string
}

export type IntentMatchFn = (ctx: IntentMatchContext) => IntentHit[] | null

/**
 * Runtime matcher registration (plugin tools / host adapters).
 * `accepts` is required for intent participation; missing accepts skips the matcher.
 */
export type IntentMatcher = {
  id: string
  pluginId: string
  /** Higher runs first; default 0. */
  priority?: number
  accepts?: ContentAccepts
  match?: IntentMatchFn
}

export type IntentRunOptions = {
  /** Soft wall-clock budget per match call (ms). Default 8. */
  matchTimeoutMs?: number
  /** Injectable clock for tests; defaults to performance.now / Date.now. */
  now?: () => number
  /** Cap hits kept from a single plugin. Default 3. */
  maxHitsPerPlugin?: number
  /** Cap total hits across all plugins. Default 12. */
  maxHitsGlobal?: number
}
