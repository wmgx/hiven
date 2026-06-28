#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function readIfExists(path) {
  const fullPath = join(root, path)
  return existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : ''
}

const files = {
  store: read('src/store.ts'),
  app: read('src/App.tsx'),
  globalLauncherHost: read('src/launcher/hosts/GlobalLauncherHost.tsx'),
  globalLauncherClose: read('src/components/launcher/GlobalLauncherClose.ts'),
  pinnedRuntime: read('src/workspace/pinnedActionRuntime.ts'),
  pinnedFactory: read('src/workspace/pinnedActionFactory.ts'),
  pinnedPluginCommandRunner: read('src/workspace/pinnedPluginCommandRunner.ts'),
}

const allSource = Object.values(files).join('\n')
const failures = []

function check(name, fn) {
  try {
    fn()
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
  }
}

function assertSourceHas(source, pattern, message) {
  assert.match(source, pattern, message)
}

check('Pinned action definitions remain in the app store', () => {
  assertSourceHas(files.store, /(?:export\s+)?type\s+PinnedAction\b|(?:export\s+)?interface\s+PinnedAction\b/, 'store should define PinnedAction')
  for (const field of [
    'id',
    'actionId',
    'title',
    'inputText',
    'outputText',
    'outputKind',
    'params',
    'autoRun',
    'debounceMs',
    'controlsOpen',
  ]) {
    assertSourceHas(files.store, new RegExp(`\\b${field}\\??\\s*:`), `PinnedAction should include ${field}`)
  }
  assertSourceHas(files.store, /\bpinnedActions\s*:\s*PinnedAction\[\]|\bpinnedActions\s*:\s*\[\]/, 'AppState should keep pinnedActions')
  assertSourceHas(files.store, /\bpinPluginCommand\s*:/, 'AppState should expose pinPluginCommand')
  assertSourceHas(files.store, /\bunpinAction\s*:/, 'AppState should expose unpinAction')
  assertSourceHas(files.store, /\breorderPinnedActions\s*:/, 'AppState should expose reorderPinnedActions')
  assertSourceHas(files.store, /pinPluginCommand[\s\S]*(?:find|some)\(|samePinnedPluginCommandIdentity/, 'pinPluginCommand should de-duplicate by command identity')
})

check('High-frequency builtin text tools declare live on-input capability', () => {
  for (const name of ['base64', 'url', 'hash', 'date-time-assistant', 'json', 'count']) {
    const src = readIfExists(`src/plugins/${name}/index.ts`)
    assert.ok(src, `${name} plugin package should exist`)
    assert.match(src, /live:\s*\{\s*live:\s*\{/, `${name} should declare a live capability`)
    assert.match(src, /enabled:\s*true/, `${name} should opt into live running`)
    assert.match(src, /trigger:\s*'on-input'/, `${name} should update from pinned input changes`)
    assert.match(src, /sideEffects:\s*'none'/, `${name} should be side-effect free in pinned runner`)
  }
})

check('Retired main-window pinned runner shell is gone', () => {
  assert.equal(existsSync(join(root, 'src/components/Sidebar.tsx')), false, 'Sidebar should be removed with the retired main window')
  assert.equal(existsSync(join(root, 'src/views/PinnedRunnerView.tsx')), false, 'PinnedRunnerView should be removed with the retired main window')
  assert.doesNotMatch(files.store, /export\s+type\s+ViewId\b|\bactiveView\b|\bsetActiveView\b/, 'store should not keep the retired ViewId navigation model')
  assert.doesNotMatch(files.app, /PinnedRunnerView|<Sidebar\b|function ViewContent/, 'App should not mount retired pinned runner navigation')
  assert.doesNotMatch(files.globalLauncherHost, /setActiveView/, 'GlobalLauncherHost should not switch retired workspace views')
  assertSourceHas(files.globalLauncherHost, /finishPinnedLauncherSelection/, 'GlobalLauncherHost should delegate pinned action activation from search results')
  assertSourceHas(files.globalLauncherClose, /openPinnedAction\(pinnedId\)/, 'GlobalLauncher close helper should activate pinned actions from search results')
})

check('Pinned runtime state, tombstones, and idle disposal remain modeled', () => {
  assertSourceHas(allSource, /(?:export\s+)?type\s+PinnedRuntime\b|(?:export\s+)?interface\s+PinnedRuntime\b/, 'code should define PinnedRuntime')
  assertSourceHas(allSource, /(?:export\s+)?type\s+PinnedTombstone\b|(?:export\s+)?interface\s+PinnedTombstone\b/, 'code should define PinnedTombstone')
  assertSourceHas(allSource, /\bidleTimeoutMs\b/, 'runtime should model idleTimeoutMs')
  assertSourceHas(allSource, /\bmaxWarmRuntimes\b/, 'runtime should model maxWarmRuntimes')
  assertSourceHas(allSource, /activatePinnedAction|openPinnedAction|ensurePinnedRuntime/i, 'runtime should activate or lazily create pinned runners')
  assertSourceHas(allSource, /disposePinnedRuntime|releasePinnedRuntime|tombstonePinnedRuntime/i, 'runtime should dispose/release idle pinned runners')
  assertSourceHas(allSource, /outputSummary[\s\S]*(?:stale|generatedAt|preview)|(?:stale|generatedAt|preview)[\s\S]*outputSummary/, 'tombstone should keep outputSummary instead of full outputText')
  assertSourceHas(files.pinnedPluginCommandRunner, /runPinnedPluginCommandToPatch/, 'pinned plugin commands should still have a non-UI runner')
  assertSourceHas(files.pinnedFactory, /autoRun:\s*shouldAutoRunLiveAction\(command\.live\)/, 'pinned plugin commands should still derive autoRun from live capability metadata')
})

if (failures.length > 0) {
  console.error(`pinned action live runner checks failed (${failures.length}):`)
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('pinned action live runner checks passed')
