#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const commands = [
  ['npm', ['run', 'test:refactor-suite']],
  ['npx', ['tsc', '--noEmit', '--pretty', 'false']],
  ['npm', ['run', 'check:architecture']],
  ['git', ['diff', '--check']],
  ['cargo', ['check', '--manifest-path', 'src-tauri/Cargo.toml']],
  ['npm', ['run', 'build']],
]

function resolveCommand(command, args) {
  if ((command === 'npm' || command === 'npx') && process.env.npm_execpath) {
    if (command === 'npx') return [process.execPath, [process.env.npm_execpath, 'exec', '--', ...args]]
    return [process.execPath, [process.env.npm_execpath, ...args]]
  }
  return [command, args]
}

for (const [command, args] of commands) {
  const label = [command, ...args].join(' ')
  console.log(`\n[refactor-gate] ${label}`)
  const [resolvedCommand, resolvedArgs] = resolveCommand(command, args)
  const result = spawnSync(resolvedCommand, resolvedArgs, { stdio: 'inherit' })
  if (result.error) {
    console.error(`[refactor-gate] failed to run ${label}:`, result.error)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`[refactor-gate] ${label} exited with ${result.status}`)
    process.exit(result.status ?? 1)
  }
}

console.log('\nrefactor gate checks passed')
