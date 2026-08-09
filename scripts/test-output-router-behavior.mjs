#!/usr/bin/env node
/** Output router static contract. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const router = readFileSync('src/workflow/outputRouter.ts', 'utf8')
const requests = readFileSync('src/workspace/quickEditor/quickEditorRequests.ts', 'utf8')

assert.match(router, /overwriteQuickEditorText|createQuickEditorPane|showPluginSurfaceWindow|routeTextOutput/i, 'router APIs')
assert.match(requests, /export async function overwriteQuickEditorText/, 'quick editor overwrite export')
assert.match(router, /overwriteQuickEditorText/, 'router imports overwrite')
console.log('output router behavior (static) checks passed')
