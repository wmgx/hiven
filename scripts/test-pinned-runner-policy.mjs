import fs from 'node:fs'
import assert from 'node:assert/strict'

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
  store: read('src/store.ts'),
  pluginTypes: read('src/workspace/pluginTypes.ts'),
  workspaceTypes: read('src/workspace/types.ts'),
  pinnedRuntime: read('src/workspace/pinnedActionRuntime.ts'),
  pinnedRunner: read('src/views/PinnedRunnerView.tsx'),
}

assertHas(files.packageJson, /test:pinned-runner-policy/, 'package.json should expose pinned runner policy verifier')

assertHas(files.pluginTypes, /export\s+type\s+LiveActionCapability/, 'pluginTypes should define LiveActionCapability')
assertHas(files.pluginTypes, /sideEffects:\s*['"]none['"]\s*\|\s*['"]read-only['"]\s*\|\s*['"]writes['"]/, 'LiveActionCapability should classify side effects')
assertHas(files.pluginTypes, /live\??\s*:\s*LiveActionCapability/, 'CommandContribution should expose live capability metadata')
assertHas(files.workspaceTypes, /\|\s*\{\s*type:\s*['"]pinned-action['"];\s*pinnedId:\s*string\s*\}/, 'PanelScope should support pinned-action scope')

assertHas(files.store, /\bprunePinnedRuntimes\s*:/, 'store should expose a prunePinnedRuntimes action')
assertHas(files.store, /pruneIdlePinnedRuntimes/, 'store should use pruneIdlePinnedRuntimes for idle timeout and warm limit cleanup')
assertHas(files.pinnedRuntime, /_tombstone|tombstone/, 'activatePinnedRuntime should accept tombstone data')
assertHas(files.pinnedRuntime, /outputSummary[\s\S]*stale|stale[\s\S]*outputSummary/, 'tombstone restore should mark output summary stale instead of restoring full output')

assertHas(files.pinnedRunner, /useEffect[\s\S]*prunePinnedRuntimes/, 'PinnedRunnerView should schedule idle runtime pruning')
assertHas(files.store, /sideEffects\s*!==\s*['"]writes['"][\s\S]*trigger\s*!==\s*['"]manual['"]|trigger\s*!==\s*['"]manual['"][\s\S]*sideEffects\s*!==\s*['"]writes['"]/, 'writes side-effect commands should default to manual run')
assertHas(files.pinnedRunner, /const\s+canApplyOutput\s*=\s*!!pinned\?\.outputText\s*&&\s*pinned\.outputKind\s*!==\s*['"]error['"]/, 'PinnedRunnerView should derive apply eligibility from non-empty non-error output')
assertHas(files.pinnedRunner, /disabled=\{!canApplyOutput\}/, 'Apply should be disabled for empty or error output')
assertNotHas(files.pinnedRunner, /onClick=\{\(\)\s*=>\s*applyOutputToActivePane\(pinned\.outputText\)\}/, 'Apply should not blindly write empty/error output to the active pane')

console.log('pinned runner policy checks passed')
