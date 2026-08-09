#!/usr/bin/env node

import assert from 'node:assert/strict'
import {
  buildDiffTree,
  buildSideLines,
  computeJsonDiff,
  computeJsonLineHighlights,
  formatJsonPreserveKeyOrder,
  parseJson,
} from '../src/kits/diff/jsonSemanticDiff.ts'

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
