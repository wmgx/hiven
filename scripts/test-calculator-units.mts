import assert from 'node:assert/strict'
import { convertUnitQuery } from '../src/plugins/calculator/unitConversion.ts'

function check(query: string, text: string, approximate = false) {
  const result = convertUnitQuery(query)
  assert.ok(result?.ok, query)
  assert.equal(result.text, text, query)
  assert.equal(result.approximate, approximate, query)
}

check('5 ft to cm', '152.4 cm')
check('1 mi in km', '1.609344 km')
check('1 in to cm', '2.54 cm')
check('1 lb to kg', '0.45359237 kg')
check('16 oz to lb', '1 lb')
check('2 kg to lb', '4.4092452437 lb', true)
check('1 m to ft', '3.28083989501 ft', true)
check('1 t to kg', '1000 kg')
check('1 KB to B', '1000 B')
check('1 kB to b', '8000 b')
check('1 KiB to B', '1024 B')
check('1 Kib to B', '128 B')
check('1 MB to Mb', '8 Mb')
check('1 Mb to MB', '0.125 MB')
check('1 GiB to GB', '1.073741824 GB')
check('1 TB to TiB', '0.909494701773 TiB', true)
check('1 byte to bits', '8 b')
check('1e-30 mm to km', '1e-36 km')
check('1e30 km to mm', '1e+36 mm')
check('-0 kg to g', '0 g')
check('  +.5 kg -> g  ', '500 g')
check('1米转厘米', '100 cm')
check('2 公斤换算为磅', '4.4092452437 lb', true)
assert.deepEqual(convertUnitQuery('1 m to kg'), { ok: false, error: 'dimension' })
assert.deepEqual(convertUnitQuery('1 KB to kb'), { ok: true, value: '8', unit: 'Kb', text: '8 Kb', approximate: false, dimension: 'data' })
for (const query of ['1 mb to MB', '1 KIB to B', '1 B to bytesx', '1 M to cm']) {
  assert.deepEqual(convertUnitQuery(query), { ok: false, error: 'unit' }, query)
}
for (const query of ['1e31 m to cm', '1e-31 kg to g', '1e9999 B to b']) {
  assert.deepEqual(convertUnitQuery(query), { ok: false, error: 'range' }, query)
}
for (const query of ['1 USD to EUR', '12+4', '1 m', '1 kg to', '1.2.3 kg to g', '1,000 kg to g', '1 kg to g; alert(1)', '1 kg to g\nmore', 'Infinity kg to g']) {
  assert.equal(convertUnitQuery(query), null, query)
}
console.log('calculator unit conversion checks passed')
