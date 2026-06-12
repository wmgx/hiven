#!/usr/bin/env node

import { readFileSync } from 'node:fs'

const source = readFileSync('src/workspace/effectRunner.ts', 'utf8')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const explicitTargetBlock = source.match(/} else \{\n\s+const \{ paneId, range \} = effect\.target[\s\S]*?\n\s+\}\n\s+\}\n\}/)?.[0] ?? ''

assert(
  /if\s*\(\s*editor\s*&&\s*range\s*\)/.test(explicitTargetBlock),
  'Effect runner should still use Monaco directly for explicit range replacements',
)

assert(
  !/} else if\s*\(\s*editor\s*\)[\s\S]*executeEdits\('effect-runner'/.test(explicitTargetBlock),
  'Full-pane replacements for an explicit paneId should update store only and let PaneEditor sync Monaco',
)

assert(
  /} else if\s*\(\s*editor\s*\)\s*\{\s*state\.setPaneText\(paneId,\s*effect\.text\)/.test(explicitTargetBlock),
  'Explicit full-pane replacements with a mounted editor should still update the target pane text',
)

console.log('pane full replace store sync checks passed')
