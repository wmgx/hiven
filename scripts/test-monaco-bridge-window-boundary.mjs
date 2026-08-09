#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')
const source = readFileSync('src/workspace/monacoBridge.ts', 'utf8')

assert.equal(
  packageJson.scripts?.['test:monaco-bridge-window-boundary'],
  'node scripts/test-monaco-bridge-window-boundary.mjs',
  'package.json must expose monaco bridge window boundary coverage',
)
assert.match(
  refactorSuite,
  /test:monaco-bridge-window-boundary/,
  'refactor suite must include monaco bridge window boundary coverage',
)

// Retired isEditorWindowRuntime: monaco bridge is a hard no-op outside Quick Editor
// (runtimeRegistry editors are not exposed from launcher / plugin surfaces).
assert.doesNotMatch(
  source,
  /isEditorWindowRuntime/,
  'monaco bridge must not reintroduce retired isEditorWindowRuntime',
)
assert.match(
  source,
  /function getEditorRuntime\(_paneId: PaneId\): any \| null \{\s*return null\s*\}/,
  'getEditorRuntime must hard-return null (no shadow monaco outside editor host)',
)
assert.match(
  source,
  /getMonaco\(\) \{\s*return null\s*\}/,
  'getMonaco must hard-return null',
)
assert.doesNotMatch(
  source,
  /getCodeEditor\(paneId: PaneId\) \{\s*return runtimeRegistry\.getCodeEditor\(paneId\)/,
  'monaco bridge getCodeEditor must not bypass getEditorRuntime',
)
for (const method of ['decorate', 'addViewZone', 'addContentWidget', 'addOverlayWidget', 'addGlyphMarginWidget', 'updateEditorOptions']) {
  assert.match(
    source,
    new RegExp(`${method}\\(paneId[\\s\\S]*const editor = getEditorRuntime\\(paneId\\)[\\s\\S]*if \\(!editor\\) return \\{ dispose\\(\\) \\{\\} \\}`),
    `${method} must no-op through getEditorRuntime`,
  )
}

console.log('monaco bridge window boundary checks passed')
