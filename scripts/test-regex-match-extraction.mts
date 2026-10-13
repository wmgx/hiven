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
assert.deepEqual(capped, { status: 'truncated', text: '' }, 'never deliver a capped set as complete')
assert.equal(cappedResult.matches[100].text, 'id100', 'extraction does not mutate the current matches')

console.log('Regex match extraction passed: whole matches, exact text, caps, empty results and line-tools journey')

const captured = evaluateRegex('order=(?<id>[0-9]+)', 'g', 'order=00123 order=9007199254740993 order=00123')
for (const target of ['group:1', 'name:id'] as const) {
  const out = extractRegexMatches(captured, target)
  assert.deepEqual(out, { status: 'ready', text: '00123\n9007199254740993\n00123' })
  assert.equal(sqlInString(dedupLines(out.text, false)), "('00123','9007199254740993')")
}
for (const target of ['group:1', 'name:id'] as const) {
  assert.equal(extractRegexMatches(evaluateRegex('(?<id>a)?b', 'g', 'ab b'), target).status, 'missing-group')
  assert.equal(extractRegexMatches(evaluateRegex('(?<id>a*)b', 'g', 'ab b'), target).status, 'empty-group')
}
assert.equal(extractRegexMatches(captured, 'group:2').status, 'missing-group')
assert.equal(extractRegexMatches(captured, 'name:toString').status, 'missing-group')
assert.equal(extractRegexMatches(evaluateRegex('(.+)', 'gs', ' 空白 \r\n001 '), 'group:1').text, ' 空白 \r\n001 ')
const exact = evaluateRegex('x', 'g', 'x'.repeat(MAX_REGEX_MATCHES))
assert.equal(exact.truncated, undefined)
assert.equal(extractRegexMatches(exact).status, 'ready')
assert.equal(evaluateRegex('(?=.)', 'gu', '😀'.repeat(MAX_REGEX_MATCHES + 1)).truncated, true)
assert.equal(extractRegexMatches(evaluateRegex('(.*)', '', 'a'.repeat(1024 * 1024)), 'group:1').status, 'ready')
assert.equal(extractRegexMatches(evaluateRegex('(.*)', '', '中'.repeat(400000)), 'group:1').status, 'too-large')
console.log('Capture extraction: numbered/named, missing/empty, exact boundaries and complete log journey passed')
