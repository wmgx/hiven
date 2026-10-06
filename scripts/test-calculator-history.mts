import assert from 'node:assert/strict'
import { readHistory, rememberCalculation } from '../src/plugins/calculator/history.ts'

let history = Array.from({ length: 12 }, (_, value) => ({ expression: `${value}+1`, result: `${value + 1}` }))
history = rememberCalculation(history, { expression: 'a*a', result: '4' })
history = rememberCalculation(history, { expression: 'a*a', result: '9' })
history = rememberCalculation(history, { expression: 'a*a', result: '4' })
const reopened = readHistory(JSON.parse(JSON.stringify(history)))
assert.equal(reopened.length, 14)
assert.deepEqual(reopened.slice(0, 2), [{ expression: 'a*a', result: '4' }, { expression: 'a*a', result: '9' }])

assert.deepEqual(readHistory([null, {}, { expression: 1, result: '2' }, { expression: '1+1', result: '2', variables: { a: '1' } }]), [
  { expression: '1+1', result: '2' },
])
console.log('calculator history checks passed')
