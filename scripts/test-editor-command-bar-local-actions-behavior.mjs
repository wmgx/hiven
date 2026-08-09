#!/usr/bin/env node
/** Local editor actions static contract. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = (p) => readFileSync(p, 'utf8')
assert.equal(existsSync('src/launcher/hosts/EditorCommandBarHost.tsx'), false)
const hostEditorActions = read('src/workspace/launcher/hostEditorActions.ts')
assert.match(hostEditorActions, /getHostEditorActionItems/, 'exports editor action list')
assert.match(hostEditorActions, /replaceEditorTextTarget|replaceActive|editor/i, 'actions target editor text')
if (existsSync('src/workflow/editorTextTransforms.ts')) {
  assert.match(read('src/workflow/editorTextTransforms.ts'), /export\s+function/, 'transform helpers exist')
}
console.log('editor command bar local actions (static) checks passed')
