#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')

assert.equal(
  packageJson.scripts?.['test:global-launcher-workflow-tab-behavior'],
  'node scripts/test-global-launcher-workflow-tab-behavior.mjs',
  'package.json must expose test:global-launcher-workflow-tab-behavior',
)
assert.match(
  refactorSuite,
  /test:global-launcher-workflow-tab-behavior/,
  'refactor suite must include workflow Tab expansion behavior coverage',
)

function loadModule(path, globals = {}) {
  let src = readFileSync(path, 'utf8')
  src = src.replace(/import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g, '')
  src = src.replace(/import\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g, '')
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

const { handleGlobalLauncherKeyDown } = loadModule('src/components/launcher/GlobalLauncherKeyboard.ts', {
  shouldCustomizeParams: (metaKey, ctrlKey) => Boolean(metaKey || ctrlKey),
  shouldIgnoreImeKeyDown: () => false,
})
const { isWorkflowObjectLauncherItem } = loadModule('src/components/launcher/GlobalLauncherSelection.ts', {
  pluginRegistry: {},
  getPluginPermissionSnapshot: () => ({}),
  missingPluginPermissions: () => [],
  restartPluginBackground: () => undefined,
  supportsDefaultParamRun: () => true,
})

function makeEvent(key, overrides = {}) {
  const calls = { prevented: 0, stopped: 0 }
  return {
    calls,
    event: {
      key,
      metaKey: false,
      ctrlKey: false,
      defaultPrevented: false,
      preventDefault: () => { calls.prevented += 1 },
      stopPropagation: () => { calls.stopped += 1 },
      ...overrides,
    },
  }
}

function makeArgs(overrides = {}) {
  const calls = {
    selectedIndexes: [],
    selectedItems: [],
    closed: 0,
  }
  return {
    calls,
    args: {
      isImeComposingRef: { current: false },
      launcherSettingsTarget: null,
      closeSettingsDialog: () => undefined,
      focusSearchInputAfterBack: () => undefined,
      surfaceFrame: null,
      leaveSurface: () => undefined,
      itemPermissionFrame: null,
      cancelItemPermissionPrompt: () => undefined,
      controllerState: null,
      controllerRef: { current: null },
      resultSelectedIndex: 0,
      setResultSelectedIndex: () => undefined,
      toggleResultChoice: () => undefined,
      closeLauncher: () => { calls.closed += 1 },
      isKeyboardNavRef: { current: false },
      visibleFilteredLength: 3,
      setSelectedIndex: (updater) => { calls.selectedIndexes.push(updater) },
      selectedItem: undefined,
      isWorkflowObjectLauncherItem,
      selectItem: (item, customizeParams) => { calls.selectedItems.push({ item, customizeParams }) },
      ...overrides,
    },
  }
}

const workflowObjectItem = {
  kind: 'domain',
  domainItem: {
    systemKey: 'workflow:object:context:selected-text',
    metadata: { kind: 'workflow-object', objectId: 'context:selected-text', objectType: 'text' },
  },
}
const legacyWorkflowObjectItem = {
  kind: 'domain',
  domainItem: {
    systemKey: 'workflow:object:legacy',
    metadata: {},
  },
}
const normalDomainItem = {
  kind: 'domain',
  domainItem: {
    systemKey: 'host:open-editor',
    metadata: { kind: 'host-action' },
  },
}
const nonDomainItem = {
  kind: 'plugin',
  domainItem: {
    systemKey: 'workflow:object:not-domain',
    metadata: { kind: 'workflow-object' },
  },
}

assert.equal(isWorkflowObjectLauncherItem(workflowObjectItem), true, 'metadata workflow objects must be recognized')
assert.equal(isWorkflowObjectLauncherItem(legacyWorkflowObjectItem), true, 'legacy workflow object system keys must remain recognized')
assert.equal(isWorkflowObjectLauncherItem(normalDomainItem), false, 'normal domain actions must not be recognized as workflow objects')
assert.equal(isWorkflowObjectLauncherItem(nonDomainItem), false, 'non-domain rows must not be recognized as workflow objects')

{
  const { event, calls: eventCalls } = makeEvent('Tab')
  const { args, calls } = makeArgs({ selectedItem: workflowObjectItem })
  handleGlobalLauncherKeyDown({ event, ...args })
  assert.equal(eventCalls.prevented, 1, 'Tab on workflow object must prevent browser focus traversal')
  assert.deepEqual(JSON.parse(JSON.stringify(calls.selectedItems)), [{ item: workflowObjectItem }], 'Tab on workflow object must select the item to expand actions')
}

{
  const { event, calls: eventCalls } = makeEvent('Tab')
  const { args, calls } = makeArgs({ selectedItem: normalDomainItem })
  handleGlobalLauncherKeyDown({ event, ...args })
  assert.equal(eventCalls.prevented, 0, 'Tab on normal launcher item must not hijack focus')
  assert.deepEqual(calls.selectedItems, [], 'Tab on normal launcher item must not execute/select the item')
}

{
  const { event, calls: eventCalls } = makeEvent('Tab')
  const { args, calls } = makeArgs({ selectedItem: workflowObjectItem, controllerState: { frames: [{ kind: 'root' }, { kind: 'result', output: { choices: [] } }], busy: false } })
  handleGlobalLauncherKeyDown({ event, ...args })
  assert.equal(eventCalls.prevented, 0, 'Tab inside result frames must not re-expand the underlying workflow object')
  assert.deepEqual(calls.selectedItems, [], 'Tab inside result frames must be ignored by workflow object expansion')
}

{
  const { event, calls: eventCalls } = makeEvent('Enter', { metaKey: true })
  const { args, calls } = makeArgs({ selectedItem: normalDomainItem })
  handleGlobalLauncherKeyDown({ event, ...args })
  assert.equal(eventCalls.prevented, 1, 'Enter must still execute normal launcher items')
  assert.deepEqual(JSON.parse(JSON.stringify(calls.selectedItems)), [{ item: normalDomainItem, customizeParams: true }], 'Enter must preserve customize-params behavior for normal items')
}

console.log('global launcher workflow Tab behavior checks passed')
