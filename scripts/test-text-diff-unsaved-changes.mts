import assert from 'node:assert/strict'
import { hasTextDiffUnsavedChanges } from '../src/plugins/textDiff/unsavedChanges.ts'

const baseline = {
  original: 'left full text\n🙂',
  modified: 'right full text\n第二行',
}

assert.equal(hasTextDiffUnsavedChanges(baseline, baseline.original, baseline.modified), false)
assert.equal(hasTextDiffUnsavedChanges(baseline, `${baseline.original}!`, baseline.modified), true)
assert.equal(hasTextDiffUnsavedChanges(baseline, baseline.original, `${baseline.modified}!`), true)
assert.equal(hasTextDiffUnsavedChanges(baseline, baseline.modified, baseline.original), true)
assert.equal(hasTextDiffUnsavedChanges(baseline, baseline.original, baseline.modified), false,
  'exact restoration of both full bodies returns to clean')

console.log('Text Diff unsaved-change baseline checks passed')
