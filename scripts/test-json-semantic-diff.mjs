#!/usr/bin/env node

import assert from 'node:assert/strict'
import {
  buildDiffTree,
  buildSideLines,
  computeJsonDiff,
} from '../src/kits/diff/jsonSemanticDiff.ts'

function changesOf(left, right) {
  return computeJsonDiff(left, right)
}

function paths(changes) {
  return changes.map(change => change.path).sort()
}

function kinds(changes) {
  return changes.map(change => change.kind).sort()
}

{
  const changes = changesOf({ a: 1, b: 2 }, { b: 2, a: 1 })
  assert.deepEqual(changes, [], 'object key order should not be semantic diff')
}

{
  const changes = changesOf(['read', 'write', 'admin'], ['admin', 'read', 'write'])
  assert.deepEqual(changes, [], 'scalar array reorder should not be semantic diff')
}

{
  const changes = changesOf(['a', 'a', 'b'], ['a', 'b', 'b'])
  assert.equal(changes.length, 2, 'scalar duplicate count changes should be reported')
  assert.deepEqual(kinds(changes), ['added', 'removed'])
}

{
  const left = {
    plans: [
      { code: 'basic', level: 1, title: 'Basic' },
      { code: 'pro', level: 2, title: 'Pro' },
      { code: 'max', level: 3, title: 'Max' },
    ],
  }
  const right = {
    plans: [
      { code: 'new', level: 1, title: 'New' },
      { code: 'max', level: 3, title: 'Max' },
      { code: 'basic', level: 1, title: 'Basic' },
      { code: 'pro', level: 2, title: 'Pro' },
    ],
  }
  const changes = changesOf(left, right)
  assert.equal(changes.length, 1, 'object array insert/reorder should only report inserted object')
  assert.equal(changes[0].kind, 'added')
  assert.equal(changes[0].path, '$.plans{code="new"}')
}

{
  const left = {
    plans: [
      { code: 'basic', level: 1, title: 'Basic' },
      { code: 'pro', level: 2, title: 'Pro' },
    ],
  }
  const right = {
    plans: [
      { code: 'pro', level: 2, title: 'Pro Plus' },
      { code: 'basic', level: 1, title: 'Basic' },
    ],
  }
  const changes = changesOf(left, right)
  assert.deepEqual(paths(changes), ['$.plans{code="pro"}.title'])
  assert.equal(changes[0].kind, 'changed')
}

{
  const left = {
    groups: [
      {
        code: 'vip',
        features: [
          { key: 'image', enabled: true },
          { key: 'video', enabled: false },
        ],
      },
    ],
  }
  const right = {
    groups: [
      {
        code: 'vip',
        features: [
          { enabled: false, key: 'video' },
          { enabled: true, key: 'image' },
        ],
      },
    ],
  }
  assert.deepEqual(changesOf(left, right), [], 'nested object array reorder should not be semantic diff')
}

{
  const left = [{ code: 'a', title: 'A1' }, { code: 'a', title: 'A2' }]
  const right = [{ code: 'a', title: 'A2' }, { code: 'a', title: 'A1' }]
  assert.deepEqual(changesOf(left, right), [], 'duplicate identity candidate must not cause false object-array diff')
}

{
  const left = [{ title: 'Basic', level: 1, enabled: true }]
  const right = [{ title: 'Basic Plan', level: 1, enabled: true }]
  const changes = changesOf(left, right)
  assert.equal(changes.length, 1, 'similar object without explicit id should be matched as changed')
  assert.equal(changes[0].kind, 'changed')
  assert.match(changes[0].path, /title$/)
}

{
  const left = ['basic', { code: 'pro', flags: ['a', 'b'] }, 1, null]
  const right = [null, 1, { flags: ['b', 'a'], code: 'pro' }, 'basic']
  assert.deepEqual(changesOf(left, right), [], 'mixed array reorder and nested array reorder should be ignored')
}

{
  const changes = changesOf({ x: null }, {})
  assert.equal(changes.length, 1)
  assert.equal(changes[0].kind, 'removed')
  assert.equal(changes[0].path, '$.x')
}

{
  assert.deepEqual(changesOf(1, 1.0), [], 'JSON numeric equivalents should be equal')
  const changes = changesOf(1, '1')
  assert.equal(changes.length, 1)
  assert.equal(changes[0].kind, 'changed')
}

{
  const left = { plans: [{ code: 'basic', title: 'Basic' }, { code: 'pro', title: 'Pro' }] }
  const right = { plans: [{ code: 'new', title: 'New' }, { code: 'pro', title: 'Pro' }, { code: 'basic', title: 'Basic' }] }
  const tree = buildDiffTree(left, right)
  const leftText = buildSideLines(tree, 'left').map(line => line.text).join('\n')
  const rightLines = buildSideLines(tree, 'right')
  const highlighted = rightLines.filter(line => line.highlight).map(line => line.text).join('\n')
  assert.match(leftText, /"code": "basic"/, 'unchanged left object should remain visible')
  assert.match(leftText, /"code": "pro"/, 'unchanged left object should remain visible')
  assert.match(highlighted, /"code": "new"/, 'only inserted object should be highlighted')
  assert.doesNotMatch(highlighted, /"code": "basic"/, 'unchanged object should not be highlighted')
  assert.doesNotMatch(highlighted, /"code": "pro"/, 'unchanged object should not be highlighted')
}

console.log('json semantic diff checks passed')
