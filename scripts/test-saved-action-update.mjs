#!/usr/bin/env node
/** Important deletion invariants, using real store/factory/controller and synthetic I/O. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const clone = (value) => JSON.parse(JSON.stringify(value))
function loadModule(path, modules = {}, globals = {}) {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const exports = {}
  const sandbox = {
    exports, module: { exports }, console, setTimeout, clearTimeout, Date, Math,
    Promise, Error, DOMException, structuredClone,
    require: (specifier) => {
      assert.ok(Object.hasOwn(modules, specifier), `Unmocked dependency: ${path} -> ${specifier}`)
      return modules[specifier]
    },
    ...globals,
  }
  vm.runInNewContext(output, sandbox, { filename: path })
  return sandbox.module.exports
}


const persisted = new Map()
const storage = { getItem: (key) => persisted.get(key) ?? null, setItem: (key, value) => persisted.set(key, value) }
const store = loadModule('src/workspace/savedActions/store.ts', {}, { window: { localStorage: storage }, crypto: { randomUUID: () => 'new-id' } })
const original = { schemaVersion: 1, id: 'original', name: 'Format', aliases: ['fmt'], baseActionKey: 'synthetic:format', savedParams: { indent: 2 }, inputBinding: 'prompt', outputIntent: 'copy', contractFingerprint: 'v1', actionPolicy: { effect: 'pure', learnable: true }, createdAt: 100, lastInvokedAt: 200 }
const seed = (actions = [original]) => persisted.set('hiven:saved-actions:v1', JSON.stringify(actions))
const snapshot = store.savedActionSnapshot(original)
const run = { status: 'ready', runId: 'done', actionKey: original.baseActionKey, savedParams: { indent: 4 }, inputBinding: 'prompt', outputIntent: 'return-to-launcher', contractFingerprint: 'v1', actionPolicy: original.actionPolicy, completedAt: Date.now(), sourceSavedAction: { id: original.id, snapshot } }
seed()
const result = store.updateSavedActionIfUnchanged(original.id, snapshot, run)
assert.equal(result.status, 'updated')
for (const key of ['id', 'name', 'aliases', 'createdAt', 'lastInvokedAt']) assert.deepEqual(clone(result.action[key]), clone(original[key]))
assert.deepEqual(clone(result.action.savedParams), { indent: 4 })
assert.equal(result.action.outputIntent, 'return-to-launcher')
assert.ok(result.action.updatedAt > original.createdAt)
assert.equal(store.updateSavedActionIfUnchanged(original.id, snapshot, run).status, 'changed')
seed([])
assert.equal(store.updateSavedActionIfUnchanged(original.id, snapshot, run).status, 'missing')
seed([{ ...original, name: 'Renamed' }])
assert.equal(store.updateSavedActionIfUnchanged(original.id, snapshot, run).status, 'changed')
seed([{ ...original, lastInvokedAt: 300 }])
assert.equal(store.updateSavedActionIfUnchanged(original.id, snapshot, run).action.lastInvokedAt, 300)
for (const change of [{ inputBinding: 'selection' }, { sourceSavedAction: undefined }, { actionPolicy: { effect: 'network', learnable: true } }, { contractFingerprint: 'v2' }, { outputIntent: 'replace' }]) {
  seed()
  assert.equal(store.updateSavedActionIfUnchanged(original.id, snapshot, { ...run, ...change }).status, 'invalid')
  assert.deepEqual(clone(store.listSavedActions()), [original])
}
seed()
assert.equal(store.updateSavedActionIfUnchanged(original.id, snapshot, { ...run, savedParams: original.savedParams, outputIntent: original.outputIntent }).status, 'unchanged')
assert.equal(store.listSavedActions()[0].updatedAt, undefined)

const i18n = loadModule('src/i18n/registry.ts')
i18n.registerMessages('palette', loadModule('src/i18n/locales/palette.ts').default)
const saveable = loadModule('src/workspace/experience/saveableParams.ts')
const compatibility = loadModule('src/workspace/savedActions/compatibility.ts', { '../experience/saveableParams.ts': saveable })
const display = loadModule('src/workspace/savedActions/display.ts', { '../../i18n': i18n, '../launcher/display': loadModule('src/workspace/launcher/display.ts'), './compatibility': compatibility })
const host = loadModule('src/workspace/launcher/hostActions.ts', {
  '../quickEditor/quickEditorStore': {}, '../launcherHostSurfaceBridge': {}, '../../store': {}, './hostEditorActions': {}, '../windowManager/quickEditorWindow': {}, '../launcherBlurGuard': {},
  '../savedActions/lastSaveableRun': {}, '../savedActions/store': store, '../savedActions/compatibility': compatibility, '../savedActions/display': display, '../../i18n': i18n,
})
let base = { systemKey: original.baseActionKey, display: { title: 'Format' }, executionMode: 'explicit-text-preview', actionPolicy: original.actionPolicy, contractFingerprint: original.contractFingerprint, params: [{ key: 'indent', label: 'Indent', type: 'number', saveable: true }] }
const ctx = { locale: 'en', inputText: '' }
const prepare = () => host.createSaveLastRunItem({ run, resolveBaseItems: () => base ? [base] : [] }).prepare(ctx)
seed()
let item = await prepare()
let suggestions = await item.suggest(ctx)
assert.equal(suggestions.choices.length, 1)
assert.match(suggestions.choices[0].subtitle, /2.*4/)
let confirm = await suggestions.choices[0].primaryAction()
assert.equal(confirm.output.choices.length, 2)
await confirm.output.choices[1].primaryAction()
assert.equal(store.listSavedActions()[0].savedParams.indent, 2, 'cancel preserves original')
seed([{ ...original, savedParams: { indent: 8 } }])
assert.equal((await confirm.output.choices[0].primaryAction()).ok, false)
assert.equal(store.listSavedActions()[0].savedParams.indent, 8, 'late confirmation cannot overwrite edits')
seed()
base = { ...base, contractFingerprint: 'v2' }
assert.equal((await confirm.output.choices[0].primaryAction()).ok, false, 'current contract is re-resolved')
base = { ...base, contractFingerprint: 'v1' }
assert.equal((await confirm.output.choices[0].primaryAction()).ok, true)
seed()
item = await prepare()
assert.equal((await item.suggest({ ...ctx, inputText: 'Separate' })).choices.length, 0)
assert.equal((await item.execute({ ...ctx, input: { text: 'Separate | separate-alias' } })).ok, true)
assert.equal(store.listSavedActions().length, 2)
assert.equal(store.listSavedActions()[0].savedParams.indent, 2)
assert.equal(store.listSavedActions()[1].sourceSavedAction, undefined)
console.log('saved action update snapshot, scope, confirmation, current contract and save-as checks passed')
