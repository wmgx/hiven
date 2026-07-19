#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')

assert.equal(
  packageJson.scripts?.['test:output-router-behavior'],
  'node scripts/test-output-router-behavior.mjs',
  'package.json must expose test:output-router-behavior',
)
assert.match(
  refactorSuite,
  /test:output-router-behavior/,
  'refactor suite must include output router behavior coverage',
)

function loadOutputRouter(globals = {}) {
  let src = readFileSync('src/workflow/outputRouter.ts', 'utf8')
  src = src.replace(/import\s+type\s*\{[\s\S]*?\}\s*from\s*['"][^'"]*['"]\s*;?\s*\n?/g, '')
  src = src.replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]*['"]\s*;?\s*\n?/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const calls = []
const outputRouter = loadOutputRouter({
  createPluginLauncherApi: () => ({ copyText: async (text) => calls.push(['default.copy', text]) }),
  createPluginPaste: () => ({ pasteText: async (text) => calls.push(['default.paste', text]) }),
  createQuickEditorPane: async (input) => calls.push(['default.createPane', input]),
  showPluginSurfaceWindow: async (target) => calls.push(['default.pluginSurface', target]),
})

const routed = []
const customCtx = {
  copy: async (text) => routed.push(['copy', text]),
  pasteToForegroundApp: async (text) => routed.push(['paste', text]),
  replaceEditorSelection: async (text, options) => routed.push(['replace', text, options]),
  insertIntoEditor: async (text, options) => routed.push(['insert', text, options]),
  openInEditor: async (text, options) => routed.push(['open-editor', text, options]),
  openPluginSurface: async (text, options) => routed.push(['plugin-surface', text, options]),
  attachEditorPanel: async (text, options) => routed.push(['attach-panel', text, options]),
  saveToShelf: async (text) => routed.push(['shelf', text]),
}

const targets = [
  { kind: 'copy' },
  { kind: 'paste-to-foreground-app' },
  { kind: 'replace-editor-selection', paneId: 'pane-1', range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 } },
  { kind: 'insert-into-editor', paneId: 'pane-2' },
  { kind: 'open-in-editor', title: 'Draft', language: 'markdown' },
  { kind: 'open-plugin-surface', source: 'builtin', pluginId: 'translate', surfaceId: 'main', initialText: 'provided' },
  { kind: 'attach-editor-panel', panelId: 'plugin-surface', placement: 'right', paneId: 'pane-1', pluginSurfaceTarget: { source: 'builtin', pluginId: 'json', surfaceId: 'main' } },
  { kind: 'save-to-shelf' },
]

for (const target of targets) {
  const result = await outputRouter.routeTextOutput('hello', target, customCtx)
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: true, text: 'hello', outputTarget: target }, `routeTextOutput must return a successful ActionResult for ${target.kind}`)
}
assert.deepEqual(JSON.parse(JSON.stringify(routed)), [
  ['copy', 'hello'],
  ['paste', 'hello'],
  ['replace', 'hello', targets[2]],
  ['insert', 'hello', targets[3]],
  ['open-editor', 'hello', targets[4]],
  ['plugin-surface', 'hello', targets[5]],
  ['attach-panel', 'hello', targets[6]],
  ['shelf', 'hello'],
], 'routeTextOutput must dispatch every OutputTarget kind to the matching context method with target options')

const defaultCtx = outputRouter.createDefaultOutputRouterContext()
await defaultCtx.copy('copied')
await defaultCtx.pasteToForegroundApp('pasted')
await defaultCtx.replaceEditorSelection('replacement', targets[2])
await defaultCtx.insertIntoEditor('inserted', targets[3])
await defaultCtx.openInEditor('draft', targets[4])
await defaultCtx.openPluginSurface('surface text', { kind: 'open-plugin-surface', pluginId: 'json', surfaceId: 'main' })
await defaultCtx.openPluginSurface('surface text', { kind: 'open-plugin-surface', source: 'dev', pluginId: 'translate', surfaceId: 'main', initialText: 'explicit initial' })
await defaultCtx.attachEditorPanel('panel text', targets[6])
await defaultCtx.saveToShelf('shelf text')

assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
  ['default.copy', 'copied'],
  ['default.paste', 'pasted'],
  ['default.createPane', { text: 'replacement' }],
  ['default.createPane', { text: 'inserted' }],
  ['default.createPane', { text: 'draft', language: 'markdown' }],
  ['default.pluginSurface', { source: 'builtin', pluginId: 'json', surfaceId: 'main', initialText: 'surface text' }],
  ['default.pluginSurface', { source: 'dev', pluginId: 'translate', surfaceId: 'main', initialText: 'explicit initial' }],
  ['default.pluginSurface', { source: 'builtin', pluginId: 'json', surfaceId: 'main', initialText: 'panel text' }],
  ['default.createPane', { text: 'shelf text' }],
], 'createDefaultOutputRouterContext must route through host clipboard, paste, editor bridge, plugin window manager, and output shelf panel')

console.log('output router behavior checks passed')
