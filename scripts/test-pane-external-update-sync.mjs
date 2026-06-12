#!/usr/bin/env node

import { readFileSync } from 'node:fs'

const source = readFileSync('src/components/workspace/PaneEditor.tsx', 'utf8')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(
  /if\s*\(\s*isLocalChange\.current\s*\)\s*\{[\s\S]{0,220}model\??\.getValue\(\)\s*={2,3}\s*paneText[\s\S]{0,220}return/.test(source),
  'PaneEditor should only swallow local-change syncs when the Monaco model already matches pane text',
)

assert(
  /if\s*\(\s*model\s*&&\s*model\.getValue\(\)\s*!==\s*paneText\s*\)/.test(source),
  'PaneEditor should still apply external pane text updates when the Monaco model is stale',
)

console.log('pane external update sync checks passed')
