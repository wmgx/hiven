#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const commands = [
  ['npm', ['run', 'test:hiven-brand-migration']],
  ['npm', ['run', 'test:refactor-final-acceptance']],
  ['npm', ['run', 'test:background-lifecycle']],
  ['npm', ['run', 'test:tauri-debug-smoke']],
  ['npm', ['run', 'test:window-architecture-phases']],
  ['npm', ['run', 'test:no-main-window-startup']],
  ['npm', ['run', 'test:editor-window-launch']],
  ['npm', ['run', 'test:editor-command-bar-scope']],
  ['npm', ['run', 'test:editor-command-bar-attach-surfaces']],
  ['npm', ['run', 'test:global-launcher-open-editor']],
  ['npm', ['run', 'test:context-snapshot-editor']],
  ['npm', ['run', 'test:external-selection-context']],
  ['npm', ['run', 'test:output-router-text-targets']],
  ['npm', ['run', 'test:plugin-surface-window']],
  ['npm', ['run', 'test:plugin-surface-shortcut-window']],
  ['npm', ['run', 'test:plugin-surface-shortcuts']],
  ['npm', ['run', 'test:workflow-object-model']],
  ['npm', ['run', 'test:workflow-registry-behavior']],
  ['npm', ['run', 'test:workflow-launcher-adapter-behavior']],
  ['npm', ['run', 'test:global-launcher-workflow-tab-behavior']],
  ['npm', ['run', 'test:editor-bridge-behavior']],
  ['npm', ['run', 'test:surface-registry-behavior']],
  ['npm', ['run', 'test:plugin-surface-window-lifecycle-behavior']],
  ['npm', ['run', 'test:output-router-behavior']],
  ['npm', ['run', 'test:context-broker-behavior']],
  ['npm', ['run', 'test:current-context-work-objects-behavior']],
  ['npm', ['run', 'test:workflow-json-clipboard-story']],
  ['npm', ['run', 'test:workflow-translate-selection-story']],
  ['npm', ['run', 'test:workflow-clipboard-history-story']],
  ['npm', ['run', 'test:workflow-chat-reply-story']],
  ['npm', ['run', 'test:workflow-json-panel-story']],
  ['npm', ['run', 'test:command-palette-page-policy']],
  ['npm', ['run', 'test:command-palette-system-page-shortcuts']],
  ['npm', ['run', 'test:command-palette-extension-settings']],
  ['npm', ['run', 'test:global-launcher-quick-text']],
  ['npm', ['run', 'test:global-launcher-system-power-actions']],
  ['npm', ['run', 'test:global-launcher-v3-ui']],
  ['npm', ['run', 'test:global-launcher-window-height']],
  ['npm', ['run', 'test:instant-suggestion-multiple-results']],
  ['npm', ['run', 'test:launcher-back-focus']],
  ['npm', ['run', 'test:launcher-controller']],
  ['npm', ['run', 'test:launcher-identity']],
  ['npm', ['run', 'test:launcher-plugin-contract']],
  ['npm', ['run', 'test:launcher-ranking']],
  ['npm', ['run', 'test:launcher-registry']],
  ['npm', ['run', 'test:launcher-usage']],
  ['npm', ['run', 'test:plugin-text-output-contract']],
  ['npm', ['run', 'test:pinned-action-completion-gaps']],
  ['npm', ['run', 'test:pinned-runner-policy']],
  ['npm', ['run', 'test:pinned-action-live-runner']],
  ['npm', ['run', 'test:global-pinned-launcher']],
  ['npm', ['run', 'test:clipboard-history-runtime']],
  ['npm', ['run', 'test:launcher-web-smoke']],
  ['npm', ['run', 'test:window-entry-runtime-smoke']],
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
