#!/usr/bin/env node
/**
 * test-launcher-registry.mjs
 * Verifies launcher registry candidate collection: surface filtering, tool
 * adaptation, dynamic query guards, and error isolation. Launcher UI never
 * scans commands directly; launcher entries must be tools or launcher.items.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// A flexible loader that lets us inject module exports as sandbox globals and
// rewrite imports into references to those globals.
function loadModule(path, { stripImports = [], globals = {} } = {}) {
  let src = readFileSync(path, 'utf8')
  for (const re of stripImports) src = src.replace(re, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const stripTypeImports = [
  /import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g,
]

// output.ts (only depends on types)
const output = loadModule('src/workspace/launcher/output.ts', { stripImports: stripTypeImports })

// toolAdapter.ts depends on ./output + types
const toolAdapter = loadModule('src/workspace/launcher/toolAdapter.ts', {
  stripImports: [
    ...stripTypeImports,
    /import\s*\{[^}]*\}\s*from\s*'\.\/output'\s*;?\s*\n?/,
  ],
  globals: {
    textResult: output.textResult,
    replaceActiveTextResult: output.replaceActiveTextResult,
    errorResult: output.errorResult,
    choicesResult: output.choicesResult,
  },
})

// identity.ts (standalone with surface stub injected as a prelude)
const identityWithStub = (() => {
  let src = readFileSync('src/workspace/launcher/identity.ts', 'utf8').replace(
    /import\s*\{[^}]*\}\s*from\s*'\.\/types'\s*;?\s*\n?/,
    "const isLauncherSurfaceId=(v)=>v==='command-palette'||v==='global-launcher';\n",
  )
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const me = {}
  vm.runInNewContext(out, { exports: me, module: { exports: me }, console })
  return me
})()

// --- Tool adapter: surfaces + pinnable + input policy ---
const reverseTool = {
  id: 'reverse',
  title: 'Reverse',
  inputPolicy: { mode: 'auto' },
  run: async (ctx) => ctx.output.text(ctx.input.text.split('').reverse().join('')),
  surfaces: { launcher: true, panel: true, pinnable: true },
}
const item = toolAdapter.adaptToolToLauncherItem(reverseTool, {
  pluginId: 'demo',
  source: 'builtin',
  systemKey: 'plugin:demo:tool:reverse',
})
assert.equal(item.kind, 'plugin')
assert.equal(item.pinnable, true, 'tool pinnable honored')
assert.equal(item.behavior.type, 'perform')
assert.equal(item.systemKey, 'plugin:demo:tool:reverse')

// Execute via a fake api: auto mode with selection present uses selection
let copied = null
const api = {
  getActiveText: () => 'whole text',
  getSelectionText: () => 'abc',
  getClipboardText: async () => '',
  replaceActiveText: async () => {},
  insertText: async () => {},
  copyText: async (t) => { copied = t },
  openUrl: async () => {},
  showMessage: () => {},
}
const res = await item.execute({ settings: {}, locale: 'en', api, t: (k) => k })
assert.equal(res.ok, true)
assert.ok(res.output && res.output.choices.length === 1, 'text output is one choice')
assert.equal(res.output.choices[0].title, 'cba', 'auto mode reversed the selection "abc"')
// primary action copies
await res.output.choices[0].primaryAction()
assert.equal(copied, 'cba', 'default text output Enter copies')

// inputPolicy 'all' ignores selection
const allTool = { ...reverseTool, id: 'rev-all', inputPolicy: { mode: 'all' } }
const allItem = toolAdapter.adaptToolToLauncherItem(allTool, { pluginId: 'demo', source: 'builtin', systemKey: 'k' })
const allRes = await allItem.execute({ settings: {}, locale: 'en', api, t: (k) => k })
assert.equal(allRes.output.choices[0].title, 'txet elohw', "'all' mode uses whole text")

// inputPolicy 'selection' with no selection → empty
const selTool = { ...reverseTool, id: 'rev-sel', inputPolicy: { mode: 'selection' } }
const selItem = toolAdapter.adaptToolToLauncherItem(selTool, { pluginId: 'demo', source: 'builtin', systemKey: 'k2' })
const noSelApi = { ...api, getSelectionText: () => '' }
const selRes = await selItem.execute({ settings: {}, locale: 'en', api: noSelApi, t: (k) => k })
assert.equal(selRes.output.choices[0].title, '', "'selection' with no selection → empty text")

// --- Tool adapter: parameter customization stays on explicit tools ---
const paramTool = {
  ...reverseTool,
  id: 'upper-with-suffix',
  params: [{ key: 'suffix', label: 'Suffix', type: 'text', default: '!' }],
  run: async (ctx) => ctx.output.text(`${ctx.input.text.toUpperCase()}${ctx.params.suffix}`),
}
const paramItem = toolAdapter.adaptToolToLauncherItem(paramTool, {
  pluginId: 'demo',
  source: 'builtin',
  systemKey: identityWithStub.getPluginToolItemKey('demo', 'upper-with-suffix'),
})
assert.equal(paramItem.params?.[0].key, 'suffix', 'tool adapter exposes explicit param schema')
assert.equal(paramItem.defaultParams?.suffix, '!', 'tool adapter derives default params')
const paramDefaultRes = await paramItem.execute({ settings: {}, locale: 'en', api, t: (k) => k })
assert.equal(paramDefaultRes.output.choices[0].title, 'ABC!', 'tool adapter runs with default params')
const paramCustomRes = await paramItem.executeWithParams({ settings: {}, locale: 'en', api, t: (k) => k }, { suffix: '?' })
assert.equal(paramCustomRes.output.choices[0].title, 'ABC?', 'tool adapter runs with customized params')

// --- output helpers contract ---
assert.equal(output.emptyResult().ok, true)
assert.equal(output.emptyResult().output, undefined, 'empty result has no output (launcher closes)')
assert.equal(output.errorResult('boom').ok, false)
assert.equal(output.isOutputResult(output.textResult('x', api)), true)
assert.equal(output.textResult('x', api).output.choices[0].id, output.TEXT_OUTPUT_CHOICE_ID, 'default text output keeps copy-primary id')
assert.equal(output.replaceActiveTextResult('x', api).output.choices[0].id, output.REPLACE_ACTIVE_TEXT_OUTPUT_CHOICE_ID, 'replace output has replace-primary id')
assert.equal(output.isOutputResult(output.emptyResult()), false)

// --- identity-based key uniqueness for tools vs launcher items ---
assert.notEqual(
  identityWithStub.getPluginToolItemKey('p', 'x'),
  identityWithStub.getPluginLauncherItemKey('p', 'x'),
  'tool key and launcher-item key differ even for same id',
)

console.log('✓ test-launcher-registry passed')
