import assert from 'node:assert/strict'
import { formatChineseNumeral, parseChineseNumeralQuery } from '../src/plugins/calculator/chineseNumeral.ts'
import { parseRadixQuery } from '../src/plugins/calculator/radixAnswer.ts'

for (const [input, expected] of [
  ['12345', '壹万贰仟叁佰肆拾伍'], ['0', '零'], ['-0', '零'], ['-10010', '负壹万零壹拾'],
  ['10', '壹拾'], ['100000001', '壹亿零壹'], ['100010001', '壹亿零壹万零壹'],
  ['10001000', '壹仟万壹仟'], ['10010000', '壹仟零壹万'], ['1000000000001', '壹兆零壹'],
  ['100100000', '壹亿零壹拾万'], ['00000101', '壹佰零壹'],
]) {
  assert.deepEqual(formatChineseNumeral(input, 'integer'), { ok: true, text: expected, mode: 'integer' }, input)
}
for (const [input, expected] of [
  ['0', '零元整'], ['-0.00', '零元整'], ['0.01', '零元壹分'], ['0.10', '零元壹角整'],
  ['1.01', '壹元零壹分'], ['12345.67', '壹万贰仟叁佰肆拾伍元陆角柒分'],
  ['-10.50', '负壹拾元伍角整'], ['9999999999999999.99', '玖仟玖佰玖拾玖兆玖仟玖佰玖拾玖亿玖仟玖佰玖拾玖万玖仟玖佰玖拾玖元玖角玖分'],
]) {
  assert.deepEqual(formatChineseNumeral(input, 'money'), { ok: true, text: expected, mode: 'money' }, input)
}
assert.deepEqual(formatChineseNumeral('1.000', 'money'), { ok: false, error: 'precision' })
assert.deepEqual(formatChineseNumeral('1.00', 'integer'), { ok: false, error: 'integer' })
assert.deepEqual(formatChineseNumeral('10000000000000000', 'integer'), { ok: false, error: 'range' })
for (const input of ['1e4', 'NaN', '1,234', '.25', '1.', '1/2']) assert.deepEqual(formatChineseNumeral(input, 'money'), { ok: false, error: 'invalid' })
for (const input of ['12345', '12345.67', '1+2', 'hello']) assert.equal(parseChineseNumeralQuery(input), null)
for (const input of ['12345 大写', '大写12345', '数字大写 12345', '中文大写 12345']) assert.deepEqual(parseChineseNumeralQuery(input), formatChineseNumeral('12345', 'integer'))
for (const input of ['金额大写 1.01', 'RMB 1.01', 'CNY 1.01', '人民币 1.01元大写', '1.01 元大写', '￥1.01']) assert.deepEqual(parseChineseNumeralQuery(input), formatChineseNumeral('1.01', 'money'), input)

assert.deepEqual(parseRadixQuery('0xFF'), { ok: true, answers: [{ base: 10, text: '255' }, { base: 2, text: '0b11111111' }] })
assert.deepEqual(parseRadixQuery('-0xFF'), { ok: true, answers: [{ base: 10, text: '-255' }, { base: 2, text: '-0b11111111' }] })
assert.deepEqual(parseRadixQuery('0b1010'), { ok: true, answers: [{ base: 10, text: '10' }, { base: 16, text: '0xA' }] })
assert.deepEqual(parseRadixQuery('0o377'), { ok: true, answers: [{ base: 10, text: '255' }, { base: 16, text: '0xFF' }] })
assert.deepEqual(parseRadixQuery('255 to hex'), { ok: true, answers: [{ base: 16, text: '0xFF' }] })
assert.deepEqual(parseRadixQuery('hex FF to dec'), { ok: true, answers: [{ base: 10, text: '255' }] })
assert.deepEqual(parseRadixQuery('二进制 1010 转 十进制'), { ok: true, answers: [{ base: 10, text: '10' }] })
assert.deepEqual(parseRadixQuery('dec -0'), { ok: true, answers: [{ base: 16, text: '0x0' }, { base: 2, text: '0b0' }] })
const huge = '9'.repeat(256)
assert.deepEqual(parseRadixQuery(`${huge} to hex`), { ok: true, answers: [{ base: 16, text: `0x${BigInt(huge).toString(16).toUpperCase()}` }] })
for (const input of ['0x', '0xGG', '0b102', '0o89', 'hex 0b10', 'dec 12.3', '1.5 to hex', 'hex -']) assert.deepEqual(parseRadixQuery(input), { ok: false, error: 'invalid' }, input)
for (const input of [`0x${'F'.repeat(257)}`, `${'1'.repeat(257)} to hex`, `bin ${'1'.repeat(400)}`]) assert.deepEqual(parseRadixQuery(input), { ok: false, error: 'limit' }, input)
for (const input of ['12345', '1+2', '0xFF + 1', '0xFF+1', '2^10', 'hex colors', '123 to USD']) {
  if (input === 'hex colors') assert.deepEqual(parseRadixQuery(input), { ok: false, error: 'invalid' })
  else assert.equal(parseRadixQuery(input), null, input)
}
console.log('calculator Chinese numerals and radix checks passed')
