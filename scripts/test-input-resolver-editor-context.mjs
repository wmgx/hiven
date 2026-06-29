#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/workspace/inputResolver.ts', 'utf8')

assert.match(
  source,
  /if \(!isEditorWindowRuntime\(\) && canReadEditorContextSnapshot\(\)\)[\s\S]*getActiveEditorContextSnapshot\(\)[\s\S]*resolveEditorContextInput/,
  'generic input resolver must use synced editor context outside the editor runtime',
)

assert.match(
  source,
  /policy\?\.prefer === ['"]workspace['"][\s\S]*paneId:\s*editorContext\.activePaneId[\s\S]*panes:\s*editorContext\.paneIds[\s\S]*text:\s*editorContext\.activeText/,
  'generic input resolver must resolve workspace input from synced editor pane ids outside the editor runtime',
)

assert.match(
  source,
  /editorContext\.selectedText && policy\?\.prefer !== ['"]whole-pane['"][\s\S]*mode:\s*['"]selection['"][\s\S]*range:\s*editorContext\.selectionRange/,
  'generic input resolver must preserve selected-text input from synced editor context',
)

assert.match(
  source,
  /mode:\s*['"]whole-pane['"][\s\S]*text:\s*editorContext\.activeText[\s\S]*paneId:\s*editorContext\.activePaneId/,
  'generic input resolver must resolve whole-pane input from synced editor context',
)

console.log('input resolver editor context checks passed')
