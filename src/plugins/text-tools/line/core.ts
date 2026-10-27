export type LineOperation =
  | 'sort'
  | 'dedup'
  | 'reverse'
  | 'reverse-text'
  | 'remove-blank-lines'
  | 'trim-whitespace'
  | 'join'
  | 'prepend'
  | 'append'
  | 'wrap'
  | 'sql-string'
  | 'sql-number'

export type LineOptions = {
  direction: 'asc' | 'desc'
  ignoreCase: boolean
  separator: string
  prefix: string
  suffix: string
  left: string
  right: string
}

export type CaseStyle =
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'constant'
  | 'kebab'
  | 'train'
  | 'dot'
  | 'path'
  | 'lower'
  | 'upper'
  | 'title'

export type CaseOperation =
  | 'plain-upper'
  | 'plain-lower'
  | 'plain-title'
  | CaseStyle

export type TextStats = {
  lines: number
  words: number
  characters: number
  charactersNoSpace: number
}

/** Raised for input a line operation cannot represent safely (surfaced as an i18n message by callers). */
export class LineToolsError extends Error {
  readonly code: 'sqlNumber'
  readonly value: string
  constructor(code: 'sqlNumber', value: string) { super(code); this.code = code; this.value = value }
}

/**
 * Line operations act on lines, not on the final line terminator: strip one trailing newline,
 * split on LF or CRLF, then restore the trailing newline and join with the text's own separator.
 */
function mapLines(text: string, transform: (lines: string[]) => string[]): string {
  const eol = /\r?\n/.exec(text)?.[0] ?? '\n'
  const tail = /\r?\n$/.exec(text)?.[0] ?? ''
  const lines = (tail ? text.slice(0, -tail.length) : text).split(/\r?\n/)
  const result = transform(lines)
  return result.length === 0 ? '' : result.join(eol) + tail
}

export function reverseLines(text: string): string {
  return mapLines(text, (lines) => [...lines].reverse())
}

export function reverseText(text: string): string {
  return Array.from(text).reverse().join('')
}

export function sortLines(text: string, direction: 'asc' | 'desc', ignoreCase: boolean): string {
  return mapLines(text, (lines) => [...lines].sort((a, b) => {
    const x = ignoreCase ? a.toLowerCase() : a
    const y = ignoreCase ? b.toLowerCase() : b
    return direction === 'desc' ? y.localeCompare(x) : x.localeCompare(y)
  }))
}

export function dedupLines(text: string, ignoreCase: boolean): string {
  const seen = new Set<string>()
  return mapLines(text, (lines) => lines.filter((line) => {
    const key = ignoreCase ? line.toLowerCase() : line
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }))
}

export type SourceLineRange = { line: number; start: number; end: number }
export type DuplicateLineGroup = { text: string; occurrences: SourceLineRange[] }

/** Preserve original offsets and every line, including blank/trailing lines. */
export function sourceLineRanges(text: string): SourceLineRange[] {
  if (!text.length) return []
  const ranges: SourceLineRange[] = []
  let start = 0
  for (const match of text.matchAll(/\r\n|\r|\n/g)) {
    ranges.push({ line: ranges.length + 1, start, end: match.index })
    start = match.index + match[0].length
  }
  ranges.push({ line: ranges.length + 1, start, end: text.length })
  return ranges
}

/** Same exact/lowercase key semantics as dedupLines; only explicit trim changes keys. */
export function findDuplicateLines(text: string, options: { ignoreCase: boolean; trim: boolean }): DuplicateLineGroup[] {
  const groups = new Map<string, DuplicateLineGroup>()
  for (const occurrence of sourceLineRanges(text)) {
    const original = text.slice(occurrence.start, occurrence.end)
    const trimmed = options.trim ? original.trim() : original
    const key = options.ignoreCase ? trimmed.toLowerCase() : trimmed
    const existing = groups.get(key)
    if (existing) existing.occurrences.push(occurrence)
    else groups.set(key, { text: original, occurrences: [occurrence] })
  }
  return [...groups.values()].filter((group) => group.occurrences.length > 1)
}

/** Quoting makes empty lines, tabs and edge whitespace unambiguous in the report. */
export function duplicateLineReport(groups: DuplicateLineGroup[]): string {
  return groups.map((group) => `${JSON.stringify(group.text)} ×${group.occurrences.length} [${group.occurrences.map(({ line }) => line).join(', ')}]`).join('\n')
}

export function removeBlankLines(text: string): string {
  return mapLines(text, (lines) => lines.filter((line) => line.trim() !== ''))
}

export function trimLineWhitespace(text: string): string {
  return mapLines(text, (lines) => lines.map((line) => line.trim()))
}

export type LineListCleanupOptions = {
  trim: boolean
  removeBlank: boolean
  dedup: boolean
}

/**
 * Clean in a fixed order: trim edges, remove blank lines, then exact deduplication.
 * Each retained line owns its original LF/CRLF/CR separator; removing a line
 * removes that separator too. The final retained line keeps its separator only
 * when the input ended with one. A trailing separator is not a phantom empty row.
 * Trimming a final whitespace-only row can expose the preceding separator
 * ("Ada\n  " becomes "Ada\n"); keep that empty row when removeBlank is off.
 * If new neighbors would join a lone CR with an empty row's LF, extend that CR
 * to CRLF before appending the LF, so the two separators cannot swallow a row.
 */
export function cleanLineList(text: string, options: Partial<LineListCleanupOptions> = {}): string {
  const { trim = false, removeBlank = true, dedup = false } = options
  if (!trim && !removeBlank && !dedup) return text

  const output: string[] = []
  const seen = new Set<string>()
  const keepLine = (rawLine: string, separator: string) => {
    const line = trim ? rawLine.trim() : rawLine
    if (removeBlank && line.trim() === '') return
    if (dedup && seen.has(line)) return
    if (dedup) seen.add(line)
    output.push(line, separator)
  }
  let offset = 0
  for (const match of text.matchAll(/\r\n|\r|\n/g)) {
    keepLine(text.slice(offset, match.index), match[0])
    offset = match.index + match[0].length
  }
  const hasTrailingSeparator = offset > 0 && offset === text.length
  if (offset < text.length) keepLine(text.slice(offset), '')
  if (!hasTrailingSeparator && output.length > 0) output[output.length - 1] = ''
  for (let index = 2; index < output.length; index += 2) {
    if (output[index] === '' && output[index - 1] === '\r' && output[index + 1] === '\n') {
      output[index - 1] = '\r\n'
    }
  }
  return output.join('')
}

export function joinLines(text: string, separator: string): string {
  const glue = separator.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
  const tail = /\r?\n$/.exec(text)?.[0] ?? ''
  const lines = (tail ? text.slice(0, -tail.length) : text).split(/\r?\n/)
  return lines.join(glue) + tail
}

export function prependLines(text: string, prefix: string): string {
  return mapLines(text, (lines) => lines.map((line) => prefix + line))
}

export function appendLines(text: string, suffix: string): string {
  return mapLines(text, (lines) => lines.map((line) => line + suffix))
}

export function wrapLines(text: string, left: string, right: string): string {
  return mapLines(text, (lines) => lines.map((line) => left + line + right))
}

function nonBlankLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim() !== '')
}

/** Backslashes are doubled so MySQL's default escaping cannot end the literal early. */
export function sqlInString(text: string): string {
  return '(' + nonBlankLines(text).map((line) => `'${line.trim().replace(/\\/g, '\\\\').replace(/'/g, "''")}'`).join(',') + ')'
}

const SQL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

export function sqlInNumber(text: string): string {
  const values = nonBlankLines(text).map((line) => line.trim())
  const invalid = values.find((value) => !SQL_NUMBER.test(value))
  if (invalid !== undefined) throw new LineToolsError('sqlNumber', invalid)
  return '(' + values.join(',') + ')'
}

export function processLines(operation: LineOperation, text: string, options: LineOptions): string {
  switch (operation) {
    case 'sort': return sortLines(text, options.direction, options.ignoreCase)
    case 'dedup': return dedupLines(text, options.ignoreCase)
    case 'reverse': return reverseLines(text)
    case 'reverse-text': return reverseText(text)
    case 'remove-blank-lines': return removeBlankLines(text)
    case 'trim-whitespace': return trimLineWhitespace(text)
    case 'join': return joinLines(text, options.separator)
    case 'prepend': return prependLines(text, options.prefix)
    case 'append': return appendLines(text, options.suffix)
    case 'wrap': return wrapLines(text, options.left, options.right)
    case 'sql-string': return sqlInString(text)
    case 'sql-number': return sqlInNumber(text)
  }
}

export function splitWords(input: string): string[] {
  const normalized = input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-./\\]+/g, ' ')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .trim()
  return normalized ? normalized.split(/\s+/).map((word) => word.toLowerCase()) : []
}

function capitalize(word: string): string {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : word
}

export function joinWords(words: string[], style: CaseStyle): string {
  if (words.length === 0) return ''
  switch (style) {
    case 'camel': return words[0] + words.slice(1).map(capitalize).join('')
    case 'pascal': return words.map(capitalize).join('')
    case 'snake': return words.join('_')
    case 'constant': return words.map((word) => word.toUpperCase()).join('_')
    case 'kebab': return words.join('-')
    case 'train': return words.map(capitalize).join('-')
    case 'dot': return words.join('.')
    case 'path': return words.join('/')
    case 'lower': return words.join(' ')
    case 'upper': return words.map((word) => word.toUpperCase()).join(' ')
    case 'title': return words.map(capitalize).join(' ')
  }
}

export function convertIdentifier(text: string, style: CaseStyle): string {
  const leading = text.match(/^\s*/)?.[0] ?? ''
  const trailing = text.match(/\s*$/)?.[0] ?? ''
  const core = text.slice(leading.length, text.length - trailing.length)
  if (!core) return text
  const words = splitWords(core)
  return words.length > 0 ? leading + joinWords(words, style) + trailing : text
}

export function convertText(text: string, operation: CaseOperation): string {
  if (operation === 'plain-upper') return text.toUpperCase()
  if (operation === 'plain-lower') return text.toLowerCase()
  if (operation === 'plain-title') return text.replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toUpperCase())
  if (!text) return text
  return text.split('\n').map((line) => line.trim() ? convertIdentifier(line, operation) : line).join('\n')
}

function countWords(text: string): number {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    let count = 0
    for (const part of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) if (part.isWordLike) count++
    return count
  }
  return text.split(/\s+/).filter(Boolean).length
}

export function getTextStats(text: string): TextStats {
  return {
    lines: text === '' ? 0 : text.split(/\r?\n/).length,
    words: countWords(text),
    characters: Array.from(text).length,
    charactersNoSpace: Array.from(text.replace(/\s/g, '')).length,
  }
}
