#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadContextBroker(globals = {}) {
  let src = readFileSync('src/launcher/context/contextBroker.ts', 'utf8')
  src = src.replace(/import\s+type\s*\{[\s\S]*?\}\s*from\s*['"][^'"]*['"]\s*;?\s*\n?/g, '')
  src = src.replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]*['"]\s*;?\s*\n?/g, '')
  src = src.replace(/import\(['"]@tauri-apps\/api\/core['"]\)/g, 'Promise.resolve(__tauriCore)')
  src = src.replace(/import\(['"]@tauri-apps\/plugin-clipboard-manager['"]\)/g, 'Promise.resolve(__clipboardManager)')
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
    URLSearchParams,
    navigator: { clipboard: { readText: async () => '' } },
    window: {
      __TAURI_INTERNALS__: {},
      location: { search: '' },
      setTimeout: (fn) => { fn(); return 0 },
    },
    EDITOR_WINDOW_LABEL: 'editor',
    runtimeRegistry: { getCodeEditor: () => undefined },
    useWorkspaceStore: { getState: () => ({ panes: {}, activePaneId: '', paneOrder: [] }) },
    getActiveEditorContextSnapshot: () => undefined,
    getEditorContext: async () => undefined,
    readLocalEditorContextSnapshot: () => undefined,
    launcherPerfNow: () => 0,
    logLauncherPerfDuration: () => {},
    __tauriCore: { invoke: async () => undefined },
    __clipboardManager: { readText: async () => '' },
    ...globals,
  }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')
const contextBrokerSource = readFileSync('src/launcher/context/contextBroker.ts', 'utf8')

const broker = loadContextBroker({ console: { ...console, warn: () => undefined } })
const invocation = { source: 'global-hotkey', timestamp: 123 }
const snapshot = await broker.createWorkContextSnapshot(invocation, [
  { id: 'foreground', getSnapshot: () => ({ foreground: { appName: 'Mail', processId: 10 } }) },
  { id: 'failing-provider', getSnapshot: () => { throw new Error('provider failed') } },
  { id: 'clipboard', getSnapshot: async () => ({ clipboard: { kind: 'text', text: 'copied', preview: 'copied' } }) },
  { id: 'editor', getSnapshot: () => ({ editor: { windowLabel: 'editor', activePaneId: 'pane-1', paneIds: ['pane-1'], activeText: 'draft' } }) },
])
assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), {
  invocation,
  foreground: { appName: 'Mail', processId: 10 },
  clipboard: { kind: 'text', text: 'copied', preview: 'copied' },
  editor: { windowLabel: 'editor', activePaneId: 'pane-1', paneIds: ['pane-1'], activeText: 'draft' },
}, 'createWorkContextSnapshot must merge successful providers and skip failed providers')

const cachedEditor = {
  windowLabel: 'editor',
  activePaneId: 'pane-2',
  paneIds: ['pane-2'],
  activeText: 'cached editor text',
  selectedText: 'cached',
}
const defaultCalls = { invoke: [], clipboardReads: 0, liveEditorReads: 0 }
const defaultBroker = loadContextBroker({
  getActiveEditorContextSnapshot: () => cachedEditor,
  getEditorContext: async () => {
    defaultCalls.liveEditorReads += 1
    return undefined
  },
  __tauriCore: {
    invoke: async (command) => {
      defaultCalls.invoke.push(command)
      if (command === 'current_foreground_app_context') {
        return { appName: 'Chrome', processId: 42, windowTitle: 'Docs' }
      }
      if (command === 'last_foreground_selection_text') return 'selected from browser'
      return undefined
    },
  },
  __clipboardManager: {
    readText: async () => {
      defaultCalls.clipboardReads += 1
      return 'clipboard text'
    },
  },
})
const defaultSnapshot = await defaultBroker.createDefaultWorkContextSnapshot('global-hotkey', [
  { id: 'extra', getSnapshot: () => ({ extraFieldForTest: true }) },
])
assert.equal(defaultSnapshot.invocation.source, 'global-hotkey')
assert.equal(typeof defaultSnapshot.invocation.timestamp, 'number')
assert.deepEqual(JSON.parse(JSON.stringify(defaultSnapshot.foreground)), { appName: 'Chrome', processId: 42, windowTitle: 'Docs' })
assert.deepEqual(JSON.parse(JSON.stringify(defaultSnapshot.editor)), cachedEditor, 'default snapshot must prefer active editor cache before live bridge request')
assert.equal(defaultSnapshot.externalSelection, undefined, 'default snapshot must NOT include external selection (clipboard-first design)')
assert.deepEqual(JSON.parse(JSON.stringify(defaultSnapshot.clipboard)), { kind: 'text', text: 'clipboard text', preview: 'clipboard text' })
assert.equal(defaultSnapshot.extraFieldForTest, true, 'createDefaultWorkContextSnapshot must append caller-provided providers after defaults')
assert.deepEqual(defaultCalls.invoke, ['current_foreground_app_context'])
assert.equal(defaultCalls.clipboardReads, 1)
assert.equal(defaultCalls.liveEditorReads, 0)

assert.equal(
  packageJson.scripts?.['test:context-broker-behavior'],
  'node scripts/test-context-broker-behavior.mjs',
  'package.json must expose test:context-broker-behavior',
)
assert.doesNotMatch(
  contextBrokerSource,
  /useWorkspaceStore|runtimeRegistry/,
  'global context broker must not read editor window store/runtime registry directly',
)
assert.match(
  contextBrokerSource,
  /function isEditorWindowRuntime\(\)[\s\S]*try[\s\S]*window\.location\.search[\s\S]*catch/,
  'context broker editor runtime detection must be safe in non-window test/runtime contexts',
)
assert.match(
  refactorSuite,
  /test:context-broker-behavior/,
  'refactor suite must include context broker behavior coverage',
)

console.log('context broker behavior checks passed')
