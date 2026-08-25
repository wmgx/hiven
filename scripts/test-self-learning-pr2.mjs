#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { extractSaveableParams } from '../src/workspace/experience/saveableParams.ts'
import { CONTENT_SOURCE_STORES } from '../src/workspace/contentBoundary.ts'
import { getLastSaveableRun, setLastSaveableRun } from '../src/workspace/savedActions/lastSaveableRun.ts'
import { createSavedAction, deleteSavedAction, listSavedActions } from '../src/workspace/savedActions/store.ts'
import { savedActionDisabledReason } from '../src/workspace/savedActions/compatibility.ts'

const item = {
  systemKey: 'plugin:line-tools:tool:line-tools.join',
  params: [
    { key: 'separator', label: 'Separator', type: 'text', default: '\n', saveable: true, saveableMaxLength: 256 },
    { key: 'trim', label: 'Trim', type: 'boolean', default: false, saveable: false },
  ],
  defaultParams: { separator: '\n', trim: false },
}

assert.deepEqual(
  extractSaveableParams(item, { separator: ', ', trim: false }),
  { ok: true, params: { separator: ', ' } },
)
assert.deepEqual(
  extractSaveableParams(item, { separator: ', ', trim: true }),
  { ok: false, blockedKeys: ['trim'], reason: 'unsaveable-non-default' },
)
assert.equal(
  extractSaveableParams(item, { separator: 'x'.repeat(257), trim: false }).reason,
  'invalid-saveable-value',
)
assert.equal(
  extractSaveableParams({
    ...item,
    params: [{
      key: 'mode', label: 'Mode', type: 'single-select', default: 'a', saveable: true,
      options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }],
    }],
  }, { mode: 'unknown' }).reason,
  'invalid-saveable-value',
)
assert.equal(
  extractSaveableParams(item, { separator: ', ', trim: false, unknown: 'body' }).reason,
  'invalid-saveable-value',
)

const lastRun = {
  status: 'ready',
  runId: 'run_test',
  actionKey: item.systemKey,
  savedParams: { separator: ', ' },
  inputBinding: 'selection',
  outputIntent: 'copy',
  contractFingerprint: 'v1:0123456789abcdef',
  actionPolicy: { effect: 'pure', learnable: true },
  completedAt: Date.now(),
}
setLastSaveableRun(lastRun)
assert.deepEqual(await getLastSaveableRun(), lastRun)

const inert = new Proxy(() => undefined, {
  get: (_target, prop) => prop === 'then' ? undefined : inert,
  apply: () => undefined,
  construct: () => ({}),
})
function loadModule(path, modules = {}) {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const exports = {}
  const sandbox = {
    exports,
    module: { exports },
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Promise,
    Error,
    DOMException,
    structuredClone,
    require: (specifier) => modules[specifier] ?? new Proxy({}, { get: () => inert }),
  }
  vm.runInNewContext(output, sandbox, { filename: path })
  return sandbox.module.exports
}

const translate = (_locale, _namespace, key) => key
const outputModule = loadModule('src/workspace/launcher/output.ts', {
  './types': { normalizeLauncherSurfaceId: (surface) => surface },
  '../../i18n': { translate },
})
const snapshots = []
const touchedArtifacts = []
let nextId = 0
const controllerModule = loadModule('src/workspace/launcher/controller.ts', {
  '../usageJournal': { appendUsageJournal: async () => {} },
  './output': outputModule,
  '../../i18n': { translate },
  '../telemetry': {
    TelemetryEvents: new Proxy({}, { get: (_target, prop) => String(prop) }),
    itemTelemetryProps: () => ({}),
    trackBehavior: () => {},
    trackLatencyFrom: () => {},
    telemetryNow: () => 0,
  },
  '../experience/journal': {
    appendExperienceEvent: () => {},
    currentExperienceSessionId: (fallback) => fallback,
    newExperienceId: (prefix) => `${prefix}_pr2-${++nextId}`,
  },
  '../experience/errorType': loadModule('src/workspace/experience/errorType.ts'),
  '../experience/saveableParams': { extractSaveableParams },
  '../savedActions/lastSaveableRun': { setLastSaveableRun: (snapshot) => snapshots.push(structuredClone(snapshot)) },
  '../savedActions/store': { touchSavedAction: (id) => touchedArtifacts.push(id) },
  '../contentBoundary': loadModule('src/workspace/contentBoundary.ts'),
})

const api = {
  getSelectionText: () => 'PRIVATE_SELECTION_BODY',
  getActiveText: () => 'PRIVATE_ACTIVE_BODY',
  copyText: async () => {},
  insertText: async () => {},
  replaceActiveText: async () => {},
  returnToLauncher: async () => {},
}
const controller = new controllerModule.LauncherController({
  surfaceId: 'editor-command-bar',
  api,
  locale: 'en',
  makeT: () => (key) => key,
  getSettings: () => ({}),
  recordSelection: () => {},
  requestClose: () => {},
  onChange: () => {},
  appendExperienceEvent: () => {},
})
const saveableItem = {
  systemKey: item.systemKey,
  kind: 'plugin',
  display: { title: 'Join lines' },
  behavior: { type: 'perform' },
  inputPolicy: { mode: 'selection' },
  actionPolicy: { effect: 'pure', learnable: true },
  contractFingerprint: 'v1:0123456789abcdef',
  params: item.params,
  defaultParams: item.defaultParams,
  execute: async () => outputModule.textResult('PRIVATE_OUTPUT_BODY', api, 'en'),
  executeWithParams: async () => outputModule.textResult('PRIVATE_OUTPUT_BODY', api, 'en'),
}
await controller.selectItem(saveableItem, { customizeParams: true })
await controller.commitCurrentParam(', ')
await controller.commitCurrentParam(false)
assert.equal(snapshots.length, 1)
assert.equal(snapshots[0].status, 'ready')
assert.equal(snapshots[0].inputBinding, 'selection')
assert.equal(snapshots[0].outputIntent, 'copy')
assert.deepEqual(snapshots[0].savedParams, { separator: ', ' })
assert.doesNotMatch(JSON.stringify(snapshots), /PRIVATE_SELECTION_BODY|PRIVATE_ACTIVE_BODY|PRIVATE_OUTPUT_BODY/)

const blockedController = new controllerModule.LauncherController({
  surfaceId: 'editor-command-bar', api, locale: 'en', makeT: () => (key) => key,
  getSettings: () => ({}), recordSelection: () => {}, requestClose: () => {}, onChange: () => {},
  appendExperienceEvent: () => {},
})
await blockedController.selectItem(saveableItem, { customizeParams: true })
await blockedController.commitCurrentParam(', ')
await blockedController.commitCurrentParam(true)
assert.equal(snapshots.at(-1).status, 'blocked')
assert.deepEqual(snapshots.at(-1).blockedKeys, ['trim'])

const snapshotCountBeforeGlobalSelection = snapshots.length
const globalSelectionController = new controllerModule.LauncherController({
  surfaceId: 'global-launcher', api, locale: 'en', makeT: () => (key) => key,
  getSettings: () => ({}), recordSelection: () => {}, requestClose: () => {}, onChange: () => {},
  appendExperienceEvent: () => {},
})
await globalSelectionController.selectItem(saveableItem, { customizeParams: true })
await globalSelectionController.commitCurrentParam(', ')
await globalSelectionController.commitCurrentParam(false)
assert.equal(snapshots.length, snapshotCountBeforeGlobalSelection + 1)
assert.equal(snapshots.at(-1).inputBinding, 'selection')

const localValues = new Map()
globalThis.window = {
  localStorage: {
    getItem: (key) => localValues.get(key) ?? null,
    setItem: (key, value) => localValues.set(key, value),
  },
}
const artifact = createSavedAction(lastRun, 'Join with commas', ['csv join', 'comma lines'])
assert.ok(CONTENT_SOURCE_STORES.includes('saved-actions'))
assert.equal(artifact.schemaVersion, 1)
assert.deepEqual(listSavedActions(), [artifact])
assert.doesNotMatch(JSON.stringify(artifact), /PRIVATE_SELECTION_BODY|PRIVATE_OUTPUT_BODY/)
assert.doesNotMatch([...localValues.values()].join('\n'), /PRIVATE_SELECTION_BODY|PRIVATE_OUTPUT_BODY/)
assert.equal(savedActionDisabledReason(artifact, null), 'missing-action')
assert.equal(savedActionDisabledReason(artifact, { ...saveableItem, actionPolicy: { effect: 'read', learnable: true } }), 'policy-changed')
assert.equal(savedActionDisabledReason(artifact, { ...saveableItem, contractFingerprint: 'v1:fedcba9876543210' }), 'contract-changed')
assert.equal(savedActionDisabledReason(artifact, {
  ...saveableItem,
  params: saveableItem.params.map((param) => param.key === 'separator' ? { ...param, saveable: false } : param),
}), 'saveability-changed')
assert.equal(savedActionDisabledReason(artifact, saveableItem, { inputAvailable: false }), 'input-unavailable')
assert.equal(savedActionDisabledReason(artifact, saveableItem, { outputAvailable: false }), 'output-unavailable')
assert.equal(savedActionDisabledReason(artifact, saveableItem), undefined)

let baseExecutions = 0
const lineToolsModule = loadModule('src/plugins/line-tools/index.ts', {
  '@hiven/plugin': { definePlugin: (definition) => definition },
})
const joinTool = lineToolsModule.lineToolsPlugin.tools.find((tool) => tool.id === 'line-tools.join')
assert.ok(joinTool)
const replayBase = {
  ...saveableItem,
  executeWithParams: async (ctx, params) => {
    baseExecutions += 1
    assert.equal(ctx.input.text, 'alpha\nbeta')
    assert.deepEqual(params, { separator: ', ' })
    return joinTool.run({
      ...ctx,
      input: { kind: 'text', text: ctx.input.text, mode: 'auto', source: 'manual' },
      params,
      output: { text: (value) => outputModule.textResult(value, ctx.api, 'en') },
    })
  },
}
const providerModule = loadModule('src/workspace/savedActions/provider.ts', {
  '../launcher/output': outputModule,
  './compatibility': { savedActionDisabledReason },
})
const replay = providerModule.projectSavedAction(artifact, replayBase)
assert.equal(replay.systemKey, `host:saved-action:${artifact.id}`)
assert.equal(replay.commitVia, 'saved-action')
assert.equal(replay.savedActionArtifactId, artifact.id)
const replayResult = await replay.execute({
  surfaceId: 'global-launcher', input: undefined, settings: {}, locale: 'en',
  api: { ...api, getSelectionText: () => 'alpha\nbeta' }, storage: {}, t: (key) => key,
})
assert.equal(baseExecutions, 1)
assert.equal(replayResult.ok, true)
assert.equal(outputModule.getHostOutputIntent(replayResult.output.choices[0]), 'copy')
assert.equal(replayResult.output.choices[0].title, 'alpha, beta')
await replayResult.output.choices[0].primaryAction()

const unavailableInput = providerModule.projectSavedAction(artifact, replayBase, false)
assert.equal(unavailableInput.disabledReason?.code, 'input-unavailable')
assert.equal((await unavailableInput.execute({
  surfaceId: 'global-launcher', input: undefined, settings: {}, locale: 'en',
  api: { ...api, getSelectionText: () => '' }, storage: {}, t: (key) => key,
})).ok, false)
assert.equal(baseExecutions, 1, 'input-incompatible Saved Action must not run the base action')

const invokedEvents = []
const replayController = new controllerModule.LauncherController({
  surfaceId: 'global-launcher',
  api: { ...api, getSelectionText: () => 'alpha\nbeta' },
  locale: 'en', makeT: () => (key) => key, getSettings: () => ({}), recordSelection: () => {},
  requestClose: () => {}, onChange: () => {}, appendExperienceEvent: (event) => invokedEvents.push(structuredClone(event)),
})
await replayController.selectItem(replay)
assert.deepEqual(invokedEvents.map((event) => event.eventType), [
  'run.started', 'run.finished', 'output.applied', 'artifact.invoked',
])
assert.equal(invokedEvents.at(-1).artifactId, artifact.id)
assert.deepEqual(touchedArtifacts, [artifact.id])
assert.equal(savedActionDisabledReason({ ...artifact, outputIntent: 'insert' }, replayBase), undefined)
const unavailableOutput = providerModule.projectSavedAction({ ...artifact, outputIntent: 'insert' }, replayBase)
assert.equal(unavailableOutput.disabledReason?.code, 'output-unavailable')
assert.equal((await unavailableOutput.execute({
  surfaceId: 'global-launcher', input: undefined, settings: {}, locale: 'en',
  api: { ...api, getSelectionText: () => 'alpha\nbeta' }, storage: {}, t: (key) => key,
})).ok, false)
assert.equal(baseExecutions, 2, 'output-incompatible Saved Action must not run the base action')
assert.equal(deleteSavedAction(artifact.id)?.id, artifact.id)
assert.deepEqual(listSavedActions(), [])
localValues.set('hiven:saved-actions:v1', JSON.stringify([{ ...artifact, inputText: 'PRIVATE_INPUT_CANARY' }]))
assert.deepEqual(listSavedActions(), [], 'Artifact loader must reject unknown content-bearing fields')

const registrySource = readFileSync('src/workspace/launcher/registry.ts', 'utf8')
assert.match(registrySource, /getSavedActionLauncherItems\(baseItems, \{/)

const artifactEvents = []
const savedFromCommand = { ...artifact, id: 'artifact_command' }
const hostActionsModule = loadModule('src/workspace/launcher/hostActions.ts', {
  '../savedActions/lastSaveableRun': { getLastSaveableRun: async () => lastRun },
  '../savedActions/store': {
    createSavedAction: () => savedFromCommand,
    deleteSavedAction: () => savedFromCommand,
    listSavedActions: () => [savedFromCommand],
  },
  '../savedActions/events': { recordSavedActionEvent: (eventType, saved) => artifactEvents.push([eventType, saved.id]) },
})
const savedActionCommands = hostActionsModule.getHostSavedActionItems()
const saveCommand = savedActionCommands.find((entry) => entry.systemKey === 'host:saved-action:save-last')
const deleteCommand = savedActionCommands.find((entry) => entry.systemKey === 'host:saved-action:delete')
assert.ok(saveCommand && deleteCommand)
assert.equal((await saveCommand.execute({ input: { text: 'Join commas | csv, comma' } })).ok, true)
assert.deepEqual(artifactEvents, [['artifact.saved', 'artifact_command']])
const deleteSuggestions = await deleteCommand.suggest({ inputText: '' })
const deleteConfirmation = await deleteSuggestions.choices[0].primaryAction()
await deleteConfirmation.output.choices[0].primaryAction()
assert.deepEqual(artifactEvents.at(-1), ['artifact.deleted', 'artifact_command'])

console.log('self-learning PR2 checks passed')
