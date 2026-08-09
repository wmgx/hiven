#!/usr/bin/env node
/** inputResolver retired → editorBridge + contextBroker. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

assert.equal(existsSync('src/workspace/inputResolver.ts'), false, 'inputResolver deleted')
const bridge = readFileSync('src/workspace/editorBridge.ts', 'utf8')
const broker = readFileSync('src/launcher/context/contextBroker.ts', 'utf8')
assert.match(bridge, /getEditorContext|getActiveEditorContextSnapshot/, 'editor context APIs')
assert.match(broker, /getActiveEditorContextSnapshot|WorkContextSnapshot/, 'context broker uses editor snapshot')
console.log('input resolver editor context (retired → bridge) checks passed')
