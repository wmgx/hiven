#!/usr/bin/env node

import { readFileSync } from 'node:fs'

const source = readFileSync('src/kits/editor/TextEditorCore.tsx', 'utf8')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(
  /if\s*\(\s*isLocalChange\.current\s*\)\s*\{[\s\S]{0,220}model\??\.getValue\(\)\s*={2,3}\s*value[\s\S]{0,220}return/.test(source),
  'TextEditorCore should only swallow local-change syncs when the Monaco model already matches the incoming value',
)

assert(
  /if\s*\(\s*model\s*&&\s*model\.getValue\(\)\s*!==\s*value\s*\)/.test(source),
  'TextEditorCore should still apply external value updates when the Monaco model is stale',
)

console.log('pane external update sync checks passed')
