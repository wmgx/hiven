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

export function reverseLines(text: string): string {
  return text.split('\n').reverse().join('\n')
}

export function reverseText(text: string): string {
  return Array.from(text).reverse().join('')
}

export function sortLines(text: string, direction: 'asc' | 'desc', ignoreCase: boolean): string {
  return text.split('\n').sort((a, b) => {
    const x = ignoreCase ? a.toLowerCase() : a
    const y = ignoreCase ? b.toLowerCase() : b
    return direction === 'desc' ? y.localeCompare(x) : x.localeCompare(y)
  }).join('\n')
}

export function dedupLines(text: string, ignoreCase: boolean): string {
  const seen = new Set<string>()
  return text.split('\n').filter((line) => {
    const key = ignoreCase ? line.toLowerCase() : line
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).join('\n')
}

export function removeBlankLines(text: string): string {
  return text.split('\n').filter((line) => line.trim() !== '').join('\n')
}

export function trimLineWhitespace(text: string): string {
  return text.split('\n').map((line) => line.trim()).join('\n')
}

export function joinLines(text: string, separator: string): string {
  return text.split('\n').join(separator.replace(/\\n/g, '\n').replace(/\\t/g, '\t'))
}

export function prependLines(text: string, prefix: string): string {
  return text.split('\n').map((line) => prefix + line).join('\n')
}

export function appendLines(text: string, suffix: string): string {
  return text.split('\n').map((line) => line + suffix).join('\n')
}

export function wrapLines(text: string, left: string, right: string): string {
  return text.split('\n').map((line) => left + line + right).join('\n')
}

export function sqlInString(text: string): string {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  return '(' + lines.map((line) => `'${line.trim().replace(/'/g, "''")}'`).join(',') + ')'
}

export function sqlInNumber(text: string): string {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  return '(' + lines.map((line) => line.trim()).join(',') + ')'
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
  if (operation === 'plain-title') return text.replace(/\b\w/g, (character) => character.toUpperCase())
  if (!text) return text
  return text.split('\n').map((line) => line.trim() ? convertIdentifier(line, operation) : line).join('\n')
}

export function getTextStats(text: string): TextStats {
  return {
    lines: text.split('\n').length,
    words: text.split(/\s+/).filter(Boolean).length,
    characters: text.length,
    charactersNoSpace: text.replace(/\s/g, '').length,
  }
}
