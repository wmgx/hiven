/**
 * Content kind taxonomy for launcher intelligence.
 * Pure data — no framework / workspace / plugin dependencies.
 */

export type ContentKind =
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
  | 'url-encoded'
  | 'color'
  | 'tsv'

export type ContentDetection = {
  kind: ContentKind
  /** 0–1 confidence; high values reserved for low-false-positive signals. */
  confidence: number
  /** Trimmed / lightly normalized text used for matching. */
  normalized: string
  /** Optional structured captures (e.g. decoded base64, timestamp unit). */
  captures?: Record<string, string>
}
