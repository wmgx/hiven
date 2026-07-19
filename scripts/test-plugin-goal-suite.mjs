#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const npmCli = process.env.npm_execpath

const steps = [
  ['npm', 'test:directory-plugin-convergence'],
  ['npm', 'test:plugin-package-lifecycle'],
  ['npm', 'test:plugin-product-convergence'],
  ['npm', 'test:step5-no-pin-and-csv-surface'],
  ['npm', 'test:step5-calculator-and-diff-panels'],
  ['npm', 'test:design-language-migration'],
  ['npm', 'test:tauri-plugin-dir-commands'],
  ['npm', 'check:architecture'],
  ['git', 'diff', '--check'],
  ['npm', 'build'],
]

function runStep(step) {
  const [tool, ...args] = step
  const command = tool === 'npm' && npmCli ? process.execPath : tool
  const commandArgs = tool === 'npm'
    ? (npmCli ? [npmCli, 'run', ...args] : ['run', ...args])
    : args
  const label = tool === 'npm' ? `npm run ${args.join(' ')}` : [tool, ...args].join(' ')
  console.log(`\n[plugin-goal-suite] ${label}`)
  const result = spawnSync(command, commandArgs, { stdio: 'inherit' })
  if (result.error) {
    console.error(`[plugin-goal-suite] failed to start: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`[plugin-goal-suite] failed: ${label}`)
    process.exit(result.status ?? 1)
  }
}

for (const step of steps) {
  runStep(step)
}

console.log('\nplugin goal suite checks passed')
