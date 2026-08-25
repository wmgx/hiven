#!/usr/bin/env node

/**
 * B1 quality gate — mandatory checks for PR / main.
 *
 * Full `tsc --noEmit` and full refactor-suite still carry historical debt;
 * this gate enforces the freeze-batch must-not-regress set:
 * architecture, reachability, permission least-privilege, and key boundary contracts.
 *
 * Tag release must not be weaker than this gate.
 */

import { spawnSync } from 'node:child_process'

const commands = [
  ['npm', ['run', 'check:typecheck']],
  ['npm', ['run', 'check:architecture']],
  ['npm', ['run', 'check:reachability']],
  ['npm', ['run', 'test:plugin-permission-least-privilege']],
  ['npm', ['run', 'test:plugin-permission-foreground']],
  ['npm', ['run', 'test:monaco-bridge-window-boundary']],
  ['npm', ['run', 'test:surface-coordinator-window-boundary']],
  ['npm', ['run', 'test:effect-runner-window-boundary']],
  ['npm', ['run', 'test:first-party-plugin-host-boundary']],
  ['npm', ['run', 'test:launcher-plugin-contract']],
  ['npm', ['run', 'test:launcher-normalize-contribution']],
  ['npm', ['run', 'test:plugin-diff-boundary']],
  ['npm', ['run', 'test:intent-engine']],
  ['npm', ['run', 'test:intent-content-recommend']],
  ['npm', ['run', 'test:launcher-intent-ranking']],
  ['npm', ['run', 'test:self-learning-pr0']],
  ['npm', ['run', 'test:self-learning-pr1']],
  ['npm', ['run', 'test:self-learning-pr2']],
  ['npm', ['run', 'test:self-learning-pr3']],
  ['npm', ['run', 'test:window-architecture-phases']],
  ['npm', ['run', 'test:plugin-editor-surface-open-lifecycle']],
  ['npm', ['run', 'test:refactor-final-acceptance']],
  ['npm', ['run', 'build']],
]

function resolveCommand(command, args) {
  if (command === 'npm' && process.env.npm_execpath) {
    return { command: process.execPath, args: [process.env.npm_execpath, ...args] }
  }
  return { command, args }
}

let failed = 0
for (const [command, args] of commands) {
  const label = [command, ...args].join(' ')
  console.log(`\n▶ ${label}`)
  const resolved = resolveCommand(command, args)
  const result = spawnSync(resolved.command, resolved.args, {
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    console.error(`✗ failed: ${label} (exit ${result.status ?? 'signal'})`)
    failed += 1
  } else {
    console.log(`✓ ${label}`)
  }
}

if (failed > 0) {
  console.error(`\nquality gate failed: ${failed} step(s)`)
  process.exit(1)
}

console.log('\nquality gate passed')
