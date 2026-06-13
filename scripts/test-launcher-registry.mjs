#!/usr/bin/env node
/**
 * test-launcher-registry.mjs
 * Verifies launcher registry candidate collection: surface filtering, tool
 * adaptation, command adaptation, dynamic query guards, and error isolation.
 * Launcher UI never scans commands directly; safe text commands enter through
 * the registry-owned command adapter.
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

// pluginCommandRunner.ts (standalone after type imports are stripped)
const pluginCommandRunner = loadModule('src/workspace/pluginCommandRunner.ts', {
  stripImports: stripTypeImports,
})

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

// commandAdapter.ts depends on pluginCommandRunner + ./output + types
const commandAdapter = loadModule('src/workspace/launcher/commandAdapter.ts', {
  stripImports: [
    ...stripTypeImports,
    /import\s*\{[^}]*\}\s*from\s*'\.\.\/pluginCommandRunner'\s*;?\s*\n?/,
    /import\s*\{[^}]*\}\s*from\s*'\.\/output'\s*;?\s*\n?/,
  ],
  globals: {
    defaultPluginCommandParams: pluginCommandRunner.defaultPluginCommandParams,
    runTextPluginCommand: pluginCommandRunner.runTextPluginCommand,
    errorResult: output.errorResult,
    replaceActiveTextResult: output.replaceActiveTextResult,
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

// --- Command adapter: safe text commands only, Enter replaces active text ---
const textCommand = {
  id: 'demo.upper',
  title: 'Uppercase',
  description: 'Uppercase text',
  icon: 'CaseUpper',
  aliases: ['caps'],
  inputs: [{ key: 'input', label: 'Input', kind: 'text', required: true }],
  params: [{ key: 'suffix', label: 'Suffix', type: 'text', default: '!' }],
  run(ctx) {
    const input = ctx.inputs.input
    return { output: { kind: 'text', text: `${input.text.toUpperCase()}${ctx.params.suffix}` } }
  },
}
assert.equal(commandAdapter.canAdaptCommandToLauncher(textCommand), true, 'text command with default params is adaptable')
const commandItem = commandAdapter.adaptCommandToLauncherItem(textCommand, {
  pluginId: 'demo',
  source: 'builtin',
  systemKey: identityWithStub.getPluginCommandAdapterItemKey('demo', 'demo.upper'),
})
assert.equal(commandItem.systemKey, 'plugin:demo:command:demo.upper', 'command adapter uses host-generated command key')
assert.equal(commandItem.legacyUsageKeys?.join(','), 'demo.upper', 'command adapter preserves old command usage key')
let replaced = null
let commandCopied = null
const commandApi = {
  ...api,
  getActiveText: () => 'whole',
  getSelectionText: () => 'abc',
  replaceActiveText: async (t) => { replaced = t },
  copyText: async (t) => { commandCopied = t },
}
const commandRes = await commandItem.execute({ settings: {}, locale: 'en', api: commandApi, t: (k) => k })
assert.equal(commandRes.ok, true)
assert.equal(commandRes.output.choices[0].title, 'ABC!', 'command adapter uses selection before whole text')
await commandRes.output.choices[0].primaryAction()
assert.equal(replaced, 'ABC!', 'command adapter primary action replaces active text')
assert.equal(commandCopied, null, 'command adapter primary action should not copy by default')

assert.equal(
  commandAdapter.canAdaptCommandToLauncher({
    ...textCommand,
    id: 'demo.pane',
    inputs: [{ key: 'source', label: 'Source', kind: 'pane', required: true }],
  }),
  false,
  'pane commands are skipped',
)
assert.equal(
  commandAdapter.canAdaptCommandToLauncher({
    ...textCommand,
    id: 'demo.missing-default',
    params: [{ key: 'mode', label: 'Mode', type: 'single-select', options: ['a', 'b'], required: true }],
  }),
  false,
  'commands with params lacking defaults are skipped',
)
assert.equal(
  commandAdapter.canAdaptCommandToLauncher({
    id: 'demo.panel',
    title: 'Open Panel',
    live: { pinnable: false },
    run() { return { effects: [{ type: 'panel.openV2', panelId: 'demo.panel' }] } },
  }),
  false,
  'workspace/panel-style commands that opt out of pinning are skipped',
)

// --- output helpers contract ---
assert.equal(output.emptyResult().ok, true)
assert.equal(output.emptyResult().output, undefined, 'empty result has no output (launcher closes)')
assert.equal(output.errorResult('boom').ok, false)
assert.equal(output.isOutputResult(output.textResult('x', api)), true)
assert.equal(output.isOutputResult(output.emptyResult()), false)

// --- identity-based key uniqueness for tools vs launcher items ---
assert.notEqual(
  identityWithStub.getPluginToolItemKey('p', 'x'),
  identityWithStub.getPluginLauncherItemKey('p', 'x'),
  'tool key and launcher-item key differ even for same id',
)
assert.notEqual(
  identityWithStub.getPluginCommandAdapterItemKey('p', 'x'),
  identityWithStub.getPluginToolItemKey('p', 'x'),
  'command adapter key and tool key differ even for same id',
)

console.log('✓ test-launcher-registry passed')
