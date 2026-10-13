#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createJiti } from 'jiti'

const {
  buildDiffTree,
  buildSideLines,
  computeJsonDiff,
  computeJsonLineHighlights,
  formatJsonPreserveKeyOrder,
  parseJson,
} = await createJiti(import.meta.url).import('../src/kits/diff/jsonSemanticDiff.ts')

function changesOf(left, right) {
  return computeJsonDiff(left, right)
}

function paths(changes) {
  return changes.map((change) => change.path).sort()
}

function kinds(changes) {
  return changes.map((change) => change.kind).sort()
}

{
  const changes = changesOf({ a: 1, b: 2 }, { b: 2, a: 1 })
  assert.deepEqual(changes, [], 'object key order should be ignored')
}

{
  const changes = changesOf(['read', 'write', 'admin'], ['admin', 'read', 'write'])
  assert.ok(changes.length > 0, 'array reorder must report index differences')
  assert.deepEqual(paths(changes), ['$[0]', '$[1]', '$[2]'])
}

{
  const changes = changesOf(['a', 'a', 'b'], ['a', 'b', 'b'])
  assert.equal(changes.length, 1)
  assert.deepEqual(paths(changes), ['$[1]'])
}

{
  const left = { plans: [{ code: 'basic' }, { code: 'pro' }] }
  const right = { plans: [{ code: 'pro' }, { code: 'basic' }] }
  const changes = changesOf(left, right)
  assert.ok(changes.length >= 2)
  assert.ok(paths(changes).every((p) => p.startsWith('$.plans[')))
}

{
  const left = [{ title: 'Basic', level: 1 }]
  const right = [{ title: 'Basic Plan', level: 1 }]
  const changes = changesOf(left, right)
  assert.equal(changes.length, 1)
  assert.equal(changes[0].path, '$[0].title')
}

{
  const changes = changesOf({ x: null }, {})
  assert.equal(changes.length, 1)
  assert.equal(changes[0].kind, 'removed')
  assert.equal(changes[0].path, '$.x')
}

{
  assert.deepEqual(changesOf(1, 1.0), [])
  assert.equal(changesOf(1, '1').length, 1)
}

{
  // Preserve user formatting: trailing commas + blank lines stay; only B highlights.
  const leftText = '{\n"A": "B"\n\n\n}'
  const rightText = '{\n"A": "B",\n"B": "B",\n}'
  assert.equal(parseJson(leftText).ok, true)
  assert.equal(parseJson(rightText).ok, true)

  const hl = computeJsonLineHighlights(leftText, rightText)
  assert.ok(hl, 'highlights must compute for edit-time JSON')
  assert.deepEqual(hl.leftHighlights, [], 'left A unchanged → no left highlights (blank lines ignored)')
  assert.deepEqual(hl.rightHighlights, [3], 'only added B line on right')
  assert.equal(hl.rightRanges.length, 1, 'one character-range block for added B')
  assert.equal(hl.rightRanges[0].startLineNumber, 3)
  assert.equal(hl.changes.length, 1)
  assert.equal(hl.changes[0].kind, 'added')
  assert.equal(hl.changes[0].path, '$.B')
}

{
  // Single-line object: only the added property is a block, not the whole line.
  const leftText = '{ "A": "B", "B": "B" }'
  const rightText = '{ "B": "B", "A": "B", "C": "" }'
  const hl = computeJsonLineHighlights(leftText, rightText)
  assert.ok(hl)
  assert.deepEqual(hl.leftHighlights, [], 'A/B unchanged → no left highlight')
  assert.equal(hl.rightRanges.length, 1, 'one block for C')
  const block = hl.rightRanges[0]
  assert.equal(block.startLineNumber, 1)
  assert.equal(block.endLineNumber, 1)
  // Block should cover C, not start at the first property on the line.
  assert.ok(block.startColumn > 1, 'block should not cover the whole line from column 1')
  const slice = rightText.slice(block.startColumn - 1, block.endColumn - 1)
  assert.match(slice, /"C"/, 'block text should include key C')
  assert.doesNotMatch(slice, /"A"/, 'block should not include unchanged A')
}

{
  // buildSideLines still works for callers that want tree display.
  const tree = buildDiffTree({ a: 1 }, { a: 1, b: 2 })
  const right = buildSideLines(tree, 'right')
  assert.ok(right.some((l) => l.highlight && l.text.includes('"b"')))
}

{
  // Format pretty-prints but never sorts object keys.
  const raw = '{"z":1,"a":2,"m":{"y":1,"x":2}}'
  const formatted = formatJsonPreserveKeyOrder(raw)
  assert.ok(formatted)
  assert.match(formatted, /"z": 1,\s*"a": 2/, 'top-level key order preserved')
  assert.match(formatted, /"y": 1,\s*"x": 2/, 'nested key order preserved')
  assert.ok(formatted.includes('\n'), 'pretty-printed with newlines')
  // trailing comma input still formats
  assert.equal(
    formatJsonPreserveKeyOrder('{"a":1,}'),
    '{\n  "a": 1\n}',
  )
}

{
  // Numeric fidelity is a precondition for semantic comparison and rewriting.
  // Even exactly representable integers outside the safe range are declined:
  // callers must not infer that every adjacent identifier remains distinguishable.
  const risky = [
    '9007199254740992', '9007199254740993', '-9007199254740992',
    '0.12345678901234567890', '0.12345678901234567891',
    '1.0000000000000001', '1e309', '-1e309', '1e-400', '-1e-400',
    '-0', '-0.0', '-0e999999999999999999999999',
  ]
  for (const token of risky) {
    for (const text of [token, `{"nested":[{"value":${token}}]}`, `\uFEFF{"value":${token},}`]) {
      const parsed = parseJson(text)
      assert.equal(parsed.ok, false, `must decline lossy numeric source: ${text}`)
      assert.equal(parsed.reason, 'number-fidelity', `must explain numeric fallback: ${text}`)
      assert.equal(formatJsonPreserveKeyOrder(text), null, `must not rewrite numeric source: ${text}`)
      assert.equal(computeJsonLineHighlights(text, '{"value":1}'), null, 'unsafe left requests text fallback')
      assert.equal(computeJsonLineHighlights('{"value":1}', text), null, 'unsafe right requests text fallback')
    }
  }

  const safe = [
    '0.1', '0.10', '1e3', '1000.00', '9007199254740991', '-9007199254740991',
    '0', '0.0', '0e999999999999999999999999', '0e-999999999999999999999999',
    '5e-324',
  ]
  for (const token of safe) {
    const text = `{"nested":[${token},],}`
    assert.equal(parseJson(text).ok, true, `ordinary/round-trippable number remains supported: ${token}`)
    assert.notEqual(formatJsonPreserveKeyOrder(text), null, `safe number can format: ${token}`)
  }

  // Numeric-looking string values and keys, escaped quotes and backslashes are
  // opaque; scanning must resume after them to inspect actual numeric values.
  const strings = {
    '9007199254740993': '0.12345678901234567891',
    quoted: '"id":9007199254740993',
    escaped: '\\" -0 1e309 1e-400',
    nested: ['9007199254740993', '-0'],
  }
  const text = JSON.stringify(strings)
  assert.equal(parseJson(text).ok, true, 'numbers inside strings are not numeric risks')
  assert.deepEqual(JSON.parse(formatJsonPreserveKeyOrder(text)), strings, 'format preserves quoted content')
  assert.equal(parseJson(text.replace(/}$/, ',"actual":9007199254740993}')).reason, 'number-fidelity')

  const equivalents = computeJsonLineHighlights(
    '{"a":0.10,"b":1e3,"nested":{"z":1.0,"a":0e999999999999999999999999}}',
    '{ "nested": {"a":0,"z":1e0}, "b":1000.00,"a":0.1 }',
  )
  assert.ok(equivalents, 'safe decimal/exponent forms retain semantic mode')
  assert.deepEqual(equivalents.changes, [], 'key order and equivalent numeric spellings remain noise-free')
}

{
  // Large JSON must stay interactive: path map used to be O(n²) via per-record
  // index→line scans and froze ~10k-line pastes for tens of seconds.
  const n = 3000
  const items = []
  for (let i = 0; i < n; i++) {
    items.push(`  {"id": ${i}, "name": "item-${i}", "active": ${i % 2 === 0}, "score": ${i * 1.5}}`)
  }
  const left = `[\n${items.join(',\n')}\n]`
  const right = left.replace('item-100', 'item-100-changed')
  assert.ok(left.split('\n').length > 3000, 'fixture should be multi-thousand lines')

  const t0 = performance.now()
  const hl = computeJsonLineHighlights(left, right)
  const ms = performance.now() - t0
  assert.ok(hl, 'large JSON highlights must compute')
  assert.equal(hl.changes.length, 1, 'only the renamed field differs')
  assert.ok(
    ms < 2500,
    `computeJsonLineHighlights on ~${n} items should finish quickly (got ${ms.toFixed(0)}ms)`,
  )
  console.log(`large json highlight ok in ${ms.toFixed(0)}ms (${left.split('\n').length} lines)`)
}

console.log('json semantic diff checks passed')
