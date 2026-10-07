import type { MatchResult } from './regexCore'

export type RegexMatchExtraction =
  | { status: 'ready'; text: string }
  | { status: 'invalid' | 'no-matches' | 'empty-matches'; text: '' }

/** Extract whole matches, including those beyond the visible preview. */
export function extractRegexMatches(result: {
  error: string | null
  matches: readonly MatchResult[]
}): RegexMatchExtraction {
  if (result.error !== null) return { status: 'invalid', text: '' }
  if (result.matches.length === 0) return { status: 'no-matches', text: '' }
  // Separators alone are not matched content. Actual whitespace matches remain valid.
  if (result.matches.every((match) => match.text.length === 0)) {
    return { status: 'empty-matches', text: '' }
  }
  return { status: 'ready', text: result.matches.map((match) => match.text).join('\n') }
}
