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
  commandPalette: read('src/components/CommandPalette.tsx'),
  pinnedRunner: read('src/views/PinnedRunnerView.tsx'),
}

assertHas(files.packageJson, /test:pinned-plugin-command/, 'package.json should expose pinned plugin command verifier')

assertHas(files.store, /PinnedActionKind\s*=\s*['"]legacy['"]\s*\|\s*['"]plugin-command['"]|PinnedActionKind\s*=\s*['"]plugin-command['"]\s*\|\s*['"]legacy['"]/, 'PinnedAction should distinguish legacy and plugin command sources')
assertHas(files.store, /\bpinPluginCommand\s*:/, 'store should expose pinPluginCommand')
assertHas(files.store, /pluginId\??\s*:\s*string/, 'PinnedAction should remember pluginId for plugin commands')
assertHas(files.store, /isDev\??\s*:\s*boolean/, 'PinnedAction should remember dev/prod source for plugin commands')

assertHas(files.commandPalette, /pinPluginCommand/, 'CommandPalette should pin plugin commands')
assertNotHas(files.commandPalette, /if\s*\(\s*item\.kind\s*!==\s*['"]legacy['"]\s*\)\s*return/, 'CommandPalette pin handler should not ignore plugin items')
assertHas(files.commandPalette, /\{item\.kind === ['"]legacy['"][\s\S]*<button[\s\S]*Pin|<button[\s\S]*Pin[\s\S]*\}/, 'ActionItem should render a pin button for plugin items too')

assertHas(files.pinnedRunner, /pluginRegistry\.resolveCommand/, 'PinnedRunnerView should resolve plugin commands from the plugin registry')
assertHas(files.pinnedRunner, /pinned\?\.kind\s*===\s*['"]plugin-command['"]/, 'PinnedRunnerView should branch for plugin-command pinned actions')
assertHas(files.pinnedRunner, /buildPinnedPluginInputs[\s\S]*kind:\s*['"]text['"][\s\S]*inputText/, 'PinnedRunnerView should run plugin commands with the pinned input buffer')
assertHas(files.pinnedRunner, /text\.replace[\s\S]*outputText|outputText[\s\S]*text\.replace/, 'PinnedRunnerView should map text.replace effects into runner output')
assertNotHas(files.pinnedRunner, /disabled=\{running\s*\|\|\s*!action\}/, 'Run Now should not disable plugin-command pinned actions')

console.log('pinned plugin command checks passed')
