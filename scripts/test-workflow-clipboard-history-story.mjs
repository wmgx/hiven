#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const files = {
  packageJson: read('package.json'),
  refactorSuite: read('scripts/test-refactor-suite.mjs'),
  clipboardHistoryWorkflow: read('src/workflow/clipboardHistoryWorkflowProvider.ts'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:workflow-clipboard-history-story'],
  'node scripts/test-workflow-clipboard-history-story.mjs',
  'package.json must expose test:workflow-clipboard-history-story',
)
assert.match(
  files.refactorSuite,
  /test:workflow-clipboard-history-story/,
  'refactor suite must include clipboard history workflow story coverage',
)
assert.match(
  files.clipboardHistoryWorkflow,
  /registerWorkActionProvider\(clipboardHistoryActionProvider\)/,
  'clipboard history workflow must register its own action provider',
)
assert.match(
  files.clipboardHistoryWorkflow,
  /input\.source\s*!==\s*['"]plugin\.clipboard-history['"]/,
  'clipboard history actions must only attach to clipboard-history WorkObjects',
)
assert.match(
  files.clipboardHistoryWorkflow,
  /id:\s*['"]workflow\.paste-clipboard-history-item['"][\s\S]*title:\s*['"]Paste Clipboard History Item['"][\s\S]*defaultOutputTarget:\s*['"]paste-to-foreground-app['"]/,
  'clipboard history objects must expose an explicit paste-to-foreground action',
)
assert.match(
  files.clipboardHistoryWorkflow,
  /workflow\.paste-clipboard-history-item[\s\S]*routeTextOutput\(text,[\s\S]*kind:\s*['"]paste-to-foreground-app['"]/,
  'clipboard history paste action must route through OutputRouter paste-to-foreground-app',
)
assert.match(
  files.clipboardHistoryWorkflow,
  /id:\s*['"]workflow\.open-clipboard-history-item-in-editor['"][\s\S]*title:\s*['"]Open Clipboard History Item in Editor['"][\s\S]*defaultOutputTarget:\s*['"]open-in-editor['"]/,
  'clipboard history objects must expose an explicit open-in-editor action',
)
assert.match(
  files.clipboardHistoryWorkflow,
  /workflow\.open-clipboard-history-item-in-editor[\s\S]*routeTextOutput\(text,[\s\S]*kind:\s*['"]open-in-editor['"]/,
  'clipboard history open action must route through OutputRouter open-in-editor',
)
assert.match(
  files.clipboardHistoryWorkflow,
  /id:\s*['"]workflow\.copy-clipboard-history-item['"][\s\S]*routeTextOutput\(text,[\s\S]*kind:\s*['"]copy['"]/,
  'clipboard history objects must keep a short-task copy action',
)

console.log('workflow clipboard history story checks passed')
