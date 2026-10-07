import assert from 'node:assert/strict'
import { evaluateRegex, MAX_REGEX_MATCHES } from '../src/plugins/regex-tester/regexCore.ts'
import { extractRegexMatches } from '../src/plugins/regex-tester/extractMatches.ts'
import { dedupLines, sortLines, sqlInString, sqlInNumber } from '../src/plugins/line-tools/core.ts'

function extract(pattern: string, flags: string, source: string) {
  return extractRegexMatches(evaluateRegex(pattern, flags, source))
}

// A synthetic log journey uses the real regex core and existing line-tools operations.
const log = 'received id=beta\nreceived id=alpha\nretried id=beta'
const output = extract('(?<=id=)[a-z]+', 'g', log)
assert.deepEqual(output, { status: 'ready', text: 'beta\nalpha\nbeta' })
assert.equal(sqlInString(sortLines(dedupLines(output.text, false), 'asc', false)), "('alpha','beta')")
const numbers = extract('(?<=id=)\\d+', 'g', 'id=42 id=17 id=42')
assert.equal(sqlInNumber(dedupLines(numbers.text, false)), '(42,17)')

assert.deepEqual(extract('id=(\\d+)', 'g', 'id=42 id=17 id=42'), {
  status: 'ready', text: 'id=42\nid=17\nid=42',
}, 'extract whole matches, not capture groups, preserving order and duplicates')
assert.deepEqual(extract('id=(\\d+)', '', 'id=42 id=17'), {
  status: 'ready', text: 'id=42',
}, 'non-global mode extracts only its current match')
assert.equal(extract('(?<=\\[)[^\\]]*(?=\\])', 'g', '[  alpha\t][beta\r\ngamma][  alpha\t]').text,
  '  alpha\t\nbeta\r\ngamma\n  alpha\t', 'preserve spaces, tabs, embedded newlines and duplicates')
assert.deepEqual(extract('\\s+', 'g', ' \t'), { status: 'ready', text: ' \t' }, 'actual whitespace remains matched content')
assert.deepEqual(extract('a*', 'g', 'a'), { status: 'ready', text: 'a\n' }, 'retain zero-length matches alongside matched text')

for (const [pattern, flags, source, status] of [
  ['', 'g', 'sample', 'no-matches'],
  ['z', 'g', 'sample', 'no-matches'],
  ['x', 'g', '', 'no-matches'],
  ['[', 'g', 'sample', 'invalid'],
  ['x', 'gg', 'sample', 'invalid'],
  ['^', '', 'sample', 'empty-matches'],
  ['(?=a)', 'g', 'aa', 'empty-matches'],
  ['(?=.)', 'gu', '😀x', 'empty-matches'],
] as const) {
  assert.deepEqual(extract(pattern, flags, source), { status, text: '' }, `${pattern}/${flags} has no extractable matched text`)
}

const manyIds = Array.from({ length: MAX_REGEX_MATCHES + 5 }, (_, index) => `id${index}`)
const cappedResult = evaluateRegex('id\\d+', 'g', manyIds.join(' '))
const capped = extractRegexMatches(cappedResult)
assert.equal(cappedResult.matches.length, MAX_REGEX_MATCHES)
assert.equal(capped.text, manyIds.slice(0, MAX_REGEX_MATCHES).join('\n'), 'extract the full current set beyond the 100-row preview, within the core cap')
assert.equal(cappedResult.matches[100].text, 'id100', 'extraction does not mutate the current matches')

console.log('Regex match extraction passed: whole matches, exact text, caps, empty results and line-tools journey')
