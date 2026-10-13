#!/usr/bin/env npx tsx
import assert from 'node:assert/strict'
import { joinClipboardTexts } from '../src/plugins/clipboard-history/merge/clipboardTextMerge.ts'
import {
  applyTransforms,
  applyTableQuery,
  detectInputKind,
  parseSource,
  parseDelimited,
  parseDelimitedAsync,
  processFullSource,
  toOutput,
  type OutputMode,
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

// Explicit quoted empty records carry data; unquoted blank lines keep their old semantics.
{
  for (const ending of ['', '\r\n']) {
    const source = 'text\r\n""\r\n"x"\r\n""' + ending
    const expected = [['text'], [''], ['x'], ['']]
    assert.deepEqual(parseDelimited(source, ','), expected)
    assert.deepEqual(await parseDelimitedAsync(source, ','), expected)
    assert.deepEqual(parseDelimited(source, ',', { maxRows: 2 }), expected.slice(0, 2))
    assert.deepEqual(parseDelimited(source, ',', { maxRows: 4 }), expected)
  }
  for (const source of ['""', '""\n', '""\n\n']) {
    assert.deepEqual(parseDelimited(source, ','), [['']])
    assert.deepEqual(await parseDelimitedAsync(source, ','), [['']])
  }
  for (const [source, expected] of [
    ['', []], ['\n', []], ['text\n\nx\n\n', [['text'], ['x']]],
    ['text\n \n', [['text'], [' ']]],
  ] as [string, string[][]][]) {
    assert.deepEqual(parseDelimited(source, ','), expected)
    assert.deepEqual(await parseDelimitedAsync(source, ','), expected)
  }
}

// History's structured merge preserves each complete item through the real CSV pipeline.
{
  const texts = ['跨行\n中文', 'comma, and "quotes"', '  首尾空白  ', '', '001', '=literal', '']
  const source = joinClipboardTexts(texts, 'csv')
  const expected = texts.map(text => ({ text }))
  const parsed = parseSource(source, 'auto', 'auto')
  assert.equal(parsed.ok, true)
  if (parsed.ok) {
    assert.deepEqual(parsed.table, table(['text'], texts.map(text => [text])))
    assert.deepEqual(JSON.parse(toOutput(parsed.table, 'objects')), expected)
  }
  const full = await processFullSource(source, {
    delimiter: 'auto', header: 'auto', output: 'objects',
    transforms: { dropEmpty: false, dedupe: false, transpose: false },
  })
  assert.equal(full.rowCount, texts.length)
  assert.deepEqual(JSON.parse(full.output), expected)
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

// ─── one query pipeline for preview and full source ─────────────────────────
{
  const source = table(['id', 'name', 'rank'], [
    ['1', 'item10', '10'],
    ['2', 'item2', '2'],
    ['3', 'Alpha', '1'],
    ['4', 'alpha', '1'],
  ])
  const before = JSON.stringify(source)
  const numeric = applyTableQuery(source, {
    sortColumns: [{ columnKey: 'rank', direction: 'ASC' }],
  })
  assert.equal(numeric.ok, true)
  if (numeric.ok) assert.deepEqual(numeric.rowIndexes, [2, 3, 1, 0])
  const text = applyTableQuery(source, {
    filterMode: 'text', globalFilter: 'ITEM', sqlFilter: 'WHERE missing = 1',
    sortColumns: [{ columnKey: 'name', direction: 'ASC' }],
  })
  assert.equal(text.ok, true)
  if (text.ok) assert.deepEqual(text.rowIndexes, [1, 0])
  const projected = applyTableQuery(source, {
    filterMode: 'sql', globalFilter: 'ignored',
    sqlFilter: 'SELECT name FROM data ORDER BY rank DESC LIMIT 2',
    sortColumns: [{ columnKey: 'rank', direction: 'ASC' }],
  })
  assert.equal(projected.ok, true)
  if (projected.ok) {
    assert.deepEqual(projected.table, table(['name'], [['item2'], ['item10']]))
    assert.deepEqual(projected.rowIndexes, [1, 0])
  }
  assert.equal(JSON.stringify(source), before, 'query must not mutate source rows or headers')
}

// ─── full query must see matches and ordering beyond both preview caps ───────
{
  const source = ['id,name,rank', ...Array.from({ length: 8_505 }, (_, i) =>
    `${i},${i === 8_503 ? 'needle' : `item${i}`},${i}`)].join('\n')
  const options = {
    delimiter: 'comma', header: 'first-row', output: 'objects',
    transforms: { dropEmpty: false, dedupe: false, transpose: false },
  } as const
  const text = await processFullSource(source, {
    ...options,
    query: { filterMode: 'text', globalFilter: 'needle' },
  })
  assert.equal(text.rowCount, 1)
  assert.deepEqual(JSON.parse(text.output), [{ id: '8503', name: 'needle', rank: '8503' }])

  const sql = await processFullSource(source, {
    ...options,
    query: {
      filterMode: 'sql',
      sqlFilter: 'SELECT name, id FROM data WHERE rank >= 8500 ORDER BY rank DESC LIMIT 3',
      sortColumns: [{ columnKey: 'rank', direction: 'ASC' }],
    },
  })
  assert.equal(sql.rowCount, 3)
  assert.equal(sql.colCount, 2)
  assert.deepEqual(sql.sourceHeaders, ['id', 'name', 'rank'])
  assert.deepEqual(sql.table, table(['name', 'id'], [
    ['item8502', '8502'], ['needle', '8503'], ['item8504', '8504'],
  ]))
  assert.deepEqual(JSON.parse(sql.output), [
    { name: 'item8502', id: '8502' }, { name: 'needle', id: '8503' }, { name: 'item8504', id: '8504' },
  ])

  const sorted = await processFullSource(source, {
    ...options, output: 'csv',
    query: { sortColumns: [{ columnKey: 'rank', direction: 'DESC' }] },
  })
  assert.equal(sorted.rowCount, 8_505)
  assert.equal(sorted.table.rows[0][0], '8504')
  assert.equal(sorted.table.rows.at(-1)?.[0], '0')
  assert.equal(sorted.output.split('\n').length, 8_506)
  assert.match(sorted.output, /^id,name,rank\n8504,item8504,8504\n/)
}

// ─── transforms precede queries; every output serializes the same result ─────
{
  const source = 'key,value\na,x\n,\na,x\nb,y'
  const transforms = { dropEmpty: true, dedupe: true, transpose: true }
  const query = { filterMode: 'sql', sqlFilter: "SELECT b FROM data WHERE a = 'x'" } as const
  const parsed = parseSource(source, 'comma', 'first-row')
  assert.equal(parsed.ok, true)
  if (parsed.ok) {
    const result = applyTableQuery(applyTransforms(parsed.table, transforms), query)
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.deepEqual(result.table, table(['b'], [['y']]))
      for (const output of ['objects', 'array', 'columns', 'keyed', 'ndjson', 'csv', 'tsv', 'markdown', 'sql'] as OutputMode[]) {
        const full = await processFullSource(source, {
          delimiter: 'comma', header: 'first-row', output, transforms, query,
        })
        assert.deepEqual(full.table, result.table)
        assert.deepEqual(full.sourceHeaders, ['key', 'a', 'b'])
        assert.equal(full.output, toOutput(result.table, output), `${output} must use the queried table`)
      }
    }
  }
}

// ─── zero-row and empty tables are valid, including LIMIT 0 and SQL output ───
{
  for (const source of ['name,age\nAda,30', 'name,age', '', '[]']) {
    for (const output of ['objects', 'array', 'columns', 'keyed', 'ndjson', 'csv', 'tsv', 'markdown', 'sql'] as OutputMode[]) {
      const full = await processFullSource(source, {
        delimiter: 'comma', header: 'first-row', output,
        transforms: { dropEmpty: false, dedupe: false, transpose: false },
        query: { filterMode: 'sql', sqlFilter: 'SELECT * FROM data LIMIT 0' },
      })
      assert.equal(full.rowCount, 0)
      assert.equal(full.output, toOutput(full.table, output), `${output} zero-row output must match the synchronous path`)
    }
  }
  const result = applyTableQuery(table(['name'], [['Ada']]), {
    filterMode: 'sql', sqlFilter: "SELECT name FROM data WHERE name = 'missing'",
  })
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.table, table(['name'], []))
}

// ─── invalid queries must fail even with no data; never serialize a fallback ─
{
  for (const sqlFilter of [
    'WHERE missing = 1', 'SELECT missing FROM data', 'SELECT name FROM data ORDER BY missing',
    'WHERE name =', "WHERE name = 'Ada", 'WHERE `name = 1', 'SELECT name, FROM data',
  ]) {
    assert.equal(applyTableQuery(table(['name'], []), { filterMode: 'sql', sqlFilter }).ok, false)
    await assert.rejects(processFullSource('name', {
      delimiter: 'comma', header: 'first-row', output: 'csv',
      transforms: { dropEmpty: false, dedupe: false, transpose: false },
      query: { filterMode: 'sql', sqlFilter },
    }), /Unknown column|Expected|Unterminated|Empty column/)
  }
}

// ─── cancelled jobs cannot publish empty or completed results ───────────────
{
  const options = {
    delimiter: 'comma', header: 'first-row', output: 'csv',
    transforms: { dropEmpty: false, dedupe: false, transpose: false },
  } as const
  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(processFullSource('', options, { signal: cancelled.signal }), { name: 'AbortError' })

  const duringQuery = new AbortController()
  const compare = String.prototype.localeCompare
  try {
    String.prototype.localeCompare = function (...args: Parameters<typeof compare>) {
      duringQuery.abort()
      return compare.apply(this, args)
    }
    await assert.rejects(processFullSource('name,rank\nAda,30\nBob,2', {
      ...options, query: { sortColumns: [{ columnKey: 'rank', direction: 'ASC' }] },
    }, { signal: duringQuery.signal }), { name: 'AbortError' })
  } finally {
    String.prototype.localeCompare = compare
  }

  const afterOutput = new AbortController()
  await assert.rejects(processFullSource('name', { ...options, output: 'sql' }, {
    signal: afterOutput.signal,
    onProgress: ({ phase, ratio }) => { if (phase === 'output' && ratio === 1) afterOutput.abort() },
  }), { name: 'AbortError' })
}

// Markdown serializes complete source data, including exact JSON keys and CSV cells.
{
  const source = JSON.stringify([
    { ' spaced ': 'a|b', '': 'empty key', nested: { text: '<tag>\\path' }, nothing: null },
    { later: ['x', 'y'], ' spaced ': 'first\nsecond' },
    JSON.parse('{"__proto__":"literal"}'),
  ])
  const parsed = parseSource(source)
  assert.equal(parsed.ok, true)
  if (parsed.ok) {
    assert.deepEqual(parsed.table.headers, [' spaced ', '', 'nested', 'nothing', 'later', '__proto__'])
    assert.equal(parsed.table.rows[0][0], 'a|b')
    assert.equal(parsed.table.rows[0][1], 'empty key')
    assert.equal(parsed.table.rows[0][5], '', 'missing prototype-named keys remain blank')
    assert.equal(parsed.table.rows[2][5], 'literal')
    assert.equal(parsed.table.rows[1][4], '["x","y"]')
    const full = await processFullSource(source, {
      delimiter: 'auto', header: 'auto', output: 'markdown',
      transforms: { dropEmpty: false, dedupe: false, transpose: false },
    })
    assert.equal(full.output, toOutput(parsed.table, 'markdown'))
    assert.ok(full.output.includes('a&#124;b'))
    assert.ok(full.output.includes('first<br>second'))
    assert.ok(full.output.includes('&lt;tag&gt;'))
    assert.equal(full.output.split('\n').length, 5)
  }
  for (const invalid of ['[1,2]', '[null]', '[["a"]]', '{"a":1}']) {
    assert.equal(parseSource(invalid).ok, false, invalid)
  }
  // Explicit fixture uses RFC4180 doubled quotes and a quoted embedded newline.
  const actual = 'name,note\nA,"line1\nline2 | ""quoted"""\n'
  const parsedCsv = parseSource(actual, 'comma', 'first-row')
  assert.equal(parsedCsv.ok, true)
  if (parsedCsv.ok) {
    assert.equal(toOutput(parsedCsv.table, 'markdown'), '| name | note |\n| --- | --- |\n| A | line1<br>line2 &#124; "quoted" |')
  }
  const big = 'id,note\n' + Array.from({ length: 1601 }, (_, i) => `${i},row-${i}`).join('\n')
  const full = await processFullSource(big, {
    delimiter: 'comma', header: 'first-row', output: 'markdown',
    transforms: { dropEmpty: false, dedupe: false, transpose: false },
  })
  assert.equal(full.rowCount, 1601)
  assert.ok(full.output.endsWith('| 1600 | row-1600 |'))
  const wider = 'a\n1,tail'
  const parsedWider = parseSource(wider, 'comma', 'first-row')
  assert.equal(parsedWider.ok, true)
  if (parsedWider.ok) assert.deepEqual(parsedWider.table, table(['a', 'column_2'], [['1', 'tail']]))
  const widerFull = await processFullSource(wider, {
    delimiter: 'comma', header: 'first-row', output: 'markdown',
    transforms: { dropEmpty: false, dedupe: false, transpose: false },
  })
  assert.ok(widerFull.output.endsWith('| 1 | tail |'))
}
console.log('csv-core tests passed')
