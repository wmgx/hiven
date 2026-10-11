/** Literal pattern source, not a quoted JS string, and never executed here. */
export function escapeRegexPattern(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/\r\n\t\f\v\u2028\u2029\u0000]/g, (character) => {
    switch (character) {
      case '\n': return '\\n'
      case '\r': return '\\r'
      case '\t': return '\\t'
      case '\f': return '\\f'
      case '\v': return '\\v'
      case '\u2028': return '\\u2028'
      case '\u2029': return '\\u2029'
      case '\u0000': return '\\x00'
      default: return `\\${character}`
    }
  })
}
