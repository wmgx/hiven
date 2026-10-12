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

export function layoutCss(text: string, compact: boolean): string {
  // Custom property values may contain arbitrary blocks and meaningful whitespace.
  // Escaped identifiers can also spell custom properties: retain rather than guess.
  if (/--[^:{};]*:|\\/.test(text)) return text
  let output = ''
  let parentheses = 0
  let brackets = 0
  let depth = 0
  let boundary = false
  for (let i = 0; i < text.length;) {
    const end = protectedEnd(text, i, false)
    if (end === -1) return text
    if (end !== undefined) { output += text.slice(i, end); i = end; boundary = false; continue }
    const char = text[i++]
    if (boundary && /[\t\r\n ]/.test(char)) continue
    boundary = false
    if (char === '(') parentheses++
    if (char === ')') parentheses--
    if (char === '[') brackets++
    if (char === ']') brackets--
    if (parentheses < 0 || brackets < 0) return text
    if (!parentheses && !brackets && (char === '{' || char === '}' || char === ';')) {
      if (char === '}') {
        if (--depth < 0) return text
        output = output.replace(/[\t\r\n ]+$/, '')
        output += compact ? '}' : `\n${'  '.repeat(depth)}}\n${'  '.repeat(depth)}`
      } else if (char === '{') {
        output = output.replace(/[\t\r\n ]+$/, '')
        depth++
        output += compact ? '{' : ` {\n${'  '.repeat(depth)}`
      } else output += compact ? ';' : `;\n${'  '.repeat(depth)}`
      boundary = true
    } else output += char
  }
  return parentheses || brackets || depth ? text : output.trim()
}
