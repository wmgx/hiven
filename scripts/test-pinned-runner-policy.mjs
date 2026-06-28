import fs from 'node:fs'
import assert from 'node:assert/strict'
import { restorePinnedFromTombstone } from '../src/workspace/pinnedActionRuntime.ts'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function assertHas(source, pattern, message) {
  assert.match(source, pattern, message)
}

function assertNotHas(source, pattern, message) {
  assert.doesNotMatch(source, pattern, message)
}

const files = {
  packageJson: read('package.json'),
  app: read('src/App.tsx'),
  store: read('src/store.ts'),
  pluginTypes: read('src/workspace/pluginTypes.ts'),
  workspaceTypes: read('src/workspace/types.ts'),
  effectRunner: read('src/workspace/effectRunner.ts'),
  pinnedRuntime: read('src/workspace/pinnedActionRuntime.ts'),
  pinnedFactory: read('src/workspace/pinnedActionFactory.ts'),
  pinnedPluginCommandRunner: read('src/workspace/pinnedPluginCommandRunner.ts'),
}

assertHas(files.packageJson, /test:pinned-runner-policy/, 'package.json should expose pinned runner policy verifier')

assertHas(files.pluginTypes, /export\s+type\s+LiveActionCapability/, 'pluginTypes should define LiveActionCapability')
assertHas(files.pluginTypes, /sideEffects:\s*['"]none['"]\s*\|\s*['"]read-only['"]\s*\|\s*['"]writes['"]/, 'LiveActionCapability should classify side effects')
assertHas(files.pluginTypes, /live\??\s*:\s*LiveActionCapability/, 'CommandContribution should expose live capability metadata')
assertHas(files.store, /live\??\s*:\s*LiveActionCapability/, 'PinnedPluginCommandInput should carry live capability metadata')
assertHas(files.workspaceTypes, /\|\s*\{\s*type:\s*['"]pinned-action['"];\s*pinnedId:\s*string\s*\}/, 'PanelScope should support pinned-action scope')
assertHas(files.workspaceTypes, /type:\s*['"]panel\.openV2['"][\s\S]*scope\??\s*:\s*PanelScope/, 'panel.openV2 should carry panel scope')
assertHas(files.workspaceTypes, /export\s+type\s+PanelInstanceV2[\s\S]*scope\??\s*:\s*PanelScope/, 'PanelInstanceV2 should preserve panel scope')
assertHas(files.effectRunner, /scope:\s*effect\.scope/, 'effectRunner should store panel.openV2 scope on PanelInstanceV2')

assertHas(files.store, /\bprunePinnedRuntimes\s*:/, 'store should expose a prunePinnedRuntimes action')
assertHas(files.store, /PinnedOutputKind[\s\S]*['"]stale['"]/, 'Pinned output kind should represent stale runner output')
assertHas(files.store, /pruneIdlePinnedRuntimes/, 'store should use pruneIdlePinnedRuntimes for idle timeout and warm limit cleanup')
assertHas(files.pinnedRuntime, /_tombstone|tombstone/, 'activatePinnedRuntime should accept tombstone data')
assertHas(files.pinnedRuntime, /outputSummary[\s\S]*stale|stale[\s\S]*outputSummary/, 'tombstone restore should mark output summary stale instead of restoring full output')

assertHas(files.app, /useEffect[\s\S]*prunePinnedRuntimes/, 'App should schedule idle runtime pruning outside any pinned runner UI lifecycle')
assert.equal(fs.existsSync('src/views/PinnedRunnerView.tsx'), false, 'PinnedRunnerView should be retired with the main-window navigation shell')
assert.equal(fs.existsSync('src/components/Sidebar.tsx'), false, 'Sidebar should be retired with the main-window navigation shell')
assertNotHas(files.store, /export\s+type\s+ViewId\b|\bactiveView\b|\bsetActiveView\b/, 'Pinned runtime state must not reintroduce ViewId navigation')

assertHas(files.pinnedFactory, /sideEffects\s*!==\s*['"]writes['"][\s\S]*trigger\s*!==\s*['"]manual['"]|trigger\s*!==\s*['"]manual['"][\s\S]*sideEffects\s*!==\s*['"]writes['"]/, 'writes side-effect commands should default to manual run')
assertHas(files.pinnedFactory, /autoRun:\s*shouldAutoRunLiveAction\(command\.live\)/, 'pinned plugin commands should derive autoRun from live capability metadata')
assertHas(files.store, /serializePinnedTombstones[\s\S]*tombstoneTtlDays[\s\S]*disposedAt/, 'persisted tombstones should be pruned by tombstoneTtlDays')
assertHas(files.store, /activatePinnedAction:[\s\S]*activePinnedActionId:\s*pinnedId[\s\S]*activatePinnedRuntime/, 'pinned action activation should stay in the runtime layer')
assertHas(files.pinnedPluginCommandRunner, /runPinnedPluginCommandToPatch[\s\S]*runTextPluginCommand/, 'pinned plugin commands should still run through the non-UI runner')
assertHas(files.pinnedPluginCommandRunner, /runPinnedLauncherItemToPatch/, 'pinned launcher items should still run through the non-UI runner')

const restoredPreview = restorePinnedFromTombstone({
  id: 'pinned-1',
  kind: 'plugin-command',
  actionId: 'demo',
  title: 'Demo',
  inputText: '',
  outputText: '',
  outputKind: 'text',
  params: {},
  autoRun: false,
  debounceMs: 300,
  controlsOpen: false,
}, {
  pinnedId: 'pinned-1',
  actionId: 'demo',
  inputText: 'old input',
  params: {},
  autoRun: false,
  debounceMs: 300,
  controlsOpen: false,
  outputSummary: {
    kind: 'text',
    preview: 'old generated output',
    generatedAt: 100,
  },
  disposedAt: 200,
  reason: 'idle-timeout',
})
assert.equal(restoredPreview.outputKind, 'stale', 'restored tombstone previews should be stale so Apply remains disabled')

console.log('pinned runner policy checks passed')
