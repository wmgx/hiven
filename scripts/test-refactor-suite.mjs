#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const commands = [
  ['npm', ['run', 'test:hiven-brand-migration']],
  ['npm', ['run', 'test:app-hotkeys-runtime']],
  ['npm', ['run', 'test:tauri-debug-smoke']],
  ['npm', ['run', 'test:tauri-debug-runtime-state']],
  ['npm', ['run', 'test:window-architecture-phases']],
  ['npm', ['run', 'test:no-main-window-startup']],
  ['npm', ['run', 'test:plugin-surface-window']],
  ['npm', ['run', 'test:plugin-surface-shortcut-window']],
  ['npm', ['run', 'test:workflow-registry-behavior']],
  ['npm', ['run', 'test:global-launcher-workflow-tab-behavior']],
  ['npm', ['run', 'test:surface-registry-behavior']],
  ['npm', ['run', 'test:global-launcher-window-height']],
  ['npm', ['run', 'test:launcher-identity']],
  ['npm', ['run', 'test:launcher-plugin-contract']],
  ['npm', ['run', 'test:launcher-ranking']],
  ['npm', ['run', 'test:launcher-registry']],
  ['npm', ['run', 'test:launcher-usage']],
  ['npm', ['run', 'test:plugin-paste-behavior']],
  ['npm', ['run', 'test:paste-recovery-controller']],
  ['npm', ['run', 'test:native-clipboard-read']],
  ['npm', ['run', 'test:launcher-web-smoke']],
]

function resolveCommand(command, args) {
  if (command === 'npm' && process.env.npm_execpath) {
    return [process.execPath, [process.env.npm_execpath, ...args]]
  }
  return [command, args]
}

for (const [command, args] of commands) {
  const label = [command, ...args].join(' ')
  console.log(`\n[refactor-suite] ${label}`)
  const [resolvedCommand, resolvedArgs] = resolveCommand(command, args)
  const result = spawnSync(resolvedCommand, resolvedArgs, { stdio: 'inherit' })
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
