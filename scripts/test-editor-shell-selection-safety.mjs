import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

function read(path) {
  return readFileSync(path, 'utf8')
}

const css = read('src/index.css')
const editor = read('src/views/EditorView.tsx')

assert.match(
  css,
  /\.flux-spatial-shell\s*\{[\s\S]{0,240}-webkit-user-select:\s*none;[\s\S]{0,120}user-select:\s*none;/,
  'Main spatial shell should suppress browser-level text selection overlays',
)

assert.match(
  css,
  /\.flux-spatial-shell\s+:is\([\s\S]{0,220}input,[\s\S]{0,220}textarea,[\s\S]{0,220}\[contenteditable=['"]true['"]\][\s\S]{0,260}-webkit-user-select:\s*text;[\s\S]{0,120}user-select:\s*text;/,
  'Editable controls should remain text-selectable inside the spatial shell',
)

assert.match(
  css,
  /\.flux-spatial-shell\s+\.monaco-editor[\s\S]{0,220}-webkit-user-select:\s*text;[\s\S]{0,120}user-select:\s*text;/,
  'Monaco should keep editor-level text selection behavior inside the spatial shell',
)

assert.match(
  editor,
  /editor\.getAction\(['"]editor\.action\.selectAll['"]\)\?\.run\(\)/,
  'Editor view should route shell-level Select All to Monaco instead of the browser document',
)

assert.match(
  editor,
  /target\.closest\([\s\S]{0,180}\.monaco-editor[\s\S]{0,180}input,[\s\S]{0,180}textarea,[\s\S]{0,180}\[contenteditable/,
  'Editor view should let Monaco and real editable controls handle their own Select All behavior',
)

console.log('editor shell selection safety checks passed')
