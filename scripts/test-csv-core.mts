#!/usr/bin/env npx tsx
import assert from 'node:assert/strict'
import {
  applyTransforms,
  detectInputKind,
  parseSource,
  processFullSource,
  toOutput,
  type Table,
} from '../src/plugins/csv/csvCore.ts'
import {
  filterRowsBySql,
  filterRowsByText,
  getSqlCompletions,
} from '../src/plugins/csv/csvSqlFilter.ts'

function table(headers: string[], rows: string[][]): Table {
  return { headers, rows }
}

// ─── quoted comma ───────────────────────────────────────────────────────────
{
  const result = parseSource('name,note\nAlice,"hello, world"\n', 'comma', 'first-row')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.deepEqual(result.table.headers, ['name', 'note'])
    assert.deepEqual(result.table.rows[0], ['Alice', 'hello, world'])
  }
}

// ─── quoted newline ─────────────────────────────────────────────────────────
{
  const result = parseSource('a,b\n"1\n2",3\n', 'comma', 'first-row')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.table.rows[0][0], '1\n2')
    assert.equal(result.table.rows[0][1], '3')
  }
}

// ─── escaped quotes ─────────────────────────────────────────────────────────
{
  const result = parseSource('a\n"say ""hi"""\n', 'comma', 'first-row')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.table.rows[0][0], 'say "hi"')
  }
}

// ─── auto TSV ───────────────────────────────────────────────────────────────
{
  const result = parseSource('name\tage\nAda\t30\n', 'auto', 'auto')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.delimiter, '\t')
    assert.deepEqual(result.table.rows[0], ['Ada', '30'])
  }
}

// ─── JSON array input ───────────────────────────────────────────────────────
{
  assert.equal(detectInputKind('[{"a":1}]'), 'json')
  const result = parseSource(JSON.stringify([{ name: 'Ada', age: '30' }, { name: 'Bob' }]), 'auto', 'auto')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.kind, 'json')
    assert.deepEqual(result.table.headers, ['name', 'age'])
    assert.deepEqual(result.table.rows[1], ['Bob', ''])
  }
}

// ─── outputs ────────────────────────────────────────────────────────────────
{
  const t = table(['id', 'name'], [['1', "O'Brien"], ['2', '']])

  const objects = JSON.parse(toOutput(t, 'objects'))
  assert.deepEqual(objects, [{ id: '1', name: "O'Brien" }, { id: '2', name: '' }])

  const arr = JSON.parse(toOutput(t, 'array'))
  assert.deepEqual(arr[0], ['id', 'name'])

  const cols = JSON.parse(toOutput(t, 'columns'))
  assert.deepEqual(cols.id, ['1', '2'])

  const keyed = JSON.parse(toOutput(t, 'keyed'))
  assert.deepEqual(keyed['1'], { name: "O'Brien" })

  const ndjson = toOutput(t, 'ndjson')
  assert.equal(ndjson.split('\n').length, 2)

  const csv = toOutput(t, 'csv')
  assert.match(csv, /id/)
  assert.match(csv, /O'Brien|O''Brien|"O'Brien"/)

  const tsv = toOutput(t, 'tsv')
  assert.match(tsv, /id\tname/)
  assert.match(tsv, /1\tO'Brien/)

  const md = toOutput(t, 'markdown')
  assert.match(md, /\| id \| name \|/)
  assert.match(md, /---/)

  const sql = toOutput(t, 'sql', undefined, { tableName: 'users' })
  assert.match(sql, /INSERT INTO users/)
  assert.match(sql, /O''Brien/)
  assert.match(sql, /NULL/)
  assert.match(sql, /\('2', NULL\)/)
}

// ─── minify ─────────────────────────────────────────────────────────────────
{
  const t = table(['a'], [['1']])
  const pretty = toOutput(t, 'objects', { minify: false, indent: 2 })
  const mini = toOutput(t, 'objects', { minify: true, indent: 2 })
  assert.match(pretty, /\n/)
  assert.equal(mini, '[{"a":"1"}]')
}

// ─── transforms ─────────────────────────────────────────────────────────────
{
  const t = table(['a', 'b'], [
    ['1', 'x'],
    ['', ''],
    ['1', 'x'],
    ['2', 'y'],
  ])
  const cleaned = applyTransforms(t, { dropEmpty: true, dedupe: true, transpose: false })
  assert.deepEqual(cleaned.rows, [['1', 'x'], ['2', 'y']])

  const transposed = applyTransforms(table(['h1', 'h2'], [['a', 'b']]), {
    dropEmpty: false,
    dedupe: false,
    transpose: true,
  })
  // matrix was [h1,h2] / [a,b] → transpose → [h1,a] / [h2,b] with first row as headers
  assert.deepEqual(transposed.headers, ['h1', 'a'])
  assert.deepEqual(transposed.rows, [['h2', 'b']])
}

// ─── empty input ────────────────────────────────────────────────────────────
{
  const result = parseSource('   ', 'auto', 'auto')
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.table.rows, [])
}

// ─── maxRows limit (large-file path) ────────────────────────────────────────
{
  const lines = ['a,b', ...Array.from({ length: 50 }, (_, i) => `${i},x`)]
  const result = parseSource(lines.join('\n'), 'comma', 'first-row', { maxRows: 10 })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.table.rows.length, 10)
    assert.deepEqual(result.table.headers, ['a', 'b'])
  }
}

// ─── full process (no row cap) ──────────────────────────────────────────────
{
  const lines = ['name,age', ...Array.from({ length: 120 }, (_, i) => `u${i},${i}`)]
  const full = await processFullSource(lines.join('\n'), {
    delimiter: 'comma',
    header: 'first-row',
    output: 'csv',
    transforms: { dropEmpty: false, dedupe: false, transpose: false },
  })
  assert.equal(full.rowCount, 120)
  assert.equal(full.colCount, 2)
  assert.match(full.output, /^name,age\n/)
  assert.match(full.output, /u119,119$/)
}

// ─── SQL / text filter ──────────────────────────────────────────────────────
{
  const headers = ['name', 'age', 'city']
  const rows = [
    { name: 'Alice', age: '30', city: 'Shanghai' },
    { name: 'Bob', age: '28', city: 'New York' },
    { name: 'Ada', age: '35', city: 'Shanghai' },
  ]
  const textIdx = filterRowsByText(rows, headers, 'shang')
  assert.deepEqual(textIdx, [0, 2])

  const sql = filterRowsBySql(rows, headers, "WHERE age > 28 AND city LIKE '%Shang%'")
  assert.equal(sql.ok, true)
  if (sql.ok) {
    assert.deepEqual(sql.rowIndexes, [0, 2])
    assert.equal(sql.columns, null)
  }

  const sql2 = filterRowsBySql(rows, headers, "age IN (28) OR name = 'Ada'")
  assert.equal(sql2.ok, true)
  if (sql2.ok) assert.deepEqual(sql2.rowIndexes, [1, 2])

  const projected = filterRowsBySql(
    rows,
    headers,
    'SELECT name, age FROM data WHERE city LIKE \'%Shang%\' ORDER BY age DESC',
  )
  assert.equal(projected.ok, true)
  if (projected.ok) {
    assert.deepEqual(projected.columns, ['name', 'age'])
    assert.deepEqual(projected.rowIndexes, [2, 0]) // Ada 35, Alice 30
  }

  const limited = filterRowsBySql(rows, headers, 'SELECT * FROM data ORDER BY age ASC LIMIT 1')
  assert.equal(limited.ok, true)
  if (limited.ok) assert.deepEqual(limited.rowIndexes, [1]) // Bob 28

  const bad = filterRowsBySql(rows, headers, 'WHERE nope = 1')
  assert.equal(bad.ok, false)

  const completions = getSqlCompletions('SELECT na', 9, headers)
  assert.ok(completions.items.some((item) => item.label === 'name'))
  assert.ok(completions.items.some((item) => item.kind === 'column'))
}

console.log('csv-core tests passed')
