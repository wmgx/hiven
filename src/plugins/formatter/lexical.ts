/** Protect lexical payloads before changing layout. Unknown/incomplete input is retained. */
function protectedEnd(text: string, start: number, sql: boolean): number | undefined {
  const char = text[start]
  if (text.startsWith('/*', start)) {
    let depth = 1
    for (let i = start + 2; i < text.length - 1; i++) {
      if (sql && text.startsWith('/*', i)) { depth++; i++ }
      else if (text.startsWith('*/', i)) { if (--depth === 0) return i + 2; i++ }
    }
    return -1
  }
  if (sql && (text.startsWith('--', start) || char === '#')) {
    const end = text.indexOf('\n', start)
    return end < 0 ? text.length : end + 1
  }
  if (sql && char === '$') {
    const tag = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(text.slice(start))?.[0]
    if (tag) { const end = text.indexOf(tag, start + tag.length); return end < 0 ? -1 : end + tag.length }
  }
  if (char === '"' || char === "'" || (sql && (char === '`' || char === '['))) {
    const closing = char === '[' ? ']' : char
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === '\\') { i++; continue }
      if (text[i] === closing) {
        if (sql && text[i + 1] === closing) { i++; continue }
        return i + 1
      }
    }
    return -1
  }
  return undefined
}

export function compactSql(text: string): string {
  // Oracle alternative quoting is not part of this layout-only scanner.
  if (/\bq'/i.test(text)) return text
  let output = ''
  for (let i = 0; i < text.length;) {
    const end = protectedEnd(text, i, true)
    if (end === -1) return text
    if (end !== undefined) { output += text.slice(i, end); i = end; continue }
    if (text[i] === ' ' || text[i] === '\t') {
      while (text[i] === ' ' || text[i] === '\t') i++
      output += ' '
    } else output += text[i++]
  }
  // Newlines can separate SQL string literals and terminate line comments.
  return output
}

/** The scanner could not prove a safe layout (unclosed string/comment/bracket): report instead of guessing. */
export class CssFormatterError extends Error {
  readonly code = 'invalidCss' as const
  constructor() { super('invalidCss') }
}

/** End (exclusive) of a custom property value that starts at `start`, stopping at a top-level `;` or `}`. */
function customPropertyValueEnd(text: string, start: number): number {
  let nesting = 0
  for (let i = start; i < text.length;) {
    const end = protectedEnd(text, i, false)
    if (end === -1) throw new CssFormatterError()
    if (end !== undefined) { i = end; continue }
    const char = text[i]
    if (char === '\\') { i += 2; continue }
    if (char === '(' || char === '[' || char === '{') nesting++
    else if (char === ')' || char === ']') nesting--
    else if (char === '}') { if (nesting === 0) return i; nesting-- }
    else if (char === ';' && nesting === 0) return i
    i++
  }
  throw new CssFormatterError()
}

/** Compact mode: no whitespace around the declaration colon or before `;`. */
function tightenDeclaration(segment: string): string {
  return segment.replace(/^\s+/, '').replace(/^([^:]*?)\s*:\s*/, '$1:').replace(/\s+$/, '')
}

export function layoutCss(text: string, compact: boolean): string {
  let output = ''
  let segmentStart = 0
  let parentheses = 0
  let brackets = 0
  let depth = 0
  let boundary = false
  const finishDeclaration = () => {
    if (compact && depth > 0) output = output.slice(0, segmentStart) + tightenDeclaration(output.slice(segmentStart))
  }
  for (let i = 0; i < text.length;) {
    const end = protectedEnd(text, i, false)
    if (end === -1) throw new CssFormatterError()
    if (end !== undefined) { output += text.slice(i, end); i = end; boundary = false; continue }
    // Escaped characters (`.sm\:flex`) are identifier text, never structure.
    if (text[i] === '\\' && i + 1 < text.length) { output += text.slice(i, i + 2); i += 2; boundary = false; continue }
    // Custom property values may contain blocks and meaningful whitespace: keep them verbatim.
    if (boundary && depth > 0 && !parentheses && !brackets) {
      const name = /^--[^\s:;{}()\[\]"']*\s*:/.exec(text.slice(i))
      if (name) {
        const valueStart = i + name[0].length
        const valueEnd = customPropertyValueEnd(text, valueStart)
        const value = text.slice(valueStart, valueEnd).trim()
        output += text.slice(i, valueStart).replace(/\s+:$/, ':') + (value && !compact ? ' ' : '') + value
        i = valueEnd
        boundary = false
        continue
      }
    }
    const char = text[i++]
    if (boundary && /[\t\r\n ]/.test(char)) continue
    boundary = false
    if (char === '(') parentheses++
    if (char === ')') parentheses--
    if (char === '[') brackets++
    if (char === ']') brackets--
    if (parentheses < 0 || brackets < 0) throw new CssFormatterError()
    if (!parentheses && !brackets && (char === '{' || char === '}' || char === ';')) {
      if (char === '}') {
        finishDeclaration()
        if (--depth < 0) throw new CssFormatterError()
        output = output.replace(/[\t\r\n ]+$/, '')
        output += compact ? '}' : `\n${'  '.repeat(depth)}}\n${'  '.repeat(depth)}`
      } else if (char === '{') {
        output = output.replace(/[\t\r\n ]+$/, '')
        depth++
        output += compact ? '{' : ` {\n${'  '.repeat(depth)}`
      } else {
        finishDeclaration()
        output += compact ? ';' : `;\n${'  '.repeat(depth)}`
      }
      segmentStart = output.length
      boundary = true
    } else output += char
  }
  if (parentheses || brackets || depth) throw new CssFormatterError()
  return output.trim()
}
