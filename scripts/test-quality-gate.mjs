#!/usr/bin/env node

/**
 * B1 quality gate — mandatory checks for PR / main.
 *
 * Enforces typecheck/build, dependency portability, runtime fallbacks,
 * architecture, reachability, permissions and key boundary contracts.
 *
 * Tag release must not be weaker than this gate.
 */

import { spawnSync } from 'node:child_process'

const commands = [
  ['npm', ['run', 'test:lockfile-registry']],
  ['npm', ['run', 'test:baseline-runtime-fallbacks']],
  ['npm', ['run', 'test:tauri-debug-runner']],
  ['npm', ['run', 'test:builtin-plugin-release']],
  ['npm', ['run', 'test:builtin-application-updates']],
  ['npm', ['run', 'test:plugin-runtime-lifecycle']],
  ['npm', ['run', 'test:plugin-settings-save']],
  ['npm', ['run', 'test:web-open-rule-consistency']],
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
  ['npm', ['run', 'test:csv-entry']],
  ['npm', ['run', 'test:launcher-normalize-contribution']],
  ['npm', ['run', 'test:launcher-plugin-lifetime']],
  ['npm', ['run', 'test:plugin-diff-boundary']],
  ['npm', ['run', 'test:intent-engine']],
  ['npm', ['run', 'test:intent-content-recommend']],
  ['npm', ['run', 'test:launcher-intent-ranking']],
  ['npm', ['run', 'test:launcher-visible-items']],
  ['npm', ['run', 'test:launcher-selection-preserve']],
  ['npm', ['run', 'test:launcher-favorites']],
  ['npm', ['run', 'test:launcher-discovery-availability']],
  ['npm', ['run', 'test:app-launch-feedback']],
  ['npm', ['run', 'test:app-search-aliases']],
  ['npm', ['run', 'test:app-hotkeys-runtime']],
  ['npm', ['run', 'test:shortcut-ownership-runtime']],
  ['npm', ['run', 'test:launcher-explicit-text-preview']],
  ['npm', ['run', 'test:launcher-explicit-text-flow']],
  ['npm', ['run', 'test:launcher-input-drafts']],
  ['npm', ['run', 'test:launcher-output-recovery']],
  ['npm', ['run', 'test:plugin-paste-behavior']],
  ['npm', ['run', 'test:launcher-current-material']],
  ['npm', ['run', 'test:launcher-material-edit']],
  ['npm', ['run', 'test:file-text-material']],
  ['npm', ['run', 'test:plugin-surface-object-origin']],
  ['npm', ['run', 'test:ai-provider-runtime']],
  ['npm', ['run', 'test:ai-preflight']],
  ['npm', ['run', 'test:translate-ai-readiness']],
  ['npm', ['run', 'test:translate-ai-glossary']],
  ['npm', ['run', 'test:translate-output-eligibility']],
  ['npm', ['run', 'test:regex-match-extraction']],
  ['npm', ['run', 'test:text-diff-source-read-lifetime']],
  ['npm', ['run', 'test:text-diff-copy-side']],
  ['npm', ['run', 'test:text-explode-output']],
  ['npm', ['run', 'test:translate-plugin']],
  ['npm', ['run', 'test:ime-enter-confirmation']],
  ['npm', ['run', 'test:automatic-learning-settings']],
  ['npm', ['run', 'test:automatic-learning-lifecycle']],
  ['npm', ['run', 'test:self-learning-pr0']],
  ['npm', ['run', 'test:self-learning-pr1']],
  ['npm', ['run', 'test:self-learning-pr2']],
  ['npm', ['run', 'test:saved-action-rename']],
  ['npm', ['run', 'test:saved-action-delete']],
  ['npm', ['run', 'test:self-learning-pr3']],
  ['npm', ['run', 'test:window-architecture-phases']],
  ['npm', ['run', 'test:plugin-editor-surface-open-lifecycle']],
  ['npm', ['run', 'test:refactor-final-acceptance']],
  ['npm', ['run', 'build']],
  ['npm', ['run', 'test:startup-source-graph']],
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
