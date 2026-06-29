#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')

assert.equal(
  packageJson.scripts?.['test:editor-command-bar-local-actions-behavior'],
  'node scripts/test-editor-command-bar-local-actions-behavior.mjs',
  'package.json must expose editor local action behavior coverage',
)
assert.match(
  refactorSuite,
  /test:editor-command-bar-local-actions-behavior/,
  'refactor suite must include editor local action behavior coverage',
)

let activePaneText = ''
let selectedText
let selection
const effects = []
const openedPanels = []
const storeState = {
  activePaneId: 'pane-1',
  panes: {
    'pane-1': { id: 'pane-1', text: '' },
  },
  paneOrder: ['pane-1'],
}

function syncPaneText(text) {
  activePaneText = text
  storeState.panes['pane-1'].text = text
}

function setSelectionText(text, range = { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 8 }) {
  selectedText = text
  selection = {
    ...range,
    isEmpty: () => false,
  }
}

function clearSelection() {
  selectedText = undefined
  selection = {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 1,
    isEmpty: () => true,
  }
}


function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function findItem(items, systemKey) {
  const item = items.find((candidate) => candidate.systemKey === systemKey)
  assert.ok(item, `${systemKey} should exist`)
  assert.deepEqual(plain(item.surfaces), ['editor-command-bar'], `${systemKey} must be scoped to editor-command-bar`)
  return item
}

function latestReplaceText() {
  const effect = effects.at(-1)
  assert.equal(effect.type, 'text.replace')
  return effect.text
}

function loadTsModule(path, globals = {}) {
  let src = readFileSync(path, 'utf8')
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
    ...globals,
  }
  vm.runInNewContext(out, sandbox, { filename: path })
  return sandbox.module.exports
}

const editorTextTransforms = loadTsModule('src/workflow/editorTextTransforms.ts')
let src = readFileSync('src/workspace/launcher/hostActions.ts', 'utf8')
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
  useWorkspaceStore: {
    getState: () => storeState,
  },
  translate: (_locale, entry) => entry,
  createEditorPane: async () => {},
  openEditorPanel: async (input) => { openedPanels.push(input) },
  applyEffects: (nextEffects) => { effects.push(...nextEffects) },
  showLauncherWindow: async () => {},
  ...editorTextTransforms,
  runtimeRegistry: {
    getCodeEditor: () => ({
      getSelection: () => selection,
      getModel: () => ({
        getValueInRange: () => selectedText,
      }),
    }),
  },
  PLUGIN_SURFACE_PANEL_ID: 'plugin-surface',
}
vm.runInNewContext(out, sandbox, { filename: 'hostActions.ts' })

const { getHostPaneControlItems } = sandbox.module.exports
const items = getHostPaneControlItems()

syncPaneText('alpha\nbeta; gamma。delta')
clearSelection()
await findItem(items, 'host:editor:format-bullets').execute({})
assert.equal(latestReplaceText(), '- alpha\n- beta\n- gamma\n- delta')
assert.deepEqual(plain(effects.at(-1).target), { paneId: 'pane-1' })

setSelectionText('const answer = 42')
await findItem(items, 'host:editor:quote-code-block').execute({})
assert.equal(latestReplaceText(), '```\nconst answer = 42\n```')
assert.deepEqual(plain(effects.at(-1).target), {
  paneId: 'pane-1',
  range: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 8 },
})

syncPaneText('{\n  "name": "Hiven",\n  "nested": { "count": 2 },\n  "items": [{ "id": 1 }]\n}')
clearSelection()
await findItem(items, 'host:editor:json-minify').execute({})
assert.equal(latestReplaceText(), '{"name":"Hiven","nested":{"count":2},"items":[{"id":1}]}')

await findItem(items, 'host:editor:json-to-yaml').execute({})
assert.equal(latestReplaceText(), [
  'name: "Hiven"',
  'nested:',
  '  count: 2',
  'items:',
  '  - ',
  '    id: 1',
].join('\n'))

await findItem(items, 'host:editor:json-extract-fields').execute({})
assert.equal(latestReplaceText(), [
  'name',
  'nested.count',
  'items[0].id',
].join('\n'))

syncPaneText('{ bad json')
const invalidJsonResult = await findItem(items, 'host:editor:json-minify').execute({})
assert.deepEqual(plain(invalidJsonResult), { ok: false })
assert.notEqual(latestReplaceText(), '{ bad json')

syncPaneText('translate this text')
clearSelection()
await findItem(items, 'host:editor:attach-translate-panel').execute({})
assert.deepEqual(plain(openedPanels.at(-1)), {
  panelId: 'plugin-surface',
  placement: 'right',
  inputs: {
    text: 'translate this text',
    target: {
      source: 'builtin',
      pluginId: 'translate',
      surfaceId: 'main',
      initialText: 'translate this text',
    },
  },
})

console.log('editor command bar local action behavior checks passed')
