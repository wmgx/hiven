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
  sidebar: read('src/components/Sidebar.tsx'),
  app: read('src/App.tsx'),
  pinnedRunnerView: readIfExists('src/views/PinnedRunnerView.tsx'),
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

check('Milestone A models persistent pinned action definitions in the app store', () => {
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

check('Milestone A adds a sidebar Pinned section with entries that open existing pinned actions', () => {
  assertSourceHas(files.sidebar, /\bpinnedActions\b/, 'Sidebar should read pinnedActions from the store')
  assertSourceHas(files.sidebar, /Pinned|pinned/i, 'Sidebar should render a Pinned section')
  assertSourceHas(files.sidebar, /pinnedActions\.map\(|\.map\([^)]*pinned/i, 'Sidebar should render one entry per pinned action')
  assertSourceHas(files.sidebar, /setActivePinnedAction|openPinnedAction|activatePinnedAction|activeView:\s*['"]pinned/, 'Sidebar pinned entry should open/focus its runner view')
  assertSourceHas(files.sidebar, /resolveIcon\([^)]*pinned\.icon/, 'Sidebar pinned entry should resolve icon names instead of rendering raw icon strings')
})

check('Milestone B wires a PinnedRunnerView into app navigation', () => {
  assertSourceHas(files.store, /ViewId[\s\S]*['"]pinned(?:-runner|-action)?['"]/, 'ViewId should include a pinned runner view')
  assertSourceHas(files.app, /PinnedRunnerView/, 'App should import/render PinnedRunnerView')
  assertSourceHas(files.app, /case\s+['"]pinned(?:-runner|-action)?['"]/, 'ViewContent should route to the pinned runner view')
  assert.ok(files.pinnedRunnerView, 'src/views/PinnedRunnerView.tsx should exist')
})

check('Milestone B implements the live runner base controls and isolated input/output buffers', () => {
  assertSourceHas(files.pinnedRunnerView, /inputText[\s\S]*outputText|outputText[\s\S]*inputText/, 'PinnedRunnerView should render isolated input and output buffers')
  assertSourceHas(files.pinnedRunnerView, /readOnly:\s*true|readOnly=\{true\}|readonly/i, 'PinnedRunnerView output editor should be read-only')
  assertSourceHas(files.pinnedRunnerView, /Run Now|runNow|manualRun|runPinnedAction/i, 'PinnedRunnerView should support manual run')
  assertSourceHas(files.pinnedRunnerView, /Copy Output|copyOutput|writeText/i, 'PinnedRunnerView should support Copy Output')
  assertSourceHas(files.pinnedRunnerView, /Clear Input|clearInput/i, 'PinnedRunnerView should support Clear Input')
  assertSourceHas(files.pinnedRunnerView, /Clear Output|clearOutput/i, 'PinnedRunnerView should support Clear Output')
  assert.doesNotMatch(files.pinnedRunnerView, /setEditorText\(|setActivePaneText\([^)]*outputText/, 'PinnedRunnerView should not automatically write output to the main editor')
})

check('Milestone C models lazy runtime state, tombstones, and idle disposal', () => {
  assertSourceHas(allSource, /(?:export\s+)?type\s+PinnedRuntime\b|(?:export\s+)?interface\s+PinnedRuntime\b/, 'code should define PinnedRuntime')
  assertSourceHas(allSource, /(?:export\s+)?type\s+PinnedTombstone\b|(?:export\s+)?interface\s+PinnedTombstone\b/, 'code should define PinnedTombstone')
  assertSourceHas(allSource, /\bidleTimeoutMs\b/, 'runtime should model idleTimeoutMs')
  assertSourceHas(allSource, /\bmaxWarmRuntimes\b/, 'runtime should model maxWarmRuntimes')
  assertSourceHas(allSource, /activatePinnedAction|openPinnedAction|ensurePinnedRuntime/i, 'runtime should activate or lazily create pinned runners')
  assertSourceHas(allSource, /disposePinnedRuntime|releasePinnedRuntime|tombstonePinnedRuntime/i, 'runtime should dispose/release idle pinned runners')
  assertSourceHas(allSource, /outputSummary[\s\S]*(?:stale|generatedAt|preview)|(?:stale|generatedAt|preview)[\s\S]*outputSummary/, 'tombstone should keep outputSummary instead of full outputText')
})

if (failures.length > 0) {
  console.error(`pinned action live runner checks failed (${failures.length}):`)
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('pinned action live runner checks passed')
