#!/usr/bin/env node
/** Clipboard history is a plugin, not a workflow action provider. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

assert.equal(existsSync('src/workflow/clipboardHistoryWorkflowProvider.ts'), false, 'legacy workflow provider deleted')
const plugin = readFileSync('src/plugins/clipboard-history/index.tsx', 'utf8')
const defaults = readFileSync('src/workflow/defaultWorkflowProviders.ts', 'utf8')
assert.match(plugin, /definePlugin|clipboard-history|clipboardHistory/, 'clipboard-history plugin entry')
assert.doesNotMatch(defaults, /registerWorkActionProvider\(clipboardHistory/, 'not registered as workflow action provider')
console.log('workflow clipboard history story (plugin-owned) checks passed')
