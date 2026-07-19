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

assert.match(
  source,
  /function isEditorWindowRuntime\(\)[\s\S]*window\.location\.search[\s\S]*['"]editor['"]/,
  'monaco bridge must detect the editor window runtime explicitly',
)
assert.match(
  source,
  /function getEditorRuntime\(paneId: PaneId\)[\s\S]*isEditorWindowRuntime\(\) \? runtimeRegistry\.getCodeEditor\(paneId\) : null/,
  'monaco bridge must not expose runtimeRegistry editors outside the editor window',
)
assert.match(
  source,
  /getMonaco\(\)[\s\S]*isEditorWindowRuntime\(\) \? \(\(window as any\)\.monaco \?\? null\) : null/,
  'monaco bridge must not expose window.monaco outside the editor window',
)
assert.doesNotMatch(
  source,
  /getCodeEditor\(paneId: PaneId\) \{\s*return runtimeRegistry\.getCodeEditor\(paneId\)/,
  'monaco bridge getCodeEditor must go through the editor-window guard',
)
for (const method of ['decorate', 'addViewZone', 'addContentWidget', 'addOverlayWidget', 'addGlyphMarginWidget', 'updateEditorOptions']) {
  assert.match(
    source,
    new RegExp(`${method}\\(paneId[\\s\\S]*const editor = getEditorRuntime\\(paneId\\)[\\s\\S]*if \\(!editor\\) return \\{ dispose\\(\\) \\{\\} \\}`),
    `${method} must no-op through getEditorRuntime outside the editor window`,
  )
}
assert.match(
  source,
  /applyMonacoUpdateOptions\(paneId:[\s\S]*const editor = getEditorRuntime\(paneId\)/,
  'Monaco effect helpers must also use the editor-window guarded runtime lookup',
)

console.log('monaco bridge window boundary checks passed')
