#!/usr/bin/env node
/** currentContextObjectProvider static contract. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync('src/workflow/defaultWorkflowProviders.ts', 'utf8')
const broker = readFileSync('src/launcher/context/contextBroker.ts', 'utf8')
assert.match(src, /currentContextObjectProvider/, 'provider exists')
assert.match(src, /context:selected-text|editor-selection|Selected Text/, 'selected text object')
assert.match(src, /getActiveEditorContextSnapshot/, 'uses editor snapshot')
assert.match(src, /TextCursorInput|TextSelect/, 'icon for selected text')
// external selection disabled at broker / workflow layer
assert.match(
  broker + src,
  /externalSelection|intentionally removed|DISABLED|external-selected/i,
  'external selection disabled path documented',
)
console.log('current context work objects (static) checks passed')
