import assert from 'node:assert/strict'
import { findDuplicateLines, sourceLineRanges, duplicateLineReport } from '../src/plugins/line-tools/core.ts'

const exact = { ignoreCase: false, trim: false }
const source = 'A\nB\nA\nA'
const groups = findDuplicateLines(source, exact)
assert.equal(source, 'A\nB\nA\nA')
assert.deepEqual(groups, [{ text: 'A', occurrences: [{ line: 1, start: 0, end: 1 }, { line: 3, start: 4, end: 5 }, { line: 4, start: 6, end: 7 }] }])
assert.equal(duplicateLineReport(groups), '"A" ×3 [1, 3, 4]')
assert.deepEqual(findDuplicateLines('A\na\n A \n\tA', exact), [])
assert.deepEqual(findDuplicateLines('A\na\n A \n\tA', { ...exact, ignoreCase: true }).map(({ occurrences }) => occurrences.map(({ line }) => line)), [[1, 2]])
assert.deepEqual(findDuplicateLines('A\na\n A \n\tA', { ...exact, trim: true }).map(({ occurrences }) => occurrences.map(({ line }) => line)), [[1, 3, 4]])
assert.deepEqual(findDuplicateLines('A\na\n A \n\tA', { ignoreCase: true, trim: true }).map(({ occurrences }) => occurrences.map(({ line }) => line)), [[1, 2, 3, 4]])
assert.equal(duplicateLineReport(findDuplicateLines('\n\n', exact)), '"" ×3 [1, 2, 3]', 'blank and trailing lines have real line numbers')
assert.deepEqual(findDuplicateLines('', exact), [])
const unicode = '😀\r\nB\r😀\n😀'
const unicodeGroups = findDuplicateLines(unicode, exact)
assert.deepEqual(unicodeGroups[0].occurrences, [{ line: 1, start: 0, end: 2 }, { line: 3, start: 6, end: 8 }, { line: 4, start: 9, end: 11 }])
for (const range of unicodeGroups[0].occurrences) assert.equal(unicode.slice(range.start, range.end), '😀', 'UTF-16 offsets include full surrogate pairs')
const textareaValue = unicode.replace(/\r\n|\r/g, '\n')
for (const { line } of unicodeGroups[0].occurrences) {
  const range = sourceLineRanges(textareaValue)[line - 1]
  assert.equal(textareaValue.slice(range.start, range.end), '😀', 'DOM-normalized source line maps exactly')
}
const many = findDuplicateLines(Array(100_000).fill('A').join('\n'), exact)
assert.equal(many[0].occurrences.length, 100_000)
assert.equal(many[0].occurrences.at(-1)?.line, 100_000)
assert.ok(duplicateLineReport(many).endsWith('99999, 100000]'), 'visual pagination never truncates the full copy report')
assert.deepEqual(findDuplicateLines('B\nA\nB\nA', exact).map(({ text }) => text), ['B', 'A'], 'first source occurrence order')
console.log('duplicate line grouping and source locations passed')
