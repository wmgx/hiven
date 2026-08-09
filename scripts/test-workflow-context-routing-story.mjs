#!/usr/bin/env node
/** Workflow context routing static contract. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const providers = readFileSync('src/workflow/defaultWorkflowProviders.ts', 'utf8')
const bridge = readFileSync('src/workspace/editorBridge.ts', 'utf8')
assert.match(providers, /getActiveEditorContextSnapshot/, 'providers read editor snapshot')
assert.match(bridge, /export function getActiveEditorContextSnapshot/, 'snapshot export')
assert.match(providers, /showPluginSurfaceWindow|routeTextOutput|createQuickEditorPane/, 'routing targets')
console.log('workflow context routing story (static) checks passed')
