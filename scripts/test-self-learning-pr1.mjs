#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const inert = new Proxy(() => undefined, {
  get: (_target, prop) => prop === 'then' ? undefined : inert,
  apply: () => undefined,
  construct: () => ({}),
})

function loadModule(path, modules = {}, globals = {}) {
  const source = readFileSync(path, 'utf8')
  const output = ts.transpileModule(source, {
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
    require: (specifier) => modules[specifier] ?? new Proxy({}, { get: () => inert }),
    ...globals,
  }
  vm.runInNewContext(output, sandbox, { filename: path })
  return sandbox.module.exports
}

const translate = (_locale, _namespace, key) => key
const output = loadModule('src/workspace/launcher/output.ts', {
  './types': { normalizeLauncherSurfaceId: (surface) => surface === 'command-palette' ? 'editor-command-bar' : surface },
  '../../i18n': { translate },
})
const errorType = loadModule('src/workspace/experience/errorType.ts')
const contentBoundary = loadModule('src/workspace/contentBoundary.ts')

let id = 0
const journalModule = {
  appendExperienceEvent: () => {},
  currentExperienceSessionId: (fallback) => fallback,
  newExperienceId: (prefix) => `${prefix}_test-${++id}`,
}
const controllerModule = loadModule('src/workspace/launcher/controller.ts', {
  '../usageJournal': { appendUsageJournal: async () => {} },
  './output': output,
  '../../i18n': { translate },
  '../telemetry': {
    TelemetryEvents: new Proxy({}, { get: (_target, prop) => String(prop) }),
    itemTelemetryProps: () => ({}),
    trackBehavior: () => {},
    trackLatencyFrom: () => {},
    telemetryNow: () => 0,
  },
  '../experience/journal': journalModule,
  '../experience/errorType': errorType,
  '../contentBoundary': contentBoundary,
})
const { LauncherController } = controllerModule

function createHarness() {
  const events = []
  const usage = []
  const calls = { copy: 0, insert: 0, replace: 0, return: 0, close: 0 }
  const api = {
    getActiveText: () => '',
    getSelectionText: () => '',
    copyText: async () => { calls.copy += 1 },
    insertText: async () => { calls.insert += 1 },
    replaceActiveText: async () => { calls.replace += 1 },
    returnToLauncher: async () => { calls.return += 1 },
  }
  const controller = new LauncherController({
    surfaceId: 'global-launcher',
    api,
    locale: 'en',
    makeT: () => (key) => key,
    getSettings: () => ({}),
    recordSelection: (_surfaceId, selectedItem) => { usage.push(selectedItem.systemKey) },
    requestClose: () => { calls.close += 1 },
    onChange: () => {},
    appendExperienceEvent: (event) => events.push(structuredClone(event)),
  })
  return { controller, events, usage, calls, api }
}

function item(overrides = {}) {
  return {
    systemKey: 'plugin:test:tool:action',
    kind: 'plugin',
    display: { title: 'Action' },
    behavior: { type: 'perform' },
    execute: async () => ({ ok: true }),
    ...overrides,
  }
}

function assertPair(events, via = 'execute') {
  assert.deepEqual(events.map((event) => event.eventType), ['run.started', 'run.finished'])
  assert.equal(events[0].runId, events[1].runId)
  assert.equal(events[0].via, via)
  assert.equal(events[1].via, via)
  assert.equal(events[1].status, 'success')
}

const allEvents = []
{
  const h = createHarness()
  let executions = 0
  await h.controller.selectItem(item({ execute: async () => { executions += 1; return { ok: true } } }))
  assert.equal(executions, 1)
  assert.deepEqual(h.usage, ['plugin:test:tool:action'], 'successful commit records usage once')
  assertPair(h.events)
  allEvents.push(...h.events)
}
{
  const h = createHarness()
  let executions = 0
  const paramItem = item({
    params: [{ key: 'mode', label: 'Mode', type: 'single-select', options: ['a', 'b'], default: 'a' }],
    executeWithParams: async () => { executions += 1; return { ok: true } },
  })
  await h.controller.selectItem(paramItem, { customizeParams: true })
  assert.equal(h.events.length, 0)
  assert.equal(h.usage.length, 0, 'entering parameter input does not record usage')
  await h.controller.commitCurrentParam('b')
  assert.equal(executions, 1)
  assert.equal(h.usage.length, 1, 'successful parameter commit records usage')
  assertPair(h.events)
  allEvents.push(...h.events)
}
{
  const h = createHarness()
  let executions = 0
  const inputItem = item({
    behavior: { type: 'collect-input', input: { allowEmptyInput: false } },
    execute: async () => { executions += 1; return { ok: true } },
  })
  await h.controller.selectItem(inputItem)
  assert.equal(h.usage.length, 0, 'entering collect-input does not record usage')
  h.controller.setInputText('secret input')
  await h.controller.submitInput()
  assert.equal(executions, 1)
  assert.equal(h.usage.length, 1, 'successful collect-input commit records usage')
  assertPair(h.events)
  assert.doesNotMatch(JSON.stringify(h.events), /secret input/)
  allEvents.push(...h.events)
}
{
  const h = createHarness()
  let executions = 0
  const previewItem = item({
    inputPolicy: { mode: 'auto' },
    execute: async () => {
      executions += 1
      return output.textResult('secret output', h.api, 'en')
    },
  })
  await h.controller.selectItem(previewItem)
  h.controller.setInputText('preview body')
  for (let i = 0; i < 100; i += 1) await h.controller.previewInput()
  assert.equal(h.events.length, 0, 'preview computation must produce zero events')
  await h.controller.submitInput()
  assert.equal(executions, 100, 'preview submit must reuse the resolved choice')
  assert.deepEqual(h.events.map((event) => event.eventType), ['run.started', 'run.finished', 'output.applied'])
  assert.equal(h.events[0].via, 'preview-choice')
  assert.equal(h.events[2].outputIntent, 'copy')
  assert.equal(h.calls.copy, 1)
  assert.doesNotMatch(JSON.stringify(h.events), /preview body|secret output/)
  allEvents.push(...h.events)
}
{
  const h = createHarness()
  let suggestionQueries = 0
  let actions = 0
  const suggestionItem = item({
    behavior: { type: 'collect-input', input: { allowEmptyInput: true } },
    suggest: async () => {
      suggestionQueries += 1
      return {
        choices: [{ id: 'copy', title: 'spoofed copy', primaryAction: async () => { actions += 1 } }],
      }
    },
  })
  await h.controller.selectItem(suggestionItem)
  for (let i = 0; i < 100; i += 1) await h.controller.refreshSuggestions()
  assert.equal(h.events.length, 0, 'suggestion queries must produce zero events')
  h.controller.moveSuggestionHighlight(1)
  await h.controller.submitInput()
  assert.ok(suggestionQueries >= 100)
  assert.equal(actions, 1)
  assertPair(h.events, 'suggestion')
  assert.equal(h.events.some((event) => event.eventType === 'output.applied'), false)
  allEvents.push(...h.events)
}
{
  const h = createHarness()
  const previewItem = item({
    inputPolicy: { mode: 'auto' },
    execute: async () => output.textResult('preview result', h.api, 'en'),
  })
  await h.controller.selectItem(previewItem)
  h.controller.setInputText('preview input')
  await h.controller.previewInput()
  const frame = h.controller.getState().frames.at(-1)
  const choice = frame?.kind === 'collect-input' ? frame.previewOutput?.choices[0] : undefined
  assert.ok(choice, 'live preview should expose an output choice')
  await h.controller.activateSecondary(choice, 'return-to-launcher')
  assert.equal(h.calls.return, 1)
  assert.deepEqual(h.usage, ['plugin:test:tool:action'], 'successful live-preview output records usage once')
}
{
  const h = createHarness()
  let executions = 0
  await h.controller.selectItem(item({
    commitVia: 'saved-action',
    execute: async () => { executions += 1; return { ok: true } },
  }))
  assert.equal(executions, 1)
  assertPair(h.events, 'saved-action')
  allEvents.push(...h.events)
}
{
  const h = createHarness()
  await h.controller.selectItem(item({ execute: async () => output.textResult('body', h.api, 'en') }))
  assert.deepEqual(h.events.map((event) => event.eventType), ['run.started', 'run.finished', 'output.applied'])
  assert.equal(h.events[2].outputIntent, 'copy')
  allEvents.push(...h.events)
}
{
  const h = createHarness()
  const customCopy = { id: 'copy', title: 'body', primaryAction: async () => { h.calls.copy += 1 } }
  await h.controller.selectItem(item({ execute: async () => output.choicesResult([customCopy]) }))
  assertPair(h.events)
  assert.equal(h.calls.copy, 1)
  assert.deepEqual(h.usage, ['plugin:test:tool:action'], 'successful output action records usage once')
  allEvents.push(...h.events)
}
{
  const h = createHarness()
  const failingChoice = {
    id: 'fail',
    title: 'Fail',
    primaryAction: async () => { throw new Error('output failed') },
  }
  await h.controller.selectItem(item({ execute: async () => output.choicesResult([failingChoice]) }))
  assert.equal(h.usage.length, 0, 'failed output action must not record usage')
}
{
  const h = createHarness()
  const choices = [
    { id: 'one', title: 'One', primaryAction: async () => {} },
    { id: 'two', title: 'Two', primaryAction: async () => {} },
  ]
  await h.controller.selectItem(item({ execute: async () => output.choicesResult(choices) }))
  assert.equal(h.usage.length, 0, 'showing output choices must not record usage')
  h.controller.back()
  assert.equal(h.usage.length, 0, 'cancelling output choices must not record usage')
}
{
  const h = createHarness()
  const cancel = {
    id: 'cancel',
    title: 'Cancel',
    tone: 'muted',
    primaryAction: async () => ({ ok: true, keepOpen: true }),
  }
  const confirm = { id: 'confirm', title: 'Confirm', primaryAction: async () => {} }
  await h.controller.selectItem(item({ execute: async () => output.choicesResult([confirm, cancel]) }))
  await h.controller.activateChoice(cancel)
  assert.equal(h.usage.length, 0, 'cancel choice must not record usage')
}
{
  const h = createHarness()
  const customChoice = {
    id: 'custom',
    title: 'Custom',
    primaryAction: async () => {},
    secondaryActions: [{ id: 'copy', title: 'Spoofed copy', run: async () => { h.calls.copy += 1 } }],
  }
  const dummy = { id: 'dummy', title: 'Dummy', primaryAction: async () => {} }
  await h.controller.selectItem(item({ execute: async () => output.choicesResult([customChoice, dummy]) }))
  await h.controller.activateSecondary(customChoice, 'copy')
  assert.equal(h.events.some((event) => event.eventType === 'output.applied'), false)
  allEvents.push(...h.events)
}
for (const secondaryId of ['copy', 'insert']) {
  const h = createHarness()
  const hostChoice = output.replaceActiveTextResult('body', h.api, 'en').output.choices[0]
  const dummy = { id: 'dummy', title: 'Dummy', primaryAction: async () => {} }
  await h.controller.selectItem(item({ execute: async () => output.choicesResult([hostChoice, dummy]) }))
  await h.controller.activateSecondary(hostChoice, secondaryId)
  const applied = h.events.filter((event) => event.eventType === 'output.applied')
  assert.equal(applied.length, 1)
  assert.equal(applied[0].outputIntent, secondaryId)
  allEvents.push(...h.events)
}
{
  const h = createHarness()
  const hostChoice = output.textResult('body', h.api, 'en').output.choices[0]
  const cloned = { ...hostChoice }
  const dummy = { id: 'dummy', title: 'Dummy', primaryAction: async () => {} }
  await h.controller.selectItem(item({ execute: async () => output.choicesResult([cloned, dummy]) }))
  await h.controller.activateChoice(cloned)
  assert.equal(h.events.some((event) => event.eventType === 'output.applied'), false, 'cloned marker must fail closed')
  allEvents.push(...h.events)
}
{
  const h = createHarness()
  const hostChoice = output.replaceActiveTextResult('body', h.api, 'en').output.choices[0]
  const clonedAction = { ...hostChoice.secondaryActions[0] }
  const clonedChoice = { ...hostChoice, secondaryActions: [clonedAction] }
  const dummy = { id: 'dummy', title: 'Dummy', primaryAction: async () => {} }
  await h.controller.selectItem(item({ execute: async () => output.choicesResult([clonedChoice, dummy]) }))
  await h.controller.activateSecondary(clonedChoice, clonedAction.id)
  assert.equal(h.events.some((event) => event.eventType === 'output.applied'), false, 'cloned action marker must fail closed')
  allEvents.push(...h.events)
}
{
  const h = createHarness()
  const canary = 'RAW_ERROR_CANARY_DO_NOT_PERSIST'
  await h.controller.selectItem(item({ execute: async () => { throw new Error(canary) } }))
  assert.equal(h.usage.length, 0, 'thrown execution does not record usage')
  assert.deepEqual(h.events.map((event) => event.eventType), ['run.started', 'run.finished'])
  assert.equal(h.events[1].status, 'failed')
  assert.equal(h.events[1].errorType, 'provider-failed')
  assert.doesNotMatch(JSON.stringify(h.events), new RegExp(canary))
  allEvents.push(...h.events)
}
{
  const h = createHarness()
  const paramItem = item({
    params: [{ key: 'value', label: 'Value', type: 'text' }],
    executeWithParams: async () => ({ ok: true }),
  })
  await h.controller.selectItem(paramItem, { customizeParams: true })
  h.controller.setParamQuery('not committed')
  h.controller.back()
  assert.equal(h.events.length, 0, 'parameter browse/cancel must produce zero events')
  assert.equal(h.usage.length, 0, 'parameter browse/cancel must not record usage')
}
{
  const h = createHarness()
  await h.controller.selectItem(item({ execute: async () => ({ ok: false, message: 'failed' }) }))
  assert.equal(h.usage.length, 0, 'explicit failed result does not record usage')
}

for (const applied of allEvents.filter((event) => event.eventType === 'output.applied')) {
  const sameRun = allEvents.filter((event) => event.runId === applied.runId).map((event) => event.eventType)
  assert.ok(sameRun.includes('run.started') && sameRun.includes('run.finished'), 'output.applied must not be orphaned')
}
assert.doesNotMatch(JSON.stringify(allEvents), /inputText|selectionText|clipboardText|outputText|raw.*message/i)

const rust = readFileSync('src-tauri/src/lib.rs', 'utf8')
assert.match(rust, /CREATE TABLE IF NOT EXISTS experience_events/)
assert.match(rust, /PRAGMA user_version = 1/)
assert.match(rust, /experience_journal_append/)
assert.match(rust, /experience_journal_export/)
assert.match(rust, /experience_journal_clear_since/)
assert.match(rust, /experience_journal_clear_all/)
assert.doesNotMatch(rust, /experience_events[\s\S]{0,1000}payload_json/)

const hostActions = readFileSync('src/workspace/launcher/hostActions.ts', 'utf8')
for (const key of ['export', 'clear-today', 'clear-all', 'pause']) {
  assert.match(hostActions, new RegExp(`systemKey: 'host:experience:${key}'`))
}
assert.match(hostActions, /confirmExperienceClear\('today'/)
assert.match(hostActions, /confirmExperienceClear\('all'/)

const experienceTypes = readFileSync('src/workspace/experience/types.ts', 'utf8')
const errorTypeUnion = experienceTypes.match(/export type ExperienceErrorType =([\s\S]*?)\n\n/)?.[1] ?? ''
assert.doesNotMatch(errorTypeUnion, /cancelled/)

const globalSelection = readFileSync('src/components/launcher/useGlobalLauncherSelectionController.ts', 'utf8')
assert.match(
  globalSelection,
  /await showPluginSurfaceWindow\(target\)[\s\S]{0,160}recordSuccessfulSelection\(item\.domainItem\)/,
  'window plugin surfaces record usage through the controller after opening',
)
assert.match(
  globalSelection,
  /await measureLatency\([\s\S]{0,320}recordSuccessfulSelection\(item\.domainItem\)/,
  'embedded plugin surfaces record usage through the controller after opening',
)
assert.match(
  globalSelection,
  /\}\)\(\)\.catch\([\s\S]{0,240}showToast\(/,
  'plugin surface open failures must be handled without recording usage',
)
console.log('self-learning PR1 checks passed')
