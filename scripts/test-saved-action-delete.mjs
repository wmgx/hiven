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
  schemaVersion: 1, id: 'artifact_delete-a', name: 'Same saved tool', aliases: ['join alias', 'keep | alias'],
  baseActionKey: 'plugin:synthetic:tool:join', savedParams: { separator: ' | ', trim: true, limit: 3, modes: ['a', 'b'] },
  inputBinding: 'selection', outputIntent: 'copy', contractFingerprint: 'v1:0123456789abcdef',
  actionPolicy: { effect: 'pure', learnable: true }, createdAt: 100, lastInvokedAt: 200,
  disabledReason: 'missing-action',
}
const twin = { ...clone(fixture), id: 'artifact_delete-b', savedParams: { separator: ',', trim: false, limit: 9, modes: ['b'] }, outputIntent: 'return-to-launcher', createdAt: 101 }
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
  assert.equal(uuidCalls, 0, 'deleting never creates a replacement artifact')
}

const counters = { materialReads: 0, copies: 0, writes: 0, usage: 0, journal: 0, events: 0, lastRun: 0, touches: 0, closes: 0, executes: 0 }
const i18n = loadModule('src/i18n/registry.ts')
i18n.registerMessages('palette', loadModule('src/i18n/locales/palette.ts').default)
const { translate } = i18n
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
const saveable = loadModule('src/workspace/experience/saveableParams.ts')
const compatibility = loadModule('src/workspace/savedActions/compatibility.ts', { '../experience/saveableParams.ts': saveable })
const display = loadModule('src/workspace/savedActions/display.ts', {
  '../../i18n': i18n,
  '../launcher/display': loadModule('src/workspace/launcher/display.ts'),
  './compatibility': compatibility,
})
const output = loadModule('src/workspace/launcher/output.ts', {
  './types': { normalizeLauncherSurfaceId: (value) => value }, '../../i18n': i18n,
})
const provider = loadModule('src/workspace/savedActions/provider.ts', {
  '../launcher/output': output, './compatibility': compatibility, './store': store, './display': display,
})
const host = loadModule('src/workspace/launcher/hostActions.ts', {
  '../launcherHostSurfaceBridge': {}, '../../store': {}, './hostEditorActions': {},
  '../windowManager/quickEditorWindow': {}, '../launcherBlurGuard': {}, '../experience/journal': {},
  '../savedActions/lastSaveableRun': monitoredLastRun, '../savedActions/store': store,
  '../savedActions/events': { recordSavedActionEvent: () => { counters.events += 1 } },
  '../savedActions/compatibility': compatibility, '../savedActions/display': display, '../../i18n': i18n,
})
let nextId = 0
const controllerModule = loadModule('src/workspace/launcher/controller.ts', {
  './pluginLifetime': loadModule('src/workspace/launcher/pluginLifetime.ts'),
  '../usageJournal': { appendUsageJournal: async () => { counters.journal += 1 } },
  './output': output, './foregroundSelectionCapture': {}, '../../i18n': i18n,
  '../telemetry': {
    TelemetryEvents: new Proxy({}, { get: (_target, prop) => String(prop) }),
    itemTelemetryProps: () => ({}), trackBehavior: () => {}, trackLatencyFrom: () => {}, telemetryNow: () => 0,
  },
  '../experience/journal': {
    appendExperienceEvent: () => { counters.events += 1 }, currentExperienceSessionId: (fallback) => fallback,
    newExperienceId: (prefix) => `${prefix}_delete-${++nextId}`,
  },
  '../experience/errorType': loadModule('src/workspace/experience/errorType.ts'),
  '../experience/saveableParams': saveable,
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
const baseAction = {
  systemKey: fixture.baseActionKey, kind: 'tool', pluginId: 'synthetic', pluginLifetime: { active: true },
  display: { title: 'Join lines', titleI18n: { zh: '合并行' } },
  behavior: { type: 'perform' }, contractFingerprint: fixture.contractFingerprint, actionPolicy: fixture.actionPolicy,
  params: [
    { key: 'separator', label: 'Separator', labelI18n: { zh: '分隔符' }, type: 'text', saveable: true, saveableMaxLength: 256 },
    { key: 'trim', label: 'Trim', labelI18n: { zh: '去空格' }, type: 'boolean', saveable: true },
    { key: 'limit', label: 'Limit', labelI18n: { zh: '数量' }, type: 'number', saveable: true },
    { key: 'modes', label: 'Modes', labelI18n: { zh: '模式' }, type: 'multi-select', saveable: true, options: ['a', 'b'] },
  ],
  execute: async () => { counters.executes += 1; return { ok: true } },
}
const project = (artifact = fixture, base = baseAction) => provider.projectSavedAction(artifact, base)
function makeController(locale = 'en') {
  const context = { query: fixture.name, material: 'SYNTHETIC_ATTACHED_MATERIAL', returns: 0 }
  const controller = new controllerModule.LauncherController({
    surfaceId: 'global-launcher', api, locale, makeT: () => (key) => key,
    getSettings: () => ({}), recordSelection: () => { counters.usage += 1 },
    requestClose: () => { counters.closes += 1 }, onChange: () => {},
    appendExperienceEvent: () => { counters.events += 1 },
    onReturnToRoot: () => { context.returns += 1; context.query = ''; context.material = '' },
  })
  return { controller, context, locale }
}
const frame = (controller) => controller.getState().frames.at(-1)
const root = (controller) => assert.equal(frame(controller).kind, 'list')
function intactContext(context) {
  assert.equal(context.query, fixture.name)
  assert.equal(context.material, 'SYNTHETIC_ATTACHED_MATERIAL')
  assert.equal(context.returns, 0, 'management does not clear the current search or material')
}
function errorIs(test, key) {
  assert.equal(test.controller.getState().error, translate(test.locale, 'palette', key))
  assert.equal(test.controller.getState().busy, false)
  intactContext(test.context)
}
async function start(test, item = project()) {
  await test.controller.selectItem(host.createDeleteSavedActionItem(item), { objectBlockText: test.context.material })
  const current = frame(test.controller)
  assert.equal(current.kind, 'result')
  assert.equal(current.output.choices.length, 2, 'opening delete must never trigger the single-choice auto-apply path')
  assert.equal(current.output.choices[0].tone, 'danger')
  assert.equal(current.output.choices[1].tone, 'muted')
  assert.equal(writes, 0, 'opening confirmation never mutates storage')
  assert.equal(notifications, 0)
  assertUnrelatedStorage()
  intactContext(test.context)
  return current.output.choices
}
const snapshot = store.savedActionSnapshot(fixture)
seed()
assert.equal((await host.createDeleteSavedActionItem(project()).execute({ locale: 'en' })).ok, false)
assert.equal(writes, 0, 'unprepared direct execution fails closed')
assert.equal(store.getSavedActionForDelete(fixture.id, snapshot).status, 'ready')
assert.equal(store.getSavedActionForDelete(fixture.id, '').status, 'changed')
assert.equal(store.getSavedActionForDelete('artifact_missing', snapshot).status, 'missing')
const reordered = { ...fixture, savedParams: Object.fromEntries(Object.entries(fixture.savedParams).reverse()) }
assert.equal(store.savedActionSnapshot(reordered), snapshot, 'parameter map ordering is not an edit')
const mutable = clone(fixture)
const immutableRow = project(mutable)
mutable.aliases.push('another alias')
mutable.savedParams.modes.push('other mode')
mutable.actionPolicy.learnable = false
assert.equal(immutableRow.savedActionSnapshot, snapshot, 'row snapshot never follows mutable array or policy references')

for (const locale of ['en', 'zh']) {
  seed()
  const test = makeController(locale)
  const row = project(twin)
  const choices = await start(test, row)
  assert.equal(choices[0].subtitle, row.display.subtitle)
  assert.equal(choices[0].subtitleI18n.zh, row.display.subtitleI18n.zh)
  assert.match(choices[0].subtitle, /Join lines.*Trim: No.*Limit: 9/)
  assert.match(choices[0].subtitleI18n.zh, /合并行.*数量: 9/)
  assert.notEqual(choices[0].subtitle, project().display.subtitle, 'same-name actions keep their existing output/tool/parameter summary')
  assert.notEqual(translate(locale, 'palette', 'savedActionDelete'), 'savedActionDelete')
  await test.controller.activateChoice(choices[0])
  root(test.controller)
  assert.deepEqual(clone(store.listSavedActions()), [fixture], 'delete only the selected same-name artifact')
  assert.equal(writes, 1)
  assert.equal(notifications, 1)
  intactContext(test.context)
  await test.controller.activateChoice(choices[0])
  assert.equal(writes, 1, 'a stale repeated click cannot delete again')
  assertUnrelatedStorage()
}

for (const cancel of ['choice', 'back', 'exitCommand', 'reset', 'new-command']) {
  seed()
  const test = makeController()
  const choices = await start(test)
  if (cancel === 'choice') await test.controller.activateChoice(choices[1])
  else if (cancel === 'new-command') await test.controller.selectItem({
    systemKey: 'host:synthetic-next', kind: 'host', display: { title: 'Next' },
    behavior: { type: 'collect-input', input: {} }, recordUsage: false, experienceRecord: false, execute: async () => ({ ok: true }),
  })
  else test.controller[cancel]()
  await test.controller.activateChoice(choices[0])
  if (cancel === 'new-command') assert.equal(frame(test.controller).kind, 'collect-input')
  else root(test.controller)
  assert.equal(writes, 0)
  assert.equal(notifications, 0)
  assert.deepEqual(clone(store.listSavedActions()), [fixture, twin])
  intactContext(test.context)
}

for (const failure of readFailures) {
  seed()
  const test = makeController()
  fault = failure
  await test.controller.selectItem(host.createDeleteSavedActionItem(project()))
  root(test.controller)
  errorIs(test, 'savedActionDeleteReadFailed')
  assert.equal(writes, 0)
}
for (const failure of storageFailures) {
  seed()
  const test = makeController()
  const choices = await start(test)
  reads = 0
  fault = failure
  await test.controller.activateChoice(choices[0])
  errorIs(test, 'savedActionDeleteRetry')
  assert.equal(frame(test.controller).output.choices[0], choices[0], 'failure retains exact confirmation for retry')
  assert.equal(notifications, 0, 'failed persistence must not report a successful refresh')
  assertUnrelatedStorage()
}
for (const failure of ['write', 'discard-write']) {
  seed()
  const test = makeController()
  const choices = await start(test)
  fault = failure
  await test.controller.activateChoice(choices[0])
  fault = null
  await test.controller.activateChoice(choices[0])
  root(test.controller)
  assert.deepEqual(clone(store.listSavedActions()), [twin])
  assert.equal(notifications, 1)
  intactContext(test.context)
}

const changes = [
  { name: 'Renamed elsewhere' }, { aliases: ['different alias'] }, { createdAt: 555 },
  { savedParams: { ...fixture.savedParams, separator: '/' } },
  { savedParams: { ...fixture.savedParams, modes: ['b', 'a'] } },
  { baseActionKey: 'plugin:synthetic:tool:other' }, { inputBinding: 'prompt' },
  { outputIntent: 'return-to-launcher' }, { contractFingerprint: 'v1:changed' },
  { actionPolicy: { effect: 'external', learnable: true } }, { actionPolicy: { effect: 'pure', learnable: false } },
]
for (const change of changes) {
  for (const phase of ['before-row-click', 'during-confirmation']) {
    seed()
    const test = makeController()
    const row = project()
    const choices = phase === 'during-confirmation' ? await start(test, row) : null
    const changed = { ...clone(fixture), ...change }
    persisted.set(storageKey, JSON.stringify([changed, twin]))
    if (choices) await test.controller.activateChoice(choices[0])
    else await test.controller.selectItem(host.createDeleteSavedActionItem(row))
    errorIs(test, 'savedActionDeleteChanged')
    assert.equal(frame(test.controller).kind, choices ? 'result' : 'list')
    assert.deepEqual(clone(store.listSavedActions()), [changed, twin])
    assert.equal(writes, 0)
    assert.equal(notifications, 0)
  }
}
for (const phase of ['before-row-click', 'during-confirmation']) {
  seed()
  const test = makeController()
  const row = project()
  const choices = phase === 'during-confirmation' ? await start(test, row) : null
  persisted.set(storageKey, JSON.stringify([twin]))
  if (choices) await test.controller.activateChoice(choices[0])
  else await test.controller.selectItem(host.createDeleteSavedActionItem(row))
  errorIs(test, 'savedActionDeleteMissing')
  assert.deepEqual(clone(store.listSavedActions()), [twin])
  assert.equal(writes, 0)
}
seed()
const refresh = makeController()
const oldChoices = await start(refresh)
const renamed = { ...clone(fixture), name: 'Reviewed current name' }
persisted.set(storageKey, JSON.stringify([renamed, twin]))
await refresh.controller.activateChoice(oldChoices[0])
errorIs(refresh, 'savedActionDeleteChanged')
refresh.controller.back()
const newChoices = await start(refresh, project(renamed))
assert.match(newChoices[0].title, /Reviewed current name/)
await refresh.controller.activateChoice(newChoices[0])
root(refresh.controller)
assert.deepEqual(clone(store.listSavedActions()), [twin])

for (const base of [null, { ...baseAction, pluginLifetime: { active: false } }]) {
  seed()
  const test = makeController()
  const row = project(fixture, base)
  const item = host.createDeleteSavedActionItem(row)
  assert.equal(item.pluginLifetime, undefined)
  assert.equal(item.disabledReason, undefined)
  const choices = await start(test, row)
  await test.controller.activateChoice(choices[0])
  root(test.controller)
  assert.deepEqual(clone(store.listSavedActions()), [twin], 'unavailable plugins do not block saved-record management')
}
seed()
const benign = makeController()
const choices = await start(benign)
persisted.set(storageKey, JSON.stringify([{ ...fixture, lastInvokedAt: 999, disabledReason: 'contract-changed' }, { ...twin, name: 'Other record updated' }]))
await benign.controller.activateChoice(choices[0])
root(benign.controller)
assert.deepEqual(clone(store.listSavedActions()), [{ ...twin, name: 'Other record updated' }], 'usage and derived availability changes do not prevent deleting the approved configuration; preserve another record’s latest edit')

for (const invalid of [{ schemaVersion: 2, id: 'future-artifact' }, null]) {
  seed([fixture, invalid, twin])
  const before = persisted.get(storageKey)
  assert.throws(() => store.deleteSavedActionIfUnchanged(fixture.id, snapshot))
  assert.equal(persisted.get(storageKey), before, 'unknown or invalid unrelated records must never be filtered out by deletion')
  assert.equal(writes, 0)
}
seed([fixture, { ...fixture, name: 'Duplicate identity' }, twin])
assert.equal(store.deleteSavedActionIfUnchanged(fixture.id, snapshot).status, 'changed')
assert.equal(writes, 0, 'duplicate artifact identities fail closed')

assert.deepEqual(await lastRunModule.getLastSaveableRun(), lastRun)
assert.deepEqual(counters, { materialReads: 0, copies: 0, writes: 0, usage: 0, journal: 0, events: 0, lastRun: 0, touches: 0, closes: 0, executes: 0 })
assertUnrelatedStorage()
console.log('saved-action delete: exact identity, confirmation, stale rows, concurrency, retry, cancellation, unavailable plugins, and isolated storage checks passed')
