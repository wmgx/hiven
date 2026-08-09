#!/usr/bin/env node
/** Quick Editor window launch + editor bridge contract. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p) => readFileSync(join(root, p), 'utf8')
assert.equal(existsSync('src/components/EditorWindow.tsx'), false, 'legacy EditorWindow deleted')

const main = read('src/main.tsx')
const editorWindowApi = read('src/workspace/editorWindow.ts')
const editorBridge = read('src/workspace/editorBridge.ts')
const quickEditorWindow = read('src/workspace/windowManager/quickEditorWindow.ts')
const tauriLib = read('src-tauri/src/lib.rs')
const capability = JSON.parse(read('src-tauri/capabilities/default.json'))

assert.match(main, /quick-editor|QuickEditorDetachedView/, 'main routes quick-editor window')
assert.match(editorWindowApi, /showQuickEditorWindow|requestOpenEditorWindow/, 'editor API forwards to quick editor')
assert.match(editorWindowApi, /upsertSurfaceInstance|markSurfaceInstanceState/, 'registers surface instances')
assert.doesNotMatch(editorWindowApi, /new WebviewWindow/, 'frontend must not create editor windows directly')
assert.match(quickEditorWindow, /showQuickEditorWindow|QUICK_EDITOR/, 'quick editor window manager exists')
assert.match(editorBridge, /EDITOR_BRIDGE_REQUEST_EVENT/, 'bridge request event')
assert.match(editorBridge, /EDITOR_BRIDGE_RESPONSE_EVENT/, 'bridge response event')
assert.match(editorBridge, /EDITOR_BRIDGE_READY_EVENT/, 'bridge ready event')
assert.match(editorBridge, /getEditorContext|createEditorPane|replaceEditorSelection|insertIntoEditor/, 'bridge mutation APIs')
assert.match(editorBridge, /persistPendingEditorBridgeRequest/, 'pending request persistence')
assert.match(editorBridge, /openEditorFirst[\s\S]*showEditorWindow|showEditorWindow\(\)/, 'startup open path exists')
assert.match(editorBridge, /emitEditorBridgeReady/, 'handlers publish ready')
assert.match(editorBridge, /clearActiveEditorSnapshots|registerActiveEditorContext|updateActivePaneSnapshot/, 'active snapshot APIs')
assert.match(tauriLib, /quick.?editor|show_.*editor|editor/i, 'native editor window support')
assert.ok(Array.isArray(capability.windows), 'capabilities declare windows')
console.log('editor window launch checks passed')
