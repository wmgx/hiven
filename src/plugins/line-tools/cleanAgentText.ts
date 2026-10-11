/** Deliberately recognizes complete plain boxes, never individual pipe characters.
 * One space on each side is frame padding; additional whitespace is source text.
 * ASCII and common full-width CJK use terminal columns. Ambiguous widths stay intact.
 */
function terminalColumns(text: string): number | undefined {
  let columns = 0
  for (const char of text) {
    if (/[\p{Mark}\p{Extended_Pictographic}]/u.test(char)) return undefined
    const point = char.codePointAt(0)!
    if ((point >= 0x20 && point <= 0x7e) || char === '│') columns += 1
    else if ((point >= 0x1100 && point <= 0x115f)
      || (point >= 0x2e80 && point <= 0xa4cf && point !== 0x303f)
      || (point >= 0xac00 && point <= 0xd7a3)
      || (point >= 0xf900 && point <= 0xfaff)
      || (point >= 0xfe30 && point <= 0xfe6f)
      || (point >= 0xff01 && point <= 0xff60)
      || (point >= 0xffe0 && point <= 0xffe6)
      || (point >= 0x20000 && point <= 0x3fffd)) columns += 2
    else return undefined // Emoji, combining marks, controls, and ambiguous-width symbols.
  }
  return columns
}

export function cleanAgentText(input: string, includeAscii = false): string {
  const lines = input.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)!.filter((line, index, all) => line.length || index < all.length - 1)
  const content = (line: string) => line.replace(/(?:\r\n|\r|\n)$/, '')
  const ending = (line: string) => line.slice(content(line).length)
  const output: string[] = []
  let fence: { char: string; length: number } | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = content(lines[i])
    const fenced = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      if (fenced && fenced[1][0] === fence.char && fenced[1].length >= fence.length && !fenced[2].trim()) fence = undefined
      output.push(lines[i]); continue
    }
    if (fenced) {
      fence = { char: fenced[1][0], length: fenced[1].length }
      output.push(lines[i]); continue
    }
    // No titled edges, dashed edges, nesting, tables, or unmatched frame fragments.
    const top = /^( *)(╭─{3,}╮|┌─{3,}┐|\+-{3,}\+)$/.exec(line)
    if (!top || (!includeAscii && top[2][0] === '+')) { output.push(lines[i]); continue }
    const indent = top[1]
    const frame = top[2]
    const ascii = frame[0] === '+'
    const side = ascii ? '|' : '│'
    const bottom = indent + (ascii ? frame : frame[0] === '╭' ? `╰${frame.slice(1, -1)}╯` : `└${frame.slice(1, -1)}┘`)
    const width = Array.from(frame).length
    const body: string[] = []
    let end = i + 1
    for (; end < lines.length; end++) {
      const row = content(lines[end])
      if (row === bottom) break
      if (!row.startsWith(`${indent}${side} `) || !row.endsWith(` ${side}`)
        || terminalColumns(row.slice(indent.length)) !== width) break
      const inner = row.slice(indent.length + 2, -2)
      if (/[\u2500-\u257f\x1b\t]/.test(inner) || /^\s*[|+]/.test(inner)) break
      body.push(indent + inner + ending(lines[end]))
    }
    if (!body.length || end >= lines.length || content(lines[end]) !== bottom) {
      // A malformed outer frame may contain a valid-looking inner box. Preserve
      // the entire uncertain region instead of recursively cleaning that fragment.
      let boundary = end
      while (boundary < lines.length && content(lines[boundary]) !== bottom) boundary++
      const last = Math.min(boundary, lines.length - 1)
      for (let keep = i; keep <= last; keep++) output.push(lines[keep])
      i = last
      continue
    }
    // The removed bottom edge owns the block's final newline, including EOF.
    body[body.length - 1] = content(body[body.length - 1]) + ending(lines[end])
    for (const row of body) output.push(row)
    i = end
  }
  return output.join('')
}
