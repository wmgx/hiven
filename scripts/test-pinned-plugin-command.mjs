import fs from 'node:fs'
import assert from 'node:assert/strict'
import { pinnedParamsFingerprint, samePinnedParams, samePinnedPluginCommandIdentity } from '../src/workspace/pinnedActionIdentity.ts'

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
  commandPalette: read('src/components/CommandPalette.tsx'),
  pinnedRunner: read('src/views/PinnedRunnerView.tsx'),
  pluginCommandRunner: read('src/workspace/pluginCommandRunner.ts'),
}

assertHas(files.packageJson, /test:pinned-plugin-command/, 'package.json should expose pinned plugin command verifier')

assertHas(files.store, /PinnedActionKind\s*=\s*['"]legacy['"]\s*\|\s*['"]plugin-command['"]|PinnedActionKind\s*=\s*['"]plugin-command['"]\s*\|\s*['"]legacy['"]/, 'PinnedAction should distinguish legacy and plugin command sources')
assertHas(files.store, /\bpinPluginCommand\s*:/, 'store should expose pinPluginCommand')
assertHas(files.store, /pluginId\??\s*:\s*string/, 'PinnedAction should remember pluginId for plugin commands')
assertHas(files.store, /isDev\??\s*:\s*boolean/, 'PinnedAction should remember dev/prod source for plugin commands')
assertHas(files.store, /samePinnedPluginCommandIdentity/, 'plugin command pin identity should include params')
assert.ok(samePinnedParams({ mode: 'encode', flags: { trim: true, sort: 'asc' } }, { flags: { sort: 'asc', trim: true }, mode: 'encode' }), 'pinned params fingerprint should be stable across object key order')
assert.notEqual(pinnedParamsFingerprint({ mode: 'encode' }), pinnedParamsFingerprint({ mode: 'decode' }), 'different plugin params should create distinct pinned identities')
const pinnedCommand = { kind: 'plugin-command', actionId: 'tools.transform', pluginId: 'tools', isDev: false, params: { mode: 'encode', flags: { trim: true, sort: 'asc' } } }
assert.equal(samePinnedPluginCommandIdentity(pinnedCommand, { ...pinnedCommand, params: { flags: { sort: 'asc', trim: true }, mode: 'encode' } }), true, 'same plugin command params should focus an existing pinned action')
assert.equal(samePinnedPluginCommandIdentity(pinnedCommand, { ...pinnedCommand, params: { mode: 'decode', flags: { trim: true, sort: 'asc' } } }), false, 'different plugin command params should create another pinned action')

assertHas(files.commandPalette, /pinPluginCommand/, 'CommandPalette should pin plugin commands')
assertNotHas(files.commandPalette, /if\s*\(\s*item\.kind\s*!==\s*['"]legacy['"]\s*\)\s*return/, 'CommandPalette pin handler should not ignore plugin items')
assertHas(files.commandPalette, /\{item\.kind === ['"]legacy['"][\s\S]*<button[\s\S]*Pin|<button[\s\S]*Pin[\s\S]*\}/, 'ActionItem should render a pin button for plugin items too')

assertHas(files.pinnedRunner, /pluginRegistry\.resolveCommand/, 'PinnedRunnerView should resolve plugin commands from the plugin registry')
assertHas(files.pinnedRunner, /pinned\?\.kind\s*===\s*['"]plugin-command['"]/, 'PinnedRunnerView should branch for plugin-command pinned actions')
assertHas(files.pinnedRunner, /runTextPluginCommand[\s\S]*inputText:\s*pinned\.inputText/, 'PinnedRunnerView should run plugin commands with the pinned input buffer')
assertHas(files.pluginCommandRunner, /buildTextPluginInputs[\s\S]*kind:\s*['"]text['"][\s\S]*inputText/, 'plugin command runner should resolve pinned text input slots')
assertHas(files.pluginCommandRunner, /text\.replace[\s\S]*textReplace\.text/, 'plugin command runner should map text.replace effects into runner output')
assertNotHas(files.pinnedRunner, /disabled=\{running\s*\|\|\s*!action\}/, 'Run Now should not disable plugin-command pinned actions')

console.log('pinned plugin command checks passed')
