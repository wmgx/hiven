#!/usr/bin/env node
/** Editor bridge static contract — fire-and-forget startup path. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const suite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')
const bridge = readFileSync('src/workspace/editorBridge.ts', 'utf8')

assert.ok(packageJson.scripts?.['test:editor-bridge-behavior'])
assert.match(suite, /test:editor-bridge-behavior/)
assert.match(bridge, /EDITOR_BRIDGE_READY_EVENT/, 'ready event')
assert.match(bridge, /emitEditorBridgeReady/, 'emit ready after handler registration')
assert.match(bridge, /persistPendingEditorBridgeRequest/, 'queue startup requests')
assert.match(bridge, /openEditorFirst[\s\S]*showEditorWindow|if \(options\.openEditorFirst && persisted\)/, 'fire-and-forget open')
assert.match(bridge, /waitForEditorBridgeResponse/, 'live path waits for response')
assert.match(bridge, /clearPendingEditorBridgeRequest/, 'failed delivery clears pending')
assert.match(bridge, /expiresAt/, 'requests carry expiry')
assert.match(bridge, /isEditorBridgeRequestExpired/, 'reject expired requests')
assert.match(bridge, /EDITOR_ACTIVE_CONTEXT_SNAPSHOT_KEY|EDITOR_ACTIVE_PANE_SNAPSHOT_KEY/, 'active snapshot keys')
assert.match(bridge, /clearActiveEditorSnapshots/, 'teardown cleanup')
assert.doesNotMatch(bridge, /waitForEditorBridgeReady/, 'ready-wait path retired')
console.log('editor bridge behavior (static) checks passed')
