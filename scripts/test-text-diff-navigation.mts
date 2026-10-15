import assert from 'node:assert/strict'
import { computeTextLineDiff } from '../src/kits/diff/lineDiff.ts'
import {
  buildHighlightNavigationTargets,
  clampDiffHunkIndex,
  moveDiffHunkIndex,
} from '../src/plugins/textDiff/diffNavigation.ts'

const expectedHunk = (
  leftLine: number,
  rightLine: number,
  leftLines: number[],
  rightLines: number[],
) => ({ leftLine, rightLine, leftLines, rightLines })

{
  const original = Array.from({ length: 150 }, (_, index) => `Line ${index + 1}`)
  const modified = [...original]
  for (const line of [5, 70, 130]) modified[line - 1] += ' changed'
  assert.deepEqual(computeTextLineDiff(original.join('\n'), modified.join('\n')).hunks, [
    expectedHunk(5, 5, [5], [5]),
    expectedHunk(70, 70, [70], [70]),
    expectedHunk(130, 130, [130], [130]),
  ])
}

{
  const insertion = computeTextLineDiff('A\nB\nC\nD', 'A\ninsert one\ninsert two\nB\nC\nD')
  assert.deepEqual(insertion.hunks, [
    expectedHunk(2, 2, [], [2, 3]),
  ], 'a pure insertion uses the next valid left anchor and the first inserted right line')

  const deletion = computeTextLineDiff('A\ndelete one\ndelete two\nB\nC\nD', 'A\nB\nC\nD')
  assert.deepEqual(deletion.hunks, [
    expectedHunk(2, 2, [2, 3], []),
  ], 'a pure deletion uses the first deleted left line and the next valid right anchor')
}

{
  const shifted = computeTextLineDiff(
    'A\nB\nC\nD\nE\nF',
    'A\ninserted\nB\nC\nD changed\nE\nF',
  )
  assert.deepEqual(shifted.hunks, [
    expectedHunk(2, 2, [], [2]),
    expectedHunk(4, 5, [4], [5]),
  ], 'later hunks keep independent left and right lines after an insertion')
}

{
  assert.deepEqual(computeTextLineDiff('', 'one\ntwo').hunks, [
    expectedHunk(1, 1, [1], [1, 2]),
  ], 'an empty editor still has a valid line-one reveal target')
  assert.deepEqual(computeTextLineDiff('A', 'A\nappended').hunks, [
    expectedHunk(1, 2, [], [2]),
  ], 'an append clamps the exhausted left cursor to its last valid line')
  assert.deepEqual(computeTextLineDiff('A\ndeleted', 'A').hunks, [
    expectedHunk(2, 1, [2], []),
  ], 'a trailing deletion clamps the exhausted right cursor to its last valid line')
  assert.deepEqual(computeTextLineDiff('A\nlast', 'A\nchanged').hunks, [
    expectedHunk(2, 2, [2], [2]),
  ], 'a final-line replacement targets the final valid line on both sides')
}

{
  const original = Array.from({ length: 4001 }, (_, index) => `Line ${index + 1}`)
  const modified = [...original]
  modified[1] = 'changed 2'
  modified[2] = 'changed 3'
  modified[4000] = 'changed 4001'
  assert.deepEqual(computeTextLineDiff(original.join('\n'), modified.join('\n')).hunks, [
    expectedHunk(2, 2, [2, 3], [2, 3]),
    expectedHunk(4001, 4001, [4001], [4001]),
  ], 'the coarse large-file path keeps bounded contiguous navigation hunks')
}

assert.equal(clampDiffHunkIndex(7, 0), 0)
assert.equal(clampDiffHunkIndex(7, 3), 2)
assert.equal(clampDiffHunkIndex(-2, 3), 0)
assert.equal(moveDiffHunkIndex(0, 0, 1), null)
assert.equal(moveDiffHunkIndex(2, 3, 1), 0, 'next wraps last to first')
assert.equal(moveDiffHunkIndex(0, 3, -1), 2, 'previous wraps first to last')
assert.equal(moveDiffHunkIndex(9, 2, 1), 0, 'movement first clamps an index made stale by recomputation')

assert.deepEqual(
  buildHighlightNavigationTargets([4, 8], [5, 9], 8, 9),
  [{ leftLine: 4, rightLine: 5 }, { leftLine: 8, rightLine: 9 }],
  'non-text modes preserve existing contiguous grouping while mapping each side independently',
)
assert.deepEqual(
  buildHighlightNavigationTargets([], [1, 2, 9], 1, 9),
  [{ leftLine: 1, rightLine: 1 }, { leftLine: 1, rightLine: 9 }],
  'one-sided highlighted groups always receive valid anchors on the empty side',
)

console.log('text diff navigation logic passed')
