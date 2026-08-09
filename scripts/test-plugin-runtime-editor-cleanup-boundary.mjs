#!/usr/bin/env node
/**
 * Plugin runtime cleanup boundary after main editor window retirement.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const pluginRuntime = readFileSync('src/workspace/pluginRuntime.ts', 'utf8')
const editorBridge = readFileSync('src/workspace/editorBridge.ts', 'utf8')
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')

assert.equal(
  packageJson.scripts?.['test:plugin-runtime-editor-cleanup-boundary'],
  'node scripts/test-plugin-runtime-editor-cleanup-boundary.mjs',
)
assert.match(refactorSuite, /test:plugin-runtime-editor-cleanup-boundary/)

assert.equal(existsSync('src/components/EditorWindow.tsx'), false, 'EditorWindow must stay deleted')
assert.doesNotMatch(pluginRuntime, /isEditorWindowRuntime/, 'plugin runtime must not use retired isEditorWindowRuntime')
assert.doesNotMatch(editorBridge, /isEditorWindowRuntime/, 'editor bridge must not reintroduce isEditorWindowRuntime')
assert.match(editorBridge, /getActiveEditorContextSnapshot|showEditorWindow|showQuickEditor/, 'editor bridge still provides editor context / open paths')

console.log('plugin runtime editor cleanup boundary checks passed')
