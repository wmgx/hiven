import fs from 'node:fs'
import assert from 'node:assert/strict'
import { pinnedParamsFingerprint, samePinnedParams, samePinnedPluginCommandIdentity } from '../src/workspace/pinnedActionIdentity.ts'
import { stampPluginCommandEffects } from '../src/workspace/pluginCommandRunner.ts'

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
  pinnedPluginCommandRunner: read('src/workspace/pinnedPluginCommandRunner.ts'),
}

const unsupportedPinnedEffectPattern = /type:\s*['"](pane\.setRenderer|panel\.openV2|panel\.closeV2|pane\.close)['"]/
for (const pluginFile of fs.readdirSync('src/plugins')
  .flatMap((dir) => [`src/plugins/${dir}/index.ts`, `src/plugins/${dir}/index.tsx`])
  .filter((file) => fs.existsSync(file))) {
  const source = read(pluginFile)
  if (unsupportedPinnedEffectPattern.test(source)) {
    assertHas(source, /live:\s*\{\s*pinnable:\s*false\s*\}/, `${pluginFile} emits workspace-only effects and should opt out of pinning`)
  }
}

assertHas(files.packageJson, /test:pinned-plugin-command/, 'package.json should expose pinned plugin command verifier')

assertHas(files.store, /PinnedActionKind\s*=\s*['"]plugin-command['"]/, 'PinnedAction kind should be plugin-command')
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
assertHas(files.commandPalette, /data-testid="command-palette-pin-action"[\s\S]*<Pin/, 'ActionItem should render a pin button for plugin items')
assertHas(files.commandPalette, /live\?\.pinnable\s*!==\s*false/, 'CommandPalette should hide the pin affordance when a plugin command opts out')
assertHas(files.pinnedRunner, /pluginRegistry\.resolveCommand/, 'PinnedRunnerView should resolve plugin commands from the plugin registry')
assertHas(files.pinnedRunner, /runPinnedPluginCommandToPatch[\s\S]*pinned,[\s\S]*params/, 'PinnedRunnerView should run plugin commands through the tested pinned command runner')

assertHas(files.pinnedPluginCommandRunner, /runTextPluginCommand[\s\S]*inputText:\s*options\.pinned\.inputText/, 'pinned command runner should run plugin commands with the pinned input buffer')
assertHas(files.pluginCommandRunner, /buildTextPluginInputs[\s\S]*kind:\s*['"]text['"][\s\S]*inputText/, 'plugin command runner should resolve pinned text input slots')
assertHas(files.pluginCommandRunner, /text\.replace[\s\S]*textReplace\.text/, 'plugin command runner should map text.replace effects into runner output')
assertNotHas(files.pinnedRunner, /disabled=\{running\s*\|\|\s*!action\}/, 'Run Now should not disable plugin-command pinned actions')
assertHas(files.pinnedPluginCommandRunner, /isDev:\s*options\.pinned\.isDev/, 'pinned command runner should preserve dev command context when normalizing plugin command effects')

const stampedEffects = stampPluginCommandEffects([
  { type: 'pane.setRenderer', paneId: 'pane-1', renderer: 'dev-plugin.renderer', inputs: {} },
  { type: 'panel.openV2', panelId: 'dev-plugin.panel' },
  { type: 'text.replace', target: 'active-input', text: 'ok' },
], { isDev: true, ownerPluginId: 'dev-plugin' })

assert.equal(stampedEffects[0]._isDev, true, 'dev renderer effects should keep dev registry context')
assert.equal(stampedEffects[0].ownerPluginId, 'dev-plugin', 'dev renderer effects should keep owner plugin id')
assert.equal(stampedEffects[1]._isDev, true, 'dev panel effects should keep dev registry context')
assert.equal(stampedEffects[1].ownerPluginId, 'dev-plugin', 'dev panel effects should keep owner plugin id')
assert.equal(stampedEffects[2]._isDev, undefined, 'plain text effects should not gain renderer/panel dev metadata')

console.log('pinned plugin command checks passed')
