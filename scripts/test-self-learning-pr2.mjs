#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { pinyin } from 'pinyin-pro'
import { extractSaveableParams } from '../src/workspace/experience/saveableParams.ts'
import { CONTENT_SOURCE_STORES } from '../src/workspace/contentBoundary.ts'
import { getLastSaveableRun, setLastSaveableRun } from '../src/workspace/savedActions/lastSaveableRun.ts'
import { createSavedAction, deleteSavedAction, listSavedActions, savedActionSnapshot, setSavedActionDisabledReason } from '../src/workspace/savedActions/store.ts'
import {
  isGlobalLauncherSavedActionOutput,
  savedActionDisabledReason,
} from '../src/workspace/savedActions/compatibility.ts'

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
  './pluginLifetime': loadModule('src/workspace/launcher/pluginLifetime.ts'),
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
  './core': loadModule('src/plugins/line-tools/core.ts'),
  './routes': loadModule('src/plugins/line-tools/routes.ts'),
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
const savedDisplayModule = loadModule('src/workspace/savedActions/display.ts', {
  '../../i18n': { translate },
  '../launcher/display': loadModule('src/workspace/launcher/display.ts'),
  './compatibility': { isGlobalLauncherSavedActionOutput, savedActionDisabledReason },
})
const providerModule = loadModule('src/workspace/savedActions/provider.ts', {
  '../launcher/output': outputModule,
  './compatibility': { isGlobalLauncherSavedActionOutput, savedActionDisabledReason },
  './display': savedDisplayModule,
  './store': { savedActionSnapshot },
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
let savedCommandArgs
const savedFromCommand = { ...artifact, id: 'artifact_command' }
const hostActionsModule = loadModule('src/workspace/launcher/hostActions.ts', {
  '../../i18n': { translate },
  '../savedActions/lastSaveableRun': { getLastSaveableRun: async () => lastRun },
  '../savedActions/store': {
    createSavedAction: (run, name, aliases) => {
      savedCommandArgs = { run, name, aliases }
      return savedFromCommand
    },
    deleteSavedAction: () => savedFromCommand,
    listSavedActions: () => [savedFromCommand],
  },
  '../savedActions/events': { recordSavedActionEvent: (eventType, saved) => artifactEvents.push([eventType, saved.id]) },
  '../savedActions/compatibility': { isGlobalLauncherSavedActionOutput },
  '../savedActions/display': savedDisplayModule,
})
const savedActionCommands = hostActionsModule.getHostSavedActionItems()
const saveCommand = savedActionCommands.find((entry) => entry.systemKey === 'host:saved-action:save-last')
const deleteCommand = savedActionCommands.find((entry) => entry.systemKey === 'host:saved-action:delete')
assert.ok(saveCommand && deleteCommand)
const saveController = new controllerModule.LauncherController({
  surfaceId: 'global-launcher', api, locale: 'en', makeT: () => (key) => key,
  getSettings: () => ({}), recordSelection: () => {}, requestClose: () => {}, onChange: () => {},
})
await saveController.selectItem(saveCommand, { objectBlockText: 'PRIVATE_MATERIAL_NOT_A_NAME' })
assert.equal(saveController.getState().frames.at(-1).kind, 'collect-input')
assert.equal(saveController.getState().frames.at(-1).inputText, '')
assert.equal(savedCommandArgs, undefined)
saveController.setInputText('Join commas | csv|pipe, comma')
await saveController.submitInput()
assert.equal(saveController.getState().error, null)
assert.equal(saveController.getState().frames.at(-1).kind, 'list')
assert.deepEqual(Array.from(savedCommandArgs.aliases), [' csv|pipe', ' comma'])
assert.deepEqual(artifactEvents, [['artifact.saved', 'artifact_command']])

let unsupportedSaveCalls = 0
const unsupportedHostActions = loadModule('src/workspace/launcher/hostActions.ts', {
  '../../i18n': { translate },
  '../savedActions/lastSaveableRun': { getLastSaveableRun: async () => ({ ...lastRun, outputIntent: 'insert' }) },
  '../savedActions/store': { createSavedAction: () => { unsupportedSaveCalls += 1 } },
  '../savedActions/compatibility': { isGlobalLauncherSavedActionOutput },
}).getHostSavedActionItems()
const unsupportedSaveCommand = unsupportedHostActions.find((entry) => entry.systemKey === 'host:saved-action:save-last')
await saveController.selectItem(unsupportedSaveCommand)
assert.equal(saveController.getState().error, 'savedActionEditorOutputUnsupported')
assert.equal(saveController.getState().frames.at(-1).kind, 'list')
assert.equal(unsupportedSaveCalls, 0, 'editor-only output must be rejected before creating an Artifact')
const deleteSuggestions = await deleteCommand.suggest({ inputText: '' })
const deleteConfirmation = await deleteSuggestions.choices[0].primaryAction()
await deleteConfirmation.output.choices[0].primaryAction()
assert.deepEqual(artifactEvents.at(-1), ['artifact.deleted', 'artifact_command'])

// Presentation uses the real store, compatibility, locale, provider, registry,
// host registration and ranking logic. Only unrelated services are replaced;
// storage is the synthetic Map above and no command or native API is invoked.
localValues.clear()
const i18n = loadModule('src/i18n/registry.ts')
i18n.registerMessages('palette', loadModule('src/i18n/locales/palette.ts').default)
const launcherDisplay = loadModule('src/workspace/launcher/display.ts')
const localizedSavedDisplay = loadModule('src/workspace/savedActions/display.ts', {
  '../../i18n': i18n,
  '../launcher/display': launcherDisplay,
  './compatibility': { isGlobalLauncherSavedActionOutput, savedActionDisabledReason },
})
const realSavedStore = { createSavedAction, deleteSavedAction, listSavedActions, savedActionSnapshot, setSavedActionDisabledReason }
const localizedProvider = loadModule('src/workspace/savedActions/provider.ts', {
  '../launcher/output': outputModule,
  './compatibility': { isGlobalLauncherSavedActionOutput, savedActionDisabledReason },
  './display': localizedSavedDisplay,
  './store': realSavedStore,
})
const localizedHostActions = loadModule('src/workspace/launcher/hostActions.ts', {
  '../../i18n': i18n,
  '../savedActions/store': realSavedStore,
  '../savedActions/compatibility': { isGlobalLauncherSavedActionOutput },
  '../savedActions/display': localizedSavedDisplay,
})
const launcherTypes = loadModule('src/workspace/launcher/types.ts')
const actualRegistry = loadModule('src/workspace/launcher/registry.ts', {
  '../../i18n': i18n,
  '../pluginRegistry': { pluginRegistry: { getAllPluginDefinitions: () => [] } },
  './types': launcherTypes,
  './pluginApi': { createPluginLauncherApi: () => api },
  '../savedActions/provider': localizedProvider,
})
let commandExecutions = 0
const formatBase = {
  systemKey: 'host:test-format-json', kind: 'host',
  display: { title: 'Format JSON', titleI18n: { zh: '格式化 JSON' } },
  behavior: { type: 'perform' },
  params: [
    { key: 'indent', label: 'Indent', labelI18n: { zh: '缩进' }, type: 'number', default: 2, saveable: true },
    { key: 'sortKeys', label: 'Sort keys', labelI18n: { zh: '排序键' }, type: 'boolean', default: false, saveable: true },
  ],
  contractFingerprint: 'v1:1111111111111111', actionPolicy: { effect: 'pure', learnable: true },
  execute: () => { commandExecutions += 1; throw new Error('Display must never execute a command') },
}
const optionBase = {
  ...formatBase, systemKey: 'host:test-options',
  display: { title: 'Text options', titleI18n: { zh: '文本选项' } },
  params: [
    { key: 'mode', label: 'Mode', labelI18n: { zh: '模式' }, type: 'single-select', saveable: true,
      options: [{ value: 'internal_mode_compact', label: 'Compact', labelI18n: { zh: '紧凑' } }] },
    { key: 'fields', label: 'Fields', labelI18n: { zh: '字段' }, type: 'multi-select', saveable: true,
      options: [{ value: 'internal_field_title', label: 'Title', labelI18n: { zh: '标题' } }, 'count'] },
    { key: 'separator', label: 'Separator', labelI18n: { zh: '分隔符' }, type: 'text', saveable: true, saveableMaxLength: 256 },
    { key: 'unstored', label: 'Unstored default', type: 'number', default: 7, saveable: true },
  ],
}
let currentBaseItems = [formatBase, optionBase]
const inertHostItem = (id) => ({ ...formatBase, systemKey: `host:test-${id}` })
const hostRegistration = loadModule('src/workspace/launcher/hostProvider.ts', {
  './registry': actualRegistry,
  './hostActions': {
    getHostSavedActionItems: localizedHostActions.getHostSavedActionItems,
    getHostPaneControlItems: () => currentBaseItems,
    getHostSystemPowerItems: () => [], getHostExperienceJournalItems: () => [],
  },
  '../appLauncher/hostAppLauncher': { getHostAppLauncherStaticItems: () => [] },
  '../../workflow/pipelineLauncher': { getTextPipelineLauncherItems: () => [] },
  '../desktopControl/killProcessCommand': { getKillProcessHostItem: () => inertHostItem('kill') },
  '../desktopControl/switchWindowCommand': { getSwitchWindowHostItem: () => inertHostItem('switch') },
})
hostRegistration.registerHostLauncherProviders()
const saveFixture = (base, savedParams, outputIntent = 'copy', name = 'My JSON') => createSavedAction({
  ...lastRun, actionKey: base.systemKey, contractFingerprint: base.contractFingerprint,
  actionPolicy: base.actionPolicy, savedParams, outputIntent,
}, name, ['saved fixture'])
const sameNamed = [
  saveFixture(formatBase, { indent: 2, sortKeys: false }),
  saveFixture(formatBase, { indent: 4, sortKeys: true }),
  saveFixture(formatBase, { indent: 4, sortKeys: true }, 'return-to-launcher'),
]
const optionsArtifact = saveFixture(optionBase, {
  mode: 'internal_mode_compact', fields: ['internal_field_title', 'count'], separator: 'PRIVATE_FREE_TEXT_CANARY',
}, 'open-quick-editor', 'Options')
const savedRows = () => actualRegistry.collectStaticCandidates('global-launcher').filter((row) => row.savedActionArtifactId)
const descriptions = (rows, locale) => Array.from(rows, (row) => launcherDisplay.resolveDisplaySubtitle(row.display, locale))
const beforeDescriptions = JSON.stringify(listSavedActions())
const rows = savedRows()
const jsonRows = rows.filter((row) => sameNamed.some((saved) => saved.id === row.savedActionArtifactId))
assert.deepEqual(descriptions(jsonRows, 'en'), [
  'Copy · Format JSON · Indent: 2 · Sort keys: No',
  'Copy · Format JSON · Indent: 4 · Sort keys: Yes',
  'Return to Launcher · Format JSON · Indent: 4 · Sort keys: Yes',
])
assert.deepEqual(descriptions(jsonRows, 'zh'), [
  '复制 · 格式化 JSON · 缩进: 2 · 排序键: 否',
  '复制 · 格式化 JSON · 缩进: 4 · 排序键: 是',
  '返回 Launcher · 格式化 JSON · 缩进: 4 · 排序键: 是',
])
assert.equal(new Set(jsonRows.map((row) => row.systemKey)).size, 3, 'same names retain independent artifact identities')
assert.ok(jsonRows.every((row) => row.display.title === 'My JSON'))
const optionsRow = rows.find((row) => row.savedActionArtifactId === optionsArtifact.id)
assert.equal(launcherDisplay.resolveDisplaySubtitle(optionsRow.display, 'en'),
  'Open Quick Editor · Text options · Mode: Compact · Fields: Title, count · Separator: Set')
assert.equal(launcherDisplay.resolveDisplaySubtitle(optionsRow.display, 'zh'),
  '打开快速编辑器 · 文本选项 · 模式: 紧凑 · 字段: 标题, count · 分隔符: 已设置')
assert.doesNotMatch(JSON.stringify(rows.map((row) => row.display)),
  /PRIVATE_|internal_mode_|internal_field_|artifact_|host:test-|Unstored default/)
assert.equal(JSON.stringify(listSavedActions()), beforeDescriptions, 'describing valid settings must not change artifacts')
for (const [saved, base] of [
  [{ ...sameNamed[0], savedParams: { indent: 'PRIVATE_BAD_NUMBER' } }, formatBase],
  [{ ...sameNamed[0], savedParams: { sortKeys: 'PRIVATE_BAD_BOOLEAN' } }, formatBase],
  [{ ...sameNamed[0], savedParams: { unknown: 'PRIVATE_UNKNOWN_VALUE' } }, formatBase],
  [{ ...optionsArtifact, savedParams: { mode: 'PRIVATE_UNKNOWN_OPTION' } }, optionBase],
  [{ ...optionsArtifact, savedParams: { fields: ['PRIVATE_UNKNOWN_MULTI_OPTION'] } }, optionBase],
  [optionsArtifact, { ...optionBase, params: optionBase.params.map((param) => ({ ...param, saveable: false })) }],
  [optionsArtifact, { ...optionBase, params: optionBase.params.map((param) => param.type === 'text'
    ? { ...param, saveableMaxLength: 4 } : param) }],
]) {
  const invalid = localizedProvider.projectSavedAction(saved, base)
  assert.equal(invalid.disabledReason?.code, 'saveability-changed')
  for (const locale of ['en', 'zh']) {
    assert.equal(launcherDisplay.resolveDisplaySubtitle(invalid.display, locale),
      i18n.translate(locale, 'palette', 'savedActionSaveabilityChanged'))
  }
  assert.doesNotMatch(JSON.stringify(invalid.display), /PRIVATE_|internal_|Indent|Separator|Mode|Fields/)
}

const usageModule = loadModule('src/workspace/launcher/usage.ts', { './types': launcherTypes })
const actualRanking = loadModule('src/workspace/launcher/ranking.ts', {
  '../searchRanking': loadModule('src/workspace/searchRanking.ts', { 'pinyin-pro': { pinyin } }),
  '../desktopTargets/browserWindowPolicy': loadModule('src/workspace/desktopTargets/browserWindowPolicy.ts'),
  './intentEngine': loadModule('src/workspace/launcher/intentEngine.ts'),
  './usage': usageModule, './display': launcherDisplay,
})
const favoriteKeys = jsonRows.map((row) => row.systemKey)
for (const locale of ['en', 'zh']) {
  for (const query of ['', 'My JSON', 'saved fixture']) {
    const ranked = actualRanking.rankLauncherItems({ query, locale, surfaceId: 'global-launcher',
      usage: usageModule.emptyUsageBySurface(), now: Date.now(), favoriteKeys,
    }, jsonRows)
    assert.deepEqual(Array.from(ranked, (row) => row.systemKey), Array.from(favoriteKeys))
    assert.equal(new Set(descriptions(ranked, locale)).size, 3, 'search and pinned rows preserve distinguishable descriptions')
  }
}
const actualDelete = actualRegistry.collectBaseCandidates().find((row) => row.systemKey === 'host:saved-action:delete')
const deleteChoices = (await actualDelete.suggest({ inputText: 'My JSON' })).choices
assert.equal(deleteChoices.length, 3)
for (let index = 0; index < deleteChoices.length; index += 1) {
  const choice = deleteChoices[index]
  const confirmation = (await choice.primaryAction()).output.choices[0]
  for (const locale of ['en', 'zh']) {
    assert.equal(launcherDisplay.resolveDisplaySubtitle(choice, locale), descriptions(jsonRows, locale)[index])
    assert.equal(launcherDisplay.resolveDisplaySubtitle(confirmation, locale), descriptions(jsonRows, locale)[index])
  }
  assert.equal(confirmation.id, `saved-action-delete-confirm-${sameNamed[index].id}`)
}
// An existing deletion row must use the source registry as it is now, not when
// its list was built. This also exercises hostProvider's lazy registry callback.
for (const [replacement, key] of [
  [[], 'savedActionMissing'],
  [[formatBase, { ...formatBase, source: 'dev' }], 'savedActionAmbiguous'],
  [[{ ...formatBase, contractFingerprint: 'v1:2222222222222222' }], 'savedActionContractChanged'],
]) {
  currentBaseItems = replacement
  const confirmation = (await deleteChoices[0].primaryAction()).output.choices[0]
  assert.equal(confirmation.id, `saved-action-delete-confirm-${sameNamed[0].id}`)
  for (const locale of ['en', 'zh']) {
    assert.equal(launcherDisplay.resolveDisplaySubtitle(confirmation, locale), i18n.translate(locale, 'palette', key))
  }
  const unavailableRows = savedRows().filter((row) => sameNamed.some((saved) => saved.id === row.savedActionArtifactId))
  assert.ok(unavailableRows.every((row) => row.disabledReason))
  assert.doesNotMatch(JSON.stringify(unavailableRows.map((row) => row.display)), /Indent|缩进|Format JSON|格式化 JSON/)
}
currentBaseItems = [formatBase, optionBase]
assert.equal(savedRows().filter((row) => row.disabledReason).length, 0, 'restoring the source restores current descriptions')
assert.equal(JSON.stringify(listSavedActions()), beforeDescriptions, 'availability updates preserve each artifact and its settings')
assert.equal(commandExecutions, 0)

console.log('self-learning PR2 checks passed')
