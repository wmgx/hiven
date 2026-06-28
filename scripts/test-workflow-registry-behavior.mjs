#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')

assert.equal(
  packageJson.scripts?.['test:workflow-registry-behavior'],
  'node scripts/test-workflow-registry-behavior.mjs',
  'package.json must expose test:workflow-registry-behavior',
)
assert.match(
  refactorSuite,
  /test:workflow-registry-behavior/,
  'refactor suite must include workflow registry behavior coverage',
)

function plainIds(actions) {
  return JSON.parse(JSON.stringify(actions.map((action) => action.id)))
}

function loadWorkflowRegistry() {
  let src = readFileSync('src/workflow/workflowRegistry.ts', 'utf8')
  src = src.replace(/import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const registry = loadWorkflowRegistry()

registry.registerWorkActionProvider({
  id: 'behavior-test.actions',
  getActions: () => [
    {
      id: 'copy-anywhere',
      title: 'Copy Anywhere',
      accepts: ['text'],
      run: () => ({ ok: true }),
    },
    {
      id: 'paste-to-foreground',
      title: 'Paste to Foreground',
      accepts: ['text'],
      requiresContext: [{ kind: 'foreground-app' }],
      run: () => ({ ok: true }),
    },
    {
      id: 'replace-editor-selection',
      title: 'Replace Editor Selection',
      accepts: ['text'],
      requiresContext: [{ kind: 'editor-pane' }],
      run: () => ({ ok: true }),
    },
    {
      id: 'format-clipboard',
      title: 'Format Clipboard',
      accepts: ['clipboard'],
      requiresContext: [{ kind: 'clipboard' }],
      run: () => ({ ok: true }),
    },
    {
      id: 'translate-selection',
      title: 'Translate Selection',
      accepts: ['text'],
      requiresContext: [{ kind: 'selected-text' }],
      run: () => ({ ok: true }),
    },
  ],
})

const textObject = { id: 'text-1', type: 'text', title: 'Text', source: 'test', text: 'hello' }
const clipboardObject = { id: 'clip-1', type: 'clipboard', title: 'Clipboard', source: 'test', contentType: 'text', preview: 'hello' }
const emptyCtx = { snapshot: { invocation: { source: 'global-hotkey', timestamp: 1 } } }

const noContextTextActions = await registry.getWorkActions(textObject, emptyCtx)
assert.deepEqual(
  plainIds(noContextTextActions),
  ['copy-anywhere'],
  'actions requiring foreground app, editor pane, or selected text must be filtered without matching context',
)

const foregroundActions = await registry.getWorkActions(textObject, {
  snapshot: { ...emptyCtx.snapshot, foreground: { name: 'Mail', bundleId: 'com.apple.mail' } },
})
assert.deepEqual(
  plainIds(foregroundActions),
  ['copy-anywhere', 'paste-to-foreground'],
  'foreground app context must enable only foreground-dependent actions',
)

const editorActions = await registry.getWorkActions(textObject, {
  snapshot: {
    ...emptyCtx.snapshot,
    editor: { windowLabel: 'editor', activePaneId: 'pane-1', paneIds: ['pane-1'], activeText: 'hello', selectedText: '' },
  },
})
assert.deepEqual(
  plainIds(editorActions),
  ['copy-anywhere', 'replace-editor-selection'],
  'editor pane context must enable editor-pane actions without requiring selected text',
)

const editorSelectionActions = await registry.getWorkActions(textObject, {
  snapshot: {
    ...emptyCtx.snapshot,
    editor: { windowLabel: 'editor', activePaneId: 'pane-1', paneIds: ['pane-1'], activeText: 'hello', selectedText: 'hello' },
  },
})
assert.deepEqual(
  plainIds(editorSelectionActions),
  ['copy-anywhere', 'replace-editor-selection', 'translate-selection'],
  'selected editor text must satisfy selected-text requirements',
)

const externalSelectionActions = await registry.getWorkActions(textObject, {
  snapshot: { ...emptyCtx.snapshot, externalSelection: { text: 'hello' } },
})
assert.deepEqual(
  plainIds(externalSelectionActions),
  ['copy-anywhere', 'translate-selection'],
  'external selected text must satisfy selected-text requirements',
)

const clipboardActionsWithoutClipboard = await registry.getWorkActions(clipboardObject, emptyCtx)
assert.deepEqual(
  plainIds(clipboardActionsWithoutClipboard),
  [],
  'clipboard-dependent actions must be filtered when clipboard context is missing',
)

const clipboardActions = await registry.getWorkActions(clipboardObject, {
  snapshot: { ...emptyCtx.snapshot, clipboard: { kind: 'text', text: 'hello' } },
})
assert.deepEqual(
  plainIds(clipboardActions),
  ['format-clipboard'],
  'clipboard context must enable clipboard-dependent actions for clipboard objects',
)

console.log('workflow registry behavior checks passed')
