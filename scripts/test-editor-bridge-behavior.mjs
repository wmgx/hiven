#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')

assert.equal(
  packageJson.scripts?.['test:editor-bridge-behavior'],
  'node scripts/test-editor-bridge-behavior.mjs',
  'package.json must expose test:editor-bridge-behavior',
)
assert.match(
  refactorSuite,
  /test:editor-bridge-behavior/,
  'refactor suite must include editor bridge behavior coverage',
)
const editorBridgeSource = readFileSync('src/workspace/editorBridge.ts', 'utf8')
assert.match(editorBridgeSource, /EDITOR_BRIDGE_READY_EVENT/, 'editor bridge must define an editor-ready event')
assert.match(editorBridgeSource, /waitForEditorBridgeReady/, 'editor bridge requests must wait for editor readiness before delivery')
assert.match(editorBridgeSource, /emitEditorBridgeReady/, 'editor bridge handlers must publish readiness after registration')
assert.match(editorBridgeSource, /clearPendingEditorBridgeRequest\(request\.requestId\)/, 'failed delivery must clear pending requests to avoid late execution')
assert.match(editorBridgeSource, /expiresAt:\s*createdAt\s*\+\s*Math\.max\(timeoutMs,\s*0\)/, 'editor bridge requests must carry an execution expiry')
assert.match(editorBridgeSource, /isEditorBridgeRequestExpired\(request\)/, 'editor bridge handlers must reject expired pending requests before executing mutations')
assert.match(editorBridgeSource, /EDITOR_BRIDGE_MUTATION_TIMEOUT_MS\s*=\s*5_000/, 'editor mutations must use a longer explicit timeout than context polling')

function createStorage() {
  const map = new Map()
  return {
    getItem: (key) => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: (key) => { map.delete(key) },
    dump: () => Object.fromEntries(map),
  }
}

function loadEditorBridge({ storage = createStorage(), showEditorWindow = async () => undefined } = {}) {
  let src = readFileSync('src/workspace/editorBridge.ts', 'utf8')
  src = src.replace(/import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g, '')
  src = src.replace(/import\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const moduleExports = {}
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    console,
    localStorage: storage,
    window: {
      clearTimeout,
      setTimeout,
    },
    showEditorWindow,
    EDITOR_WINDOW_LABEL: 'editor',
  }
  vm.runInNewContext(out, sandbox)
  return { bridge: sandbox.module.exports, storage }
}

function readPending(storage) {
  const raw = storage.getItem('hiven:editor-bridge-pending-requests')
  return raw ? JSON.parse(raw) : []
}

const activeContext = {
  windowLabel: 'editor',
  activePaneId: 'pane-1',
  paneIds: ['pane-1'],
  activeText: 'hello',
  selectedText: 'ell',
  language: 'plaintext',
}
const paneSnapshot = {
  activePaneId: 'pane-1',
  paneIds: ['pane-1', 'pane-2'],
  panes: {
    'pane-1': { title: 'One', language: 'plaintext' },
    'pane-2': { title: 'Two', language: 'markdown' },
  },
}

{
  const opened = []
  const { bridge, storage } = loadEditorBridge({ showEditorWindow: async () => { opened.push('editor') } })
  bridge.registerActiveEditorContext(activeContext)
  bridge.updateActivePaneSnapshot(paneSnapshot)

  assert.deepEqual(JSON.parse(JSON.stringify(bridge.getActiveEditorContextSnapshot())), activeContext, 'active editor context must be readable by launcher-side context broker')
  assert.deepEqual(JSON.parse(JSON.stringify(bridge.getActiveEditorPaneSnapshot())), paneSnapshot, 'active pane snapshot must be readable by launcher-side consumers')
  assert.deepEqual(JSON.parse(JSON.stringify(await bridge.getEditorContext({ timeoutMs: 1 }))), activeContext, 'getEditorContext must fall back to the active snapshot when no live Tauri response exists')

  const createdPaneId = await bridge.createEditorPane({ text: 'hello', title: 'Draft', language: 'markdown' })
  assert.equal(createdPaneId, undefined, 'non-Tauri bridge requests return undefined until the editor consumes the pending request')
  assert.deepEqual(opened, ['editor'], 'createEditorPane must open/focus the editor window before delivery')

  const pending = readPending(storage)
  assert.equal(pending.length, 1, 'createEditorPane must persist a pending bridge request for newly-created editor windows')
  assert.equal(pending[0].action, 'createEditorPane')
  assert.deepEqual(JSON.parse(JSON.stringify(pending[0].payload)), { text: 'hello', title: 'Draft', language: 'markdown' })
  assert.equal(typeof pending[0].requestId, 'string')
  assert.equal(typeof pending[0].createdAt, 'number')
  assert.equal(typeof pending[0].expiresAt, 'number')
  assert.ok(pending[0].expiresAt > pending[0].createdAt, 'pending bridge requests must expire after their creation time')
}

{
  const { bridge, storage } = loadEditorBridge({
    showEditorWindow: async () => {
      throw new Error('editor window failed to open')
    },
  })
  await assert.rejects(
    () => bridge.createEditorPane({ text: 'must not run later' }),
    /editor window failed to open/,
    'createEditorPane must report editor-open failures',
  )
  assert.deepEqual(readPending(storage), [], 'failed editor startup must not leave a pending request that can execute later')
}

{
  const storage = createStorage()
  const { bridge } = loadEditorBridge({ storage })
  await bridge.replaceEditorSelection('new text', { paneId: 'pane-1', range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 } })
  await bridge.insertIntoEditor('inserted', { paneId: 'pane-2' })
  await bridge.openEditorPanel({ panelId: 'plugin-surface', placement: 'right', paneId: 'pane-1', inputs: { text: 'payload' }, title: 'Panel' })

  assert.deepEqual(JSON.parse(JSON.stringify(readPending(storage).map((request) => ({ action: request.action, payload: request.payload })))), [
    {
      action: 'replaceEditorSelection',
      payload: { text: 'new text', paneId: 'pane-1', range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 } },
    },
    {
      action: 'insertIntoEditor',
      payload: { text: 'inserted', paneId: 'pane-2' },
    },
    {
      action: 'openEditorPanel',
      payload: { panelId: 'plugin-surface', placement: 'right', paneId: 'pane-1', inputs: { text: 'payload' }, title: 'Panel' },
    },
  ], 'launcher-to-editor text/panel operations must persist ordered pending requests')
}

{
  const storage = createStorage()
  const now = Date.now()
  storage.setItem('hiven:editor-bridge-pending-requests', JSON.stringify([
    { requestId: 'req-expired-replace', action: 'replaceEditorSelection', createdAt: now - 10_000, expiresAt: now - 5_000, payload: { text: 'expired replacement' } },
    { requestId: 'req-context', action: 'getEditorContext', createdAt: now - 100, expiresAt: now + 900, payload: undefined },
    { requestId: 'req-create', action: 'createEditorPane', createdAt: now - 100, expiresAt: now + 4_900, payload: { text: 'pending' } },
    { requestId: 'req-replace', action: 'replaceEditorSelection', createdAt: now - 100, expiresAt: now + 4_900, payload: { text: 'replacement' } },
    { requestId: 'req-insert', action: 'insertIntoEditor', createdAt: now - 100, expiresAt: now + 4_900, payload: { text: 'inserted' } },
    { requestId: 'req-panel', action: 'openEditorPanel', createdAt: now - 100, expiresAt: now + 4_900, payload: { panelId: 'panel', placement: 'right' } },
    { requestId: 'req-invalid', action: 'unknownAction', createdAt: now - 100, expiresAt: now + 4_900, payload: {} },
  ]))
  const { bridge } = loadEditorBridge({ storage })
  const calls = []
  const unlisten = await bridge.registerEditorBridgeHandlers({
    getEditorContext: () => {
      calls.push(['getEditorContext'])
      return activeContext
    },
    createEditorPane: (input) => {
      calls.push(['createEditorPane', input])
      return 'pane-created'
    },
    replaceEditorSelection: (input) => { calls.push(['replaceEditorSelection', input]) },
    insertIntoEditor: (input) => { calls.push(['insertIntoEditor', input]) },
    openEditorPanel: (input) => { calls.push(['openEditorPanel', input]) },
  })

  assert.equal(typeof unlisten, 'function')
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['getEditorContext'],
    ['createEditorPane', { text: 'pending' }],
    ['replaceEditorSelection', { text: 'replacement' }],
    ['insertIntoEditor', { text: 'inserted' }],
    ['openEditorPanel', { panelId: 'panel', placement: 'right' }],
  ], 'editor bridge handlers must consume pending valid requests and ignore invalid ones')
  assert.equal(storage.getItem('hiven:editor-bridge-pending-requests'), null, 'registerEditorBridgeHandlers must clear consumed pending requests')
}

console.log('editor bridge behavior checks passed')
