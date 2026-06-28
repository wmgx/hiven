#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const files = {
  packageJson: read('package.json'),
  defaultWorkflowProviders: read('src/workflow/defaultWorkflowProviders.ts'),
  workflowIndex: read('src/workflow/index.ts'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:workflow-json-clipboard-story'],
  'node scripts/test-workflow-json-clipboard-story.mjs',
  'package.json must expose test:workflow-json-clipboard-story',
)
assert.match(
  files.defaultWorkflowProviders,
  /function\s+tryFormatJsonClipboardText\(text:\s*string\):\s*string\s*\|\s*null[\s\S]*JSON\.parse/,
  'workflow must detect and format valid JSON clipboard text through real JSON.parse',
)
assert.match(
  files.defaultWorkflowProviders,
  /id:\s*['"]workflow\.format-json-clipboard['"][\s\S]*title:\s*['"]Format Clipboard JSON['"][\s\S]*defaultOutputTarget:\s*['"]open-in-editor['"]/,
  'clipboard text actions must expose a Format Clipboard JSON action that defaults to opening the formatted result in editor',
)
assert.match(
  files.defaultWorkflowProviders,
  /workflow\.format-json-clipboard[\s\S]*routeTextOutput\(formatted,[\s\S]*kind:\s*['"]open-in-editor['"][\s\S]*language:\s*['"]json['"][\s\S]*title:\s*['"]Formatted Clipboard JSON['"]/,
  'Format Clipboard JSON must route formatted output to the editor as JSON',
)
assert.match(
  files.defaultWorkflowProviders,
  /workflow\.copy-formatted-json[\s\S]*routeTextOutput\(formatted,[\s\S]*kind:\s*['"]copy['"]/,
  'clipboard JSON workflow must also allow copying formatted JSON for short tasks',
)
assert.match(
  files.defaultWorkflowProviders,
  /workflow\.paste-formatted-json[\s\S]*routeTextOutput\(formatted,[\s\S]*kind:\s*['"]paste-to-foreground-app['"]/,
  'clipboard JSON workflow must also allow pasting formatted JSON back to the foreground app',
)
assert.match(
  files.defaultWorkflowProviders,
  /if\s*\(input\.type\s*!==\s*['"]clipboard['"]\s*\|\|\s*input\.contentType\s*!==\s*['"]text['"]\)\s*return\s*\[\]/,
  'JSON clipboard actions must only attach to text clipboard objects',
)
assert.match(
  files.workflowIndex,
  /tryFormatJsonClipboardText/,
  'workflow index must export JSON clipboard formatting for focused verification and future providers',
)

console.log('workflow JSON clipboard story checks passed')
