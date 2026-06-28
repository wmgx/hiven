#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const commands = [
  ['npm', ['run', 'test:hiven-brand-migration']],
  ['npm', ['run', 'test:refactor-final-acceptance']],
  ['npm', ['run', 'test:background-lifecycle']],
  ['npm', ['run', 'test:window-architecture-phases']],
  ['npm', ['run', 'test:no-main-window-startup']],
  ['npm', ['run', 'test:editor-window-launch']],
  ['npm', ['run', 'test:editor-command-bar-scope']],
  ['npm', ['run', 'test:global-launcher-open-editor']],
  ['npm', ['run', 'test:context-snapshot-editor']],
  ['npm', ['run', 'test:output-router-text-targets']],
  ['npm', ['run', 'test:plugin-surface-window']],
  ['npm', ['run', 'test:plugin-surface-shortcut-window']],
  ['npm', ['run', 'test:plugin-surface-shortcuts']],
  ['npm', ['run', 'test:workflow-object-model']],
  ['npm', ['run', 'test:launcher-web-smoke']],
]

for (const [command, args] of commands) {
  const label = [command, ...args].join(' ')
  console.log(`\n[refactor-suite] ${label}`)
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) {
    console.error(`[refactor-suite] failed to run ${label}:`, result.error)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`[refactor-suite] ${label} exited with ${result.status}`)
    process.exit(result.status ?? 1)
  }
}

console.log('\nrefactor suite checks passed')
