#!/usr/bin/env node
/** Important metadata invariants, using real store/factory/controller and synthetic I/O. */
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

const storageKey = 'hiven:saved-actions:v1'
const persisted = new Map()
let fault = null
let writes = 0
let reads = 0
let notifications = 0
let uuidCalls = 0
const readFailures = ['unavailable', 'read', 'malformed-json', 'invalid-shape']
const storageFailures = [...readFailures, 'write', 'discard-write', 'readback', 'mismatched-readback', 'lost-before-write']
const storage = {
  getItem(key) {
    reads += 1
    if (fault === 'read' || (fault === 'readback' && writes > 0)) throw new Error('Synthetic read failure')
    if (fault === 'malformed-json') return '{'
    if (fault === 'invalid-shape') return '{}'
    if (fault === 'mismatched-readback' && writes > 0) return '[]'
    return persisted.get(key) ?? null
  },
  setItem(key, value) {
    writes += 1
    if (fault === 'write') throw new Error('Synthetic write failure')
    if (fault !== 'discard-write') persisted.set(key, value)
  },
}
const fakeWindow = {
  get localStorage() {
    if (fault === 'unavailable' || (fault === 'lost-before-write' && reads > 0)) throw new Error('Synthetic unavailable storage')
    return storage
  },
}
const store = loadModule('src/workspace/savedActions/store.ts', {}, {
  window: fakeWindow, crypto: { randomUUID: () => { uuidCalls += 1; return `synthetic-${uuidCalls}` } },
})
store.subscribeSavedActions(() => { notifications += 1 })
const fixture = {
  schemaVersion: 1, id: 'artifact_rename-a', name: 'Original tool', aliases: ['join alias', 'keep | alias'],
  baseActionKey: 'plugin:synthetic:tool:join', savedParams: { separator: ' | ', trim: true, limit: 3, modes: ['a', 'b'] },
  inputBinding: 'selection', outputIntent: 'copy', contractFingerprint: 'v1:0123456789abcdef',
  actionPolicy: { effect: 'pure', learnable: true }, createdAt: 100, lastInvokedAt: 200,
  disabledReason: 'missing-action',
}
const twin = { ...clone(fixture), id: 'artifact_rename-b', savedParams: { separator: ',' }, createdAt: 101 }
const pinKey = 'synthetic:launcher-favorites'
const usageKey = 'synthetic:launcher-usage'
const pinBytes = JSON.stringify([`host:saved-action:${fixture.id}`])
const usageBytes = JSON.stringify({ [fixture.id]: { count: 7, lastSelectedAt: 123 } })
function seed(actions = [fixture, twin]) {
  fault = null
  writes = reads = notifications = 0
  persisted.clear()
  persisted.set(storageKey, JSON.stringify(actions))
  persisted.set(pinKey, pinBytes)
  persisted.set(usageKey, usageBytes)
}
function assertUnrelatedStorage() {
  assert.equal(persisted.get(pinKey), pinBytes, 'pins remain byte-for-byte unchanged')
  assert.equal(persisted.get(usageKey), usageBytes, 'usage remains byte-for-byte unchanged')
  assert.equal(uuidCalls, 0, 'renaming never creates a replacement artifact')
}

seed()
const renamed = store.renameSavedAction(twin.id, '  Name | ordinary characters  ', twin.name)
assert.equal(renamed.status, 'renamed')
assert.deepEqual(clone(store.listSavedActions()), [fixture, { ...twin, name: 'Name | ordinary characters' }])
assert.equal(writes, 1)
assert.equal(notifications, 1)
assertUnrelatedStorage()

for (const name of ['', '   \n\t', 'x'.repeat(81)]) {
  seed()
  assert.equal(store.renameSavedAction(fixture.id, name, fixture.name).status, 'invalid-name')
  assert.equal(writes, 0)
  assert.equal(notifications, 0)
  assert.deepEqual(clone(store.listSavedActions()), [fixture, twin])
}
seed()
assert.equal(store.renameSavedAction(fixture.id, ` ${'x'.repeat(80)} `, fixture.name).status, 'renamed')
assert.equal(store.listSavedActions()[0].name.length, 80)
seed()
assert.equal(store.renameSavedAction('artifact_missing', 'New name', fixture.name).status, 'missing')
assert.equal(store.renameSavedAction(fixture.id, 'New name', 'Outdated name').status, 'changed')
assert.equal(writes, 0)
assert.equal(store.renameSavedAction(fixture.id, ` ${fixture.name} `, fixture.name).status, 'renamed')
assert.equal(writes, 0, 'an unchanged name is a harmless no-op')

seed()
store.touchSavedAction(fixture.id)
store.setSavedActionDisabledReason(fixture.id, 'contract-changed')
const touched = clone(store.listSavedActions()[0])
store.renameSavedAction(fixture.id, 'After another update', fixture.name)
assert.deepEqual(clone(store.listSavedActions()[0]), { ...touched, name: 'After another update' })

for (const failure of storageFailures) {
  seed()
  fault = failure
  assert.throws(() => store.renameSavedAction(fixture.id, 'Must not report success', fixture.name),
    `${failure} must fail explicitly instead of reporting success or deletion`)
  assert.equal(notifications, 0, `${failure} must not publish a successful refresh`)
  assertUnrelatedStorage()
}
for (const failure of readFailures) {
  seed()
  fault = failure
  assert.throws(() => store.getSavedActionForRename(fixture.id), `${failure} is a read error during edit preparation`)
  assert.deepEqual(clone(store.listSavedActions()), [], 'ordinary list discovery keeps its existing tolerant behavior')
  assert.equal(store.deleteSavedAction(fixture.id), undefined, 'delete behavior remains unchanged')
  assert.equal(writes, 0)
}

const counters = { materialReads: 0, copies: 0, writes: 0, usage: 0, journal: 0, events: 0, lastRun: 0, touches: 0, closes: 0 }
const translate = (_locale, _namespace, key) => key
const lastRunModule = loadModule('src/workspace/savedActions/lastSaveableRun.ts', {}, { window: {} })
const lastRun = {
  status: 'ready', runId: 'run_synthetic', actionKey: fixture.baseActionKey,
  savedParams: { separator: ',' }, inputBinding: 'selection', outputIntent: 'copy',
  contractFingerprint: fixture.contractFingerprint, actionPolicy: fixture.actionPolicy, completedAt: Date.now(),
}
lastRunModule.setLastSaveableRun(lastRun)
const monitoredLastRun = {
  ...lastRunModule,
  setLastSaveableRun: (value) => { counters.lastRun += 1; lastRunModule.setLastSaveableRun(value) },
}
const host = loadModule('src/workspace/launcher/hostActions.ts', {
  '../launcherHostSurfaceBridge': {}, '../../store': {}, './hostEditorActions': {},
  '../windowManager/quickEditorWindow': {}, '../launcherBlurGuard': {}, '../experience/journal': {},
  '../savedActions/lastSaveableRun': monitoredLastRun, '../savedActions/store': store,
  '../savedActions/events': { recordSavedActionEvent: () => { counters.events += 1 } },
  '../savedActions/compatibility': {}, '../savedActions/display': {}, '../../i18n': { translate },
})
const output = loadModule('src/workspace/launcher/output.ts', {
  './types': { normalizeLauncherSurfaceId: (value) => value }, '../../i18n': { translate },
})
let nextId = 0
const controllerModule = loadModule('src/workspace/launcher/controller.ts', {
  './pluginLifetime': loadModule('src/workspace/launcher/pluginLifetime.ts'),
  '../usageJournal': { appendUsageJournal: async () => { counters.journal += 1 } },
  './output': output, './foregroundSelectionCapture': {}, '../../i18n': { translate },
  '../telemetry': {
    TelemetryEvents: new Proxy({}, { get: (_target, prop) => String(prop) }),
    itemTelemetryProps: () => ({}), trackBehavior: () => {}, trackLatencyFrom: () => {}, telemetryNow: () => 0,
  },
  '../experience/journal': {
    appendExperienceEvent: () => { counters.events += 1 }, currentExperienceSessionId: (fallback) => fallback,
    newExperienceId: (prefix) => `${prefix}_rename-${++nextId}`,
  },
  '../experience/errorType': loadModule('src/workspace/experience/errorType.ts'),
  '../experience/saveableParams': loadModule('src/workspace/experience/saveableParams.ts'),
  '../experience/miningFingerprint': {},
  '../savedActions/lastSaveableRun': monitoredLastRun,
  '../savedActions/store': { touchSavedAction: () => { counters.touches += 1 } },
  '../contentBoundary': loadModule('src/workspace/contentBoundary.ts'),
})
const api = {
  getSelectionText: () => { counters.materialReads += 1; return 'SYNTHETIC_SELECTION_MATERIAL' },
  getActiveText: () => { counters.materialReads += 1; return 'SYNTHETIC_ACTIVE_MATERIAL' },
  copyText: async () => { counters.copies += 1 },
  insertText: async () => { counters.writes += 1 }, replaceActiveText: async () => { counters.writes += 1 },
}
function makeController() {
  const context = { query: fixture.name, returns: 0 }
  const controller = new controllerModule.LauncherController({
    surfaceId: 'global-launcher', api, locale: 'en', makeT: () => (key) => key,
    getSettings: () => ({}), recordSelection: () => { counters.usage += 1 },
    requestClose: () => { counters.closes += 1 }, onChange: () => {},
    appendExperienceEvent: () => { counters.events += 1 },
    onReturnToRoot: () => { context.returns += 1; context.query = '' },
  })
  return { controller, context }
}
const frame = (controller) => controller.getState().frames.at(-1)
const root = (controller) => assert.equal(frame(controller).kind, 'list')
async function start(controller, id = fixture.id) {
  await controller.selectItem(host.createRenameSavedActionItem(id), { objectBlockText: 'SYNTHETIC_ATTACHED_MATERIAL' })
  assert.equal(frame(controller).kind, 'collect-input')
  assert.equal(frame(controller).inputText, '', 'attached material is never used as the new name')
  assert.equal(writes, 0, 'opening the naming step never mutates storage')
}

seed()
assert.equal((await host.createRenameSavedActionItem(fixture.id).execute({ locale: 'en', input: { text: 'Bypass' } })).ok, false)
assert.equal(writes, 0, 'unprepared execution fails closed')
const successful = makeController()
await start(successful.controller)
successful.controller.setInputText('  New | name  ')
await successful.controller.submitInput()
root(successful.controller)
assert.equal(successful.controller.getState().error, null)
assert.equal(successful.context.returns, 1)
assert.equal(successful.context.query, '', 'successful metadata input returns to unfiltered search')
assert.deepEqual(clone(store.listSavedActions()), [{ ...fixture, name: 'New | name' }, twin])
assertUnrelatedStorage()

for (const cancel of ['back', 'exitCommand', 'reset']) {
  seed()
  const { controller, context } = makeController()
  await start(controller)
  controller.setInputText('Discard this draft')
  const staleFrame = frame(controller)
  controller[cancel]()
  await controller.submitInput(staleFrame)
  root(controller)
  assert.equal(writes, 0)
  assert.equal(context.query, fixture.name)
  assert.equal(context.returns, 0)
}
for (const name of ['  ', 'x'.repeat(81)]) {
  seed()
  const { controller, context } = makeController()
  await start(controller)
  controller.setInputText(name)
  await controller.submitInput()
  assert.ok(controller.getState().error)
  assert.equal(frame(controller).inputText, name, 'invalid names remain editable')
  assert.equal(writes, 0)
  assert.equal(context.returns, 0)
}
for (const failure of readFailures) {
  seed()
  const { controller, context } = makeController()
  fault = failure
  await controller.selectItem(host.createRenameSavedActionItem(fixture.id))
  root(controller)
  assert.equal(controller.getState().error, 'savedActionRenameReadFailed', `${failure} must not falsely claim deletion`)
  assert.equal(controller.getState().busy, false)
  assert.equal(context.query, fixture.name)
  assert.equal(context.returns, 0)
  assert.equal(writes, 0)
  fault = null
  await start(controller)
  controller.back()
}
for (const failure of storageFailures) {
  seed()
  const { controller, context } = makeController()
  await start(controller)
  controller.setInputText('Keep failure draft')
  reads = 0
  fault = failure
  await controller.submitInput()
  assert.equal(controller.getState().error, 'savedActionRenameFailed', `${failure} is a persistence failure, not a deletion`)
  assert.equal(frame(controller).inputText, 'Keep failure draft')
  assert.equal(controller.getState().busy, false)
  assert.equal(context.query, fixture.name)
  assert.equal(context.returns, 0)
}

seed()
const retry = makeController()
await start(retry.controller)
retry.controller.setInputText('Retry name')
fault = 'write'
await retry.controller.submitInput()
fault = null
await retry.controller.submitInput()
root(retry.controller)
assert.equal(store.listSavedActions()[0].name, 'Retry name')
assert.equal(retry.context.returns, 1)

seed()
const pending = makeController()
await start(pending.controller)
store.renameSavedAction(fixture.id, 'Changed in another window', fixture.name)
pending.controller.setInputText('Must not overwrite')
await pending.controller.submitInput()
assert.equal(pending.controller.getState().error, 'savedActionRenameChanged')
assert.equal(store.listSavedActions()[0].name, 'Changed in another window')
assert.equal(frame(pending.controller).inputText, 'Must not overwrite')
assert.equal(writes, 1)

seed()
const concurrentMetadata = makeController()
await start(concurrentMetadata.controller)
store.touchSavedAction(fixture.id)
store.setSavedActionDisabledReason(fixture.id, 'policy-changed')
const latest = clone(store.listSavedActions()[0])
concurrentMetadata.controller.setInputText('Preserved concurrent metadata')
await concurrentMetadata.controller.submitInput()
assert.deepEqual(clone(store.listSavedActions()[0]), { ...latest, name: 'Preserved concurrent metadata' })

seed()
const removed = makeController()
await start(removed.controller)
store.deleteSavedAction(fixture.id)
removed.controller.setInputText('Must not recreate')
await removed.controller.submitInput()
assert.equal(removed.controller.getState().error, 'savedActionRenameMissing')
assert.deepEqual(clone(store.listSavedActions()), [twin])
assert.equal(writes, 1)
const absent = makeController()
await absent.controller.selectItem(host.createRenameSavedActionItem(fixture.id))
root(absent.controller)
assert.equal(absent.controller.getState().error, 'savedActionRenameMissing')

assert.deepEqual(await lastRunModule.getLastSaveableRun(), lastRun)
assert.deepEqual(counters, { materialReads: 0, copies: 0, writes: 0, usage: 0, journal: 0, events: 0, lastRun: 0, touches: 0, closes: 0 })
assertUnrelatedStorage()
console.log('saved-action rename: identity, validation, persistence, concurrency, metadata isolation, navigation, and retry checks passed')
