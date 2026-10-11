import assert from 'node:assert/strict'
import { cleanAgentText } from '../src/plugins/line-tools/cleanAgentText.ts'

const box = (rows: string[], ascii = false, eol = '\n') => {
  const width = Math.max(...rows.map((row) => Array.from(row).length))
  return [(ascii ? '+' : '╭') + (ascii ? '-' : '─').repeat(width + 2) + (ascii ? '+' : '╮'),
    ...rows.map((row) => `${ascii ? '|' : '│'} ${row}${' '.repeat(width - Array.from(row).length)} ${ascii ? '|' : '│'}`),
    (ascii ? '+' : '╰') + (ascii ? '-' : '─').repeat(width + 2) + (ascii ? '+' : '╯')].join(eol)
}
assert.equal(cleanAgentText(''), '')
const pipeline = 'cat input | sort'
const code = '  call(a | b)   '
assert.equal(pipeline.length, code.length)
const example = box([pipeline, code])
assert.equal(cleanAgentText(example), `${pipeline}\n${code}`, 'keep shell pipes, indentation, and source spaces')
assert.equal(cleanAgentText(`before\r\n${box(['hello'], false, '\r\n')}\r\nafter\r\n`), 'before\r\nhello\r\nafter\r\n', 'preserve surrounding text and CRLF')
assert.equal(cleanAgentText(box(['one']) + '\n\n' + box(['two']) + '\n'), 'one\n\ntwo\n', 'independent boxes and EOF newline')
assert.equal(cleanAgentText(example.replaceAll('╭', '┌').replaceAll('╮', '┐').replaceAll('╰', '└').replaceAll('╯', '┘')), `${pipeline}\n${code}`)
assert.equal(cleanAgentText('╭──────╮\n│ 中文 │\n╰──────╯'), '中文', 'common CJK uses two terminal columns')
const ascii = box(['hello'], true)
assert.equal(cleanAgentText(ascii), ascii, 'ASCII requires explicit opt-in')
assert.equal(cleanAgentText(ascii, true), 'hello')
for (const source of [
  'cat a | grep b\n| a | b |\n|---|---|\n| 1 | 2 |\n|x| + |y| = z',
  '────────\nnormal\n────────',
  example.split('\n').slice(0, -1).join('\n'),
  example.replace('╮', '┐'),
  example.replace(pipeline, 'short'),
  '╭────────────╮\n' + box(['inner']) + '\n╰────────────╯',
  '╭────────────╮\n' + box(['inner']),
  '```text\n' + example + '\n```',
  '~~~~text\n' + example + '\n~~~~',
  box(['| a | b |', '|---|---|']),
  box(['a ─ b']),
  box(['a\tb']),
  box(['\x1b[31mred']),
  '╭── Title ──╮\n│ content   │\n╰───────────╯',
  '╭────╮\n│ 🙂 │\n╰────╯', // Emoji width is terminal-dependent: preserve rather than guess.
  box(['é']),
  '╭────╮\n│ 〰 │\n╰────╯', // Emoji-style CJK punctuation has ambiguous presentation width.
  '╭──────╮\n│ が │\n╰──────╯', // CJK combining marks must not be mistaken for wide glyphs.
]) assert.equal(cleanAgentText(source, true), source)
assert.equal(cleanAgentText('  ' + box(['a']).replaceAll('\n', '\n  ')), '  a', 'preserve outside indentation')
const long = ['╭───╮', ...Array(130_000).fill('│ x │'), '╰───╯'].join('\n')
assert.equal(cleanAgentText(long), Array(130_000).fill('x').join('\n'), 'full output, no argument-limit failure or truncation')
console.log('Clean Agent Text conservative complete-box tests passed')
