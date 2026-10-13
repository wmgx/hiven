export type MatchResult = {
  index: number
  text: string
  groups: (string | undefined)[]
  namedGroups?: Record<string, string | undefined>
  line: number
  col: number
}

export const MAX_REGEX_MATCHES = 1000

export function evaluateRegex(
  pattern: string,
  flags: string,
  sourceText: string,
): { error: string | null; matches: MatchResult[]; truncated?: boolean } {
  if (!pattern) return { error: null, matches: [] }

  let regex: RegExp
  try {
    regex = new RegExp(pattern, flags)
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), matches: [] }
  }

  const matches: MatchResult[] = []
  if (flags.includes('g')) {
    let match: RegExpExecArray | null
    regex.lastIndex = 0
    while ((match = regex.exec(sourceText)) !== null) {
      // Probe one extra match so exactly-at-limit results remain deliverable.
      if (matches.length === MAX_REGEX_MATCHES) return { error: null, matches, truncated: true }
      matches.push(toMatchResult(sourceText, match))
      if (match[0].length === 0) {
        const codePoint = sourceText.codePointAt(regex.lastIndex)
        regex.lastIndex += (regex.unicode || flags.includes('v')) && codePoint !== undefined && codePoint >= 0x10000
          ? 2
          : 1
      }
    }
  } else {
    const match = regex.exec(sourceText)
    if (match) matches.push(toMatchResult(sourceText, match))
  }
  return { error: null, matches }
}

function toMatchResult(sourceText: string, match: RegExpExecArray): MatchResult {
  const beforeMatch = sourceText.slice(0, match.index)
  const line = beforeMatch.split('\n').length
  const lastNewline = beforeMatch.lastIndexOf('\n')
  return {
    index: match.index,
    text: match[0],
    groups: match.slice(1),
    ...(match.groups ? { namedGroups: { ...match.groups } } : {}),
    line,
    col: match.index - lastNewline,
  }
}
