import type { MatchResult } from './regexCore'

export type RegexExtractionTarget = 'whole' | `group:${number}` | `name:${string}`
export const MAX_REGEX_EXTRACTION_BYTES = 1024 * 1024
export type RegexMatchExtraction =
  | { status: 'ready'; text: string }
  | { status: 'invalid' | 'no-matches' | 'empty-matches' | 'missing-group' | 'empty-group' | 'truncated' | 'too-large'; text: '' }

/** Extract complete values, including those beyond the visible preview. */
export function extractRegexMatches(result: {
  error: string | null
  matches: readonly MatchResult[]
  truncated?: boolean
}, target: RegexExtractionTarget = 'whole'): RegexMatchExtraction {
  if (result.error !== null) return { status: 'invalid', text: '' }
  if (result.truncated) return { status: 'truncated', text: '' }
  if (result.matches.length === 0) return { status: 'no-matches', text: '' }
  const values = result.matches.map((match) => target === 'whole' ? match.text
    : target.startsWith('group:') ? match.groups[Number(target.slice(6)) - 1]
      : Object.hasOwn(match.namedGroups ?? {}, target.slice(5)) ? match.namedGroups![target.slice(5)] : undefined)
  // A line list cannot distinguish an absent capture from an empty captured value.
  // Refuse explicitly instead of silently skipping records or inventing content.
  if (values.some((value) => value === undefined)) return { status: 'missing-group', text: '' }
  if (target !== 'whole' && values.some((value) => value === '')) return { status: 'empty-group', text: '' }
  if (values.every((value) => value!.length === 0)) return { status: 'empty-matches', text: '' }
  let bytes = Math.max(0, values.length - 1)
  const encoder = new TextEncoder()
  for (const value of values) {
    bytes += encoder.encode(value!).byteLength
    if (bytes > MAX_REGEX_EXTRACTION_BYTES) return { status: 'too-large', text: '' }
  }
  return { status: 'ready', text: values.join('\n') }
}
