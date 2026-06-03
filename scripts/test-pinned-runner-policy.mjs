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
  pinnedRunner: read('src/views/PinnedRunnerView.tsx'),
}

assertHas(files.packageJson, /test:pinned-runner-policy/, 'package.json should expose pinned runner policy verifier')

assertHas(files.pluginTypes, /export\s+type\s+LiveActionCapability/, 'pluginTypes should define LiveActionCapability')
assertHas(files.pluginTypes, /sideEffects:\s*['"]none['"]\s*\|\s*['"]read-only['"]\s*\|\s*['"]writes['"]/, 'LiveActionCapability should classify side effects')
assertHas(files.pluginTypes, /live\??\s*:\s*LiveActionCapability/, 'CommandContribution should expose live capability metadata')
assertHas(files.store, /live\??\s*:\s*LiveActionCapability/, 'legacy ActionDef should expose live capability metadata')
assertHas(files.workspaceTypes, /\|\s*\{\s*type:\s*['"]pinned-action['"];\s*pinnedId:\s*string\s*\}/, 'PanelScope should support pinned-action scope')
assertHas(files.workspaceTypes, /type:\s*['"]panel\.openV2['"][\s\S]*scope\??\s*:\s*PanelScope/, 'panel.openV2 should carry panel scope')
assertHas(files.workspaceTypes, /export\s+type\s+PanelInstanceV2[\s\S]*scope\??\s*:\s*PanelScope/, 'PanelInstanceV2 should preserve panel scope')
assertHas(files.effectRunner, /scope:\s*effect\.scope/, 'effectRunner should store panel.openV2 scope on PanelInstanceV2')

assertHas(files.store, /\bprunePinnedRuntimes\s*:/, 'store should expose a prunePinnedRuntimes action')
assertHas(files.store, /PinnedOutputKind[\s\S]*['"]stale['"]/, 'Pinned output kind should represent stale runner output')
assertHas(files.store, /pruneIdlePinnedRuntimes/, 'store should use pruneIdlePinnedRuntimes for idle timeout and warm limit cleanup')
assertHas(files.pinnedRuntime, /_tombstone|tombstone/, 'activatePinnedRuntime should accept tombstone data')
assertHas(files.pinnedRuntime, /outputSummary[\s\S]*stale|stale[\s\S]*outputSummary/, 'tombstone restore should mark output summary stale instead of restoring full output')

assertHas(files.app, /useEffect[\s\S]*prunePinnedRuntimes/, 'App should schedule idle runtime pruning outside the PinnedRunnerView lifecycle')
assertNotHas(files.pinnedRunner, /setInterval\(\(\)\s*=>\s*prunePinnedRuntimes/, 'PinnedRunnerView should not own the root idle-prune scheduler')
assertHas(files.store, /sideEffects\s*!==\s*['"]writes['"][\s\S]*trigger\s*!==\s*['"]manual['"]|trigger\s*!==\s*['"]manual['"][\s\S]*sideEffects\s*!==\s*['"]writes['"]/, 'writes side-effect commands should default to manual run')
assertHas(files.store, /def\?\.live[\s\S]*autoRun:\s*shouldAutoRunLiveAction/, 'legacy actions should derive autoRun from live capability metadata')
assertHas(files.store, /serializePinnedTombstones[\s\S]*tombstoneTtlDays[\s\S]*disposedAt/, 'persisted tombstones should be pruned by tombstoneTtlDays')

const restoredPreview = restorePinnedFromTombstone({
  id: 'pinned-1',
  kind: 'legacy',
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

assertHas(files.pinnedRunner, /markPinnedOutputStale[\s\S]*outputKind:\s*['"]stale['"]/, 'Manual input or param edits should mark existing output stale')
assertHas(files.pinnedRunner, /onClick=\{\(\)\s*=>\s*updateInputText\(['"]{2}\)\}[\s\S]*title=['"]Clear Input['"]/, 'Clear Input should share the stale-output input update path')
assertHas(files.pinnedRunner, /const\s+canApplyOutput\s*=\s*!!pinned\?\.outputText[\s\S]*pinned\.outputKind\s*!==\s*['"]error['"][\s\S]*pinned\.outputKind\s*!==\s*['"]stale['"]/, 'PinnedRunnerView should not apply empty, error, or stale output')
assertHas(files.pinnedRunner, /isCurrentPinnedRun[\s\S]*pendingRunId\s*!==\s*runId[\s\S]*disposed/, 'disposed or superseded pinned runs should not write stale output')
assertHas(files.pinnedRunner, /import\s+Editor\s+from\s+['"]@monaco-editor\/react['"]/, 'PinnedRunnerView should use Monaco Editor for input/output buffers')
assertHas(files.pinnedRunner, /runtimeRegistry\.registerCodeEditor\([^)]*editorId[^)]*editor/, 'PinnedRunnerView should register pinned input/output editors in the runtime registry')
assertHas(files.pinnedRunner, /path=\{modelId\}/, 'PinnedRunnerView should bind Monaco models to pinned runtime model ids')
assertNotHas(files.pinnedRunner, /<textarea\b/, 'PinnedRunnerView should not render textarea buffers once Monaco runtime buffers exist')
assertHas(files.pinnedRunner, /disabled=\{!canApplyOutput\}/, 'Apply should be disabled for empty or error output')
assertHas(files.pinnedRunner, /applyEffects\(\[\{\s*type:\s*['"]text\.replace['"][\s\S]*target:\s*['"]active-input['"]/, 'Apply should write through the Effect Runner text.replace path')
assertHas(files.pinnedRunner, /applyEffects\(\[\{\s*type:\s*['"]pane\.create['"][\s\S]*text:\s*pinned\.outputText/, 'Send New Pane should write through the Effect Runner pane.create path')
assertHas(files.pinnedRunner, /type:\s*['"]panel\.openV2['"][\s\S]*scope:\s*\{\s*type:\s*['"]pinned-action['"],\s*pinnedId:\s*pinned\.id\s*\}/, 'Custom controls should open a pinned-action scoped panel')
assertNotHas(files.pinnedRunner, /onClick=\{\(\)\s*=>\s*applyOutputToActivePane\(pinned\.outputText\)\}/, 'Apply should not blindly write empty/error output to the active pane')
assertNotHas(files.pinnedRunner, /useWorkspaceStore\(\(s\)\s*=>\s*s\.setActivePaneText\)/, 'PinnedRunnerView should not bypass Effect Runner for Apply')
assertNotHas(files.pinnedRunner, /useWorkspaceStore\(\(s\)\s*=>\s*s\.createPane\)/, 'PinnedRunnerView should not bypass Effect Runner for Send New Pane')

console.log('pinned runner policy checks passed')
