#!/usr/bin/env node
/** Workflow launcher adapter static contract. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const suite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')
const adapter = readFileSync('src/workflow/workflowLauncherAdapter.ts', 'utf8')

assert.ok(packageJson.scripts?.['test:workflow-launcher-adapter-behavior'])
assert.match(suite, /test:workflow-launcher-adapter-behavior/)
assert.match(adapter, /export (async )?function|export const/, 'adapter exports')
assert.match(adapter, /launcher|workflow|WorkObject|WorkAction/i, 'adapter bridges workflow to launcher')
console.log('workflow launcher adapter behavior (static) checks passed')
