#!/usr/bin/env node
/** Editor attach-surface actions live on hostEditorActions. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = (p) => readFileSync(p, 'utf8')
assert.equal(existsSync('src/launcher/hosts/EditorCommandBarHost.tsx'), false)

const hostEditorActions = read('src/workspace/launcher/hostEditorActions.ts')
const packageJson = JSON.parse(read('package.json'))
const suite = read('scripts/test-refactor-suite.mjs')

assert.ok(packageJson.scripts?.['test:editor-command-bar-attach-surfaces'])
assert.match(suite, /test:editor-command-bar-attach-surfaces/)
assert.match(hostEditorActions, /attachBuiltinPluginSurfacePanel|attach-json|json/i, 'editor actions can attach plugin panels')
assert.match(hostEditorActions, /surfaces:\s*\[['"]editor-command-bar['"]/, 'actions scoped to editor-command-bar')
console.log('editor command bar attach-surfaces checks passed')
