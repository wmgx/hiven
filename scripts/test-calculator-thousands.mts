import assert from 'node:assert/strict'
import { formatThousands, parseThousandsQuery, MAX_GROUPED_NUMBER_LENGTH } from '../src/plugins/calculator/thousandsAnswer.ts'

for (const [input, expected] of [
  ['12345', '12,345'], ['12345.6700', '12,345.6700'], ['-1234567.00', '-1,234,567.00'],
  ['+1234', '+1,234'], ['-0.000', '-0.000'], ['0', '0'], ['123', '123'], ['123456', '123,456'],
  ['0001234.0500', '0,001,234.0500'], ['90071992547409931234567890.0001', '90,071,992,547,409,931,234,567,890.0001'],
]) assert.deepEqual(formatThousands(input), { ok: true, text: expected }, input)
for (const input of ['1,234', '1,23', '1.234,56']) assert.deepEqual(formatThousands(input), { ok: false, error: 'comma' })
for (const input of ['', '1 234', '1e6', '.5', '1.', '--1', '1+2', 'NaN', '１２３４', '1\n234']) assert.deepEqual(formatThousands(input), { ok: false, error: 'invalid' }, input)
for (const input of ['千分位 12345.6700', '千分位12345.6700', '千分位格式化 12345.6700', 'thousands 12345.6700', 'group number 12345.6700', 'format number 12345.6700']) {
  assert.deepEqual(parseThousandsQuery(input), { ok: true, text: '12,345.6700' }, input)
}
for (const input of ['12345.67', '12345', '1+2', 'thousandsomething']) assert.equal(parseThousandsQuery(input), null)
assert.deepEqual(parseThousandsQuery('thousands'), { ok: false, error: 'invalid' })
const long = '9'.repeat(MAX_GROUPED_NUMBER_LENGTH)
const formatted = formatThousands(long)
assert.ok(formatted.ok)
assert.equal(formatted.text.replaceAll(',', ''), long, 'all digits survive; never Number or a preview')
assert.deepEqual(formatThousands(long + '9'), { ok: false, error: 'limit' })
console.log('calculator thousands formatting passed')
