import assert from 'node:assert/strict'
import { createJiti } from 'jiti'
const { compareLists, MAX_LIST_BYTES, MAX_LIST_LINES } = await createJiti(import.meta.url).import('../src/plugins/textDiff/compareLists.ts')
const result = compareLists('a\nb\n b \n\nc', 'b\nc\nd')
assert.deepEqual(result, {
  ok: true, values: { leftOnly: ['a'], common: ['b', 'c'], rightOnly: ['d'], union: ['a', 'b', 'c', 'd'] },
  ignored: { left: 1, right: 0 }, duplicates: { left: 1, right: 0 },
})
assert.deepEqual(compareLists(' 001\r\nBob\ralice\n001\n\n Carol \n9007199254740993', 'alice\nbob\n002\n \t\n001\nCarol').values,
  { leftOnly: ['Bob', '9007199254740993'], common: ['001', 'alice', 'Carol'], rightOnly: ['bob', '002'], union: ['001', 'Bob', 'alice', 'Carol', '9007199254740993', 'bob', '002'] })
assert.equal(compareLists('中'.repeat(Math.floor(MAX_LIST_BYTES / 3) + 1), '').reason, 'bytes')
assert.equal(compareLists(Array(MAX_LIST_LINES + 1).fill('x').join('\n'), '').reason, 'lines')
console.log('Set comparison: trimmed unique lists, source order, exact matching and input caps passed')
