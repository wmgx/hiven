import assert from 'node:assert/strict'
import { columnStatistics } from '../src/plugins/csv/columnStatistics.ts'
import { applyTableQuery, parseSource, processFullSource } from '../src/plugins/csv/csvCore.ts'

const one = async (values: string[]) => (await columnStatistics({ headers: ['value'], rows: values.map((value) => [value]) }, new Set([0])))[0]
const decimal = await one(['0.1', '0.2', '', ' ', 'oops', '1,000', '0x10', 'NaN', 'Infinity', '1e1001', '1e-1001', '0e1001'])
assert.equal(decimal.sum, '0.3')
assert.equal(decimal.average, '0.15')
assert.equal(decimal.averageRounded, false)
assert.equal(decimal.valid, 2)
assert.equal(decimal.empty, 2)
assert.equal(decimal.invalid, 5)
assert.equal(decimal.outOfRange, 3)
const thirds = await one(['1', '0', '0'])
assert.equal(thirds.average, '0.33333333333333333333')
assert.equal(thirds.averageRounded, true)
const distinct = await one(['1', '1.0', ' 1', 'a', 'A', 'a', '', ' ', '0', '-0'])
assert.equal(distinct.distinct, 7)
assert.equal(distinct.valid, 5)
assert.equal(distinct.sum, '3')
assert.equal(distinct.average, '0.6')
assert.equal((await one([])).sum, null)
assert.equal((await one(['oops', ' '])).average, null)
const huge = await one(['1e1000', '-1e1000', '1e-1000', '9'.repeat(101), '0'.repeat(513)])
assert.equal(huge.sum, '1e-1000')
assert.equal(huge.outOfRange, 2)
assert.equal(huge.averageRounded, true)
const cancelled = new AbortController()
cancelled.abort()
await assert.rejects(columnStatistics({ headers: ['value'], rows: [] }, new Set([0]), cancelled.signal), { name: 'AbortError' })
const during = new AbortController()
const pending = columnStatistics({ headers: ['value'], rows: Array.from({ length: 4001 }, () => ['1']) }, new Set([0]), during.signal)
during.abort()
await assert.rejects(pending, { name: 'AbortError' })

// Exercise the complete parsed and filtered result beyond both output and grid previews.
const source = 'group,value\n' + Array.from({ length: 8101 }, (_, i) => `${i === 8100 ? 'tail' : 'other'},${i === 8100 ? '123.45' : '1'}`).join('\n')
const result = await processFullSource(source, { delimiter: 'comma', header: 'first-row', output: 'csv', transforms: { dropEmpty: false, dedupe: false, transpose: false } })
const all = (await columnStatistics(result.table, new Set([1])))[0]
assert.equal(all.rows, 8101)
assert.equal(all.sum, '8223.45')
const filtered = applyTableQuery(result.table, { filterMode: 'sql', sqlFilter: "SELECT * FROM data WHERE group = 'tail'" })
assert.equal(filtered.ok, true)
if (filtered.ok) {
  const value = (await columnStatistics(filtered.table, new Set([1])))[0]
  assert.equal(value.rows, 1)
  assert.equal(value.sum, '123.45')
  assert.equal(value.average, '123.45')
}
const json = parseSource('[{"value":null},{},{"value":" "},{"value":0}]')
assert.equal(json.ok, true)
if (json.ok) {
  const value = (await columnStatistics(json.table, new Set([0])))[0]
  assert.equal(value.empty, 3)
  assert.equal(value.valid, 1)
  assert.equal(value.average, '0')
  assert.equal(value.distinct, 1)
  assert.deepEqual(await columnStatistics(json.table, new Set([1])), [])
}
// A retained column selection follows filtering and sorting, including empty results.
const selected = new Set([1])
const selectionSource = parseSource('group,amount\nkeep,10\ndrop,30', 'comma', 'first-row')
assert.equal(selectionSource.ok, true)
if (selectionSource.ok) {
  assert.equal((await columnStatistics(selectionSource.table, selected))[0].sum, '40')
  for (const globalFilter of ['keep', 'no-match', '']) {
    const query = applyTableQuery(selectionSource.table, { globalFilter, sortColumns: [{ columnKey: 'amount', direction: 'DESC' }] })
    assert.equal(query.ok, true)
    if (query.ok) {
      const summary = (await columnStatistics(query.table, selected))[0]
      assert.equal(summary.sum, globalFilter === 'keep' ? '10' : globalFilter === 'no-match' ? null : '40')
      assert.equal(summary.rows, globalFilter === 'keep' ? 1 : globalFilter === 'no-match' ? 0 : 2)
    }
  }
  assert.deepEqual([...selected], [1])
}

const duplicateHeaders = { headers: ['amount', 'amount'], rows: [['1', '10'], ['2', '20']] }
assert.equal((await columnStatistics(duplicateHeaders, new Set([0])))[0].sum, '3')
assert.equal((await columnStatistics(duplicateHeaders, new Set([1])))[0].sum, '30')
console.log('CSV column statistics checks passed')
