#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const sourcePath = new URL('../src/workflow/defaultWorkflowProviders.ts', import.meta.url)
const fullSource = fs.readFileSync(sourcePath, 'utf8')
const providerStart = fullSource.indexOf('export const currentContextObjectProvider')
const providerEnd = fullSource.indexOf('export const hostAppObjectProvider')
const previewStart = fullSource.indexOf('function preview(')
const previewDelimiter = `
}

export function tryFormatJsonClipboardText`
const previewEnd = fullSource.indexOf(previewDelimiter, previewStart) + 3
assert.notEqual(providerStart, -1, 'currentContextObjectProvider source should exist')
assert.notEqual(providerEnd, -1, 'hostAppObjectProvider source should delimit context provider')
assert.notEqual(previewStart, -1, 'preview helper source should exist')
let source = `${fullSource.slice(providerStart, providerEnd)}
${fullSource.slice(previewStart, previewEnd)}`

source = source
  .replace(/export const currentContextObjectProvider/g, 'const currentContextObjectProvider')
  .replace(/: WorkObjectProvider/g, '')
  .replace(/: WorkObject\[\]/g, '')
  .replace(/: string/g, '')
source += '\n;globalThis.__currentContextObjectProvider = currentContextObjectProvider;'

const timestamp = 1770000000000
let snapshot = {
  invocation: { source: 'global-hotkey', timestamp },
  externalSelection: { text: '  external selected text  ' },
  editor: {
    windowLabel: 'editor',
    activePaneId: 'pane-1',
    selectedText: '  editor selected text  ',
    language: 'markdown',
  },
  clipboard: { kind: 'text', text: '  clipboard text  ' },
}

const sandbox = {
  console,
  createDefaultWorkContextSnapshot: async (source) => {
    assert.equal(source, 'global-hotkey')
    return snapshot
  },
  EDITOR_WINDOW_LABEL: 'editor',
  registerClipboardHistoryWorkflowProvider: () => {},
  registerWorkObjectProvider: () => {},
  registerWorkActionProvider: () => {},
  focusSurfaceInstance: () => {},
  getSurfaceInstances: () => [],
  useAppStore: { getState: () => ({ locale: 'en' }) },
  getHostAppWorkObjects: () => [],
  launchHostAppObject: () => {},
  createEditorPane: () => {},
  openEditorPanel: () => {},
  showEditorWindow: () => {},
  showPluginSurfaceWindow: () => {},
  PLUGIN_SURFACE_PANEL_ID: 'plugin-surface',
  createDefaultOutputRouterContext: () => ({}),
  routeTextOutput: () => {},
}

vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'defaultWorkflowProviders.ts' })

const provider = sandbox.__currentContextObjectProvider
assert.equal(provider.id, 'workflow.context-objects')

const objects = await provider.collect()
const byId = new Map(objects.map((object) => [object.id, object]))


function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

assert.deepEqual(plain(byId.get('context:external-selected-text')), {
  id: 'context:external-selected-text',
  type: 'text',
  title: 'Selected Text',
  subtitle: 'external selected text',
  icon: 'TextSelect',
  source: 'context.external-selection',
  text: 'external selected text',
  updatedAt: timestamp,
})

assert.deepEqual(plain(byId.get('context:selected-text')), {
  id: 'context:selected-text',
  type: 'text',
  title: 'Selected Text',
  subtitle: 'editor selected text',
  icon: 'TextSelect',
  source: 'context.editor-selection',
  text: 'editor selected text',
  language: 'markdown',
  updatedAt: timestamp,
})

assert.deepEqual(plain(byId.get('context:clipboard-text')), {
  id: 'context:clipboard-text',
  type: 'clipboard',
  title: 'Clipboard Text',
  subtitle: 'clipboard text',
  icon: 'Clipboard',
  source: 'context.clipboard',
  contentType: 'text',
  preview: 'clipboard text',
  updatedAt: timestamp,
})

assert.deepEqual(plain(byId.get('context:clipboard-text-as-text')), {
  id: 'context:clipboard-text-as-text',
  type: 'text',
  title: 'Clipboard as Text',
  subtitle: 'clipboard text',
  icon: 'Text',
  source: 'context.clipboard',
  text: 'clipboard text',
  updatedAt: timestamp,
})

assert.deepEqual(plain(byId.get('editor:pane-1')), {
  id: 'editor:pane-1',
  type: 'editor-document',
  title: 'Current Editor Document',
  subtitle: 'markdown',
  icon: 'PanelTop',
  source: 'context.editor',
  windowLabel: 'editor',
  paneId: 'pane-1',
  language: 'markdown',
  updatedAt: timestamp,
})

snapshot = {
  invocation: { source: 'global-hotkey', timestamp },
  externalSelection: { text: '    ' },
  editor: {
    windowLabel: 'editor',
    activePaneId: 'pane-2',
    selectedText: ' \n\t ',
    language: undefined,
  },
  clipboard: { kind: 'text', text: '   ' },
}

const whitespaceObjects = await provider.collect()
assert.deepEqual(plain(whitespaceObjects.map((object) => object.id)), ['editor:pane-2'])

console.log('current context work object behavior checks passed')
