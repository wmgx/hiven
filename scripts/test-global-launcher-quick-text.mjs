#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

const globalLauncher = read('src/components/GlobalLauncher.tsx')
const globalLauncherHost = read('src/launcher/hosts/GlobalLauncherHost.tsx')
const globalLauncherFrames = read('src/components/launcher/GlobalLauncherFrames.tsx')
const globalLauncherCollectInputFrame = read('src/components/launcher/GlobalLauncherCollectInputFrame.tsx')
const globalLauncherKeyboard = read('src/components/launcher/GlobalLauncherKeyboard.ts')
const globalLauncherSelection = read('src/components/launcher/GlobalLauncherSelection.ts')
const globalLauncherHostLifecycle = read('src/components/launcher/GlobalLauncherHostLifecycle.ts')
const launcherSession = read('src/workspace/launcher/useLauncherSession.ts')
const commandPalette = read('src/components/CommandPalette.tsx')
const app = read('src/App.tsx')
const lineToolsPlugin = read('src/plugins/line-tools/index.ts')
const launcherRegistry = read('src/workspace/launcher/registry.ts')
const launcherController = read('src/workspace/launcher/controller.ts')
const launcherTypes = read('src/workspace/launcher/types.ts')
const toolAdapter = read('src/workspace/launcher/toolAdapter.ts')
const packageJson = read('package.json')

assert.match(packageJson, /test:global-launcher-quick-text/, 'package.json should expose the quick text verifier')
assert.match(lineToolsPlugin, /tools:\s*\[/, 'quick text style tools should be contributed through the tool-first launcher API')
for (const id of [
  'line-tools.sort',
  'line-tools.dedup',
  'line-tools.reverse',
  'line-tools.remove-blank-lines',
  'line-tools.join',
]) {
  const escapedId = id.replace(/\./g, '\\.')
  assert.match(
    lineToolsPlugin,
    new RegExp(`id:\\s*['"]${escapedId}['"]`),
    `${id} tool must be declared in line-tools plugin`,
  )
  assert.match(
    lineToolsPlugin,
    new RegExp(`id:\\s*['"]${escapedId}['"][\\s\\S]{0,1800}surfaces:\\s*\\{[\\s\\S]{0,100}launcher:\\s*true`),
    `${id} should be exposed to the launcher`,
  )
}
assert.match(
  lineToolsPlugin,
  /id:\s*['"]line-tools\.trim-whitespace['"][\s\S]{0,600}surfaces:\s*\{[\s\S]{0,100}launcher:\s*true/,
  'trim whitespace should be exposed in the launcher',
)
assert.match(
  lineToolsPlugin,
  /id:\s*['"]line-tools\.reverse-text['"][\s\S]{0,600}surfaces:\s*\{[\s\S]{0,100}launcher:\s*true/,
  'reverse text should be exposed in the launcher',
)
assert.match(lineToolsPlugin, /inputPolicy:\s*\{\s*mode:\s*['"]auto['"]\s*\}/, 'reverse should use the shared auto input policy')
assert.match(lineToolsPlugin, /id:\s*['"]line-tools\.reverse['"][\s\S]{0,360}ctx\.output\.text\(reverseLines/, 'reverse launcher tool should output reversed text')
assert.doesNotMatch(launcherRegistry, /adaptCommandToLauncherItem|canAdaptCommandToLauncher|commandAdapter/, 'launcher registry should not use a command adapter')
assert.doesNotMatch(launcherRegistry, /def\.commands|getAllCommands/, 'launcher registry should not scan plugin commands')
assert.match(globalLauncher, /GlobalLauncherHost/, 'GlobalLauncher should remain a thin host wrapper')
assert.match(globalLauncherHost, /useLauncherSession\(\{[\s\S]*hostId:\s*['"]global-launcher['"]/, 'GlobalLauncherHost should source quick text style tools through the shared global launcher session')
assert.match(launcherSession, /collectStaticCandidates\(normalizedHostId\)/, 'shared launcher session should source static candidates from the launcher registry')
assert.match(globalLauncherKeyboard, /controllerRef\.current\?\.submitInput\?\.\(\)/, 'GlobalLauncher keyboard should submit collected input through LauncherController')
assert.match(globalLauncherSelection, /controller\.selectItem\(item/, 'GlobalLauncher selection should execute domain items through LauncherController')
assert.match(globalLauncherFrames, /topFrame\?\.kind === ['"]result['"]/, 'GlobalLauncher frames should render controller output result frames')
assert.match(globalLauncherHostLifecycle, /controllerRef\.current\?\.previewInput\?\.\(\)/, 'GlobalLauncher lifecycle helper should request live previews while manual input changes')
assert.match(globalLauncherCollectInputFrame, /previewChoices\s*=\s*frame\.previewOutput\?\.choices/, 'GlobalLauncher collect-input frame should render controller preview output inside the manual input frame')
assert.match(globalLauncherCollectInputFrame, /previewChoices\.length[\s\S]*palette\.enterToCopy/, 'GlobalLauncher collect-input frame should show Enter-to-copy wording when a live preview is available')
assert.match(launcherController, /shouldCollectTextInput[\s\S]*surfaceId\s*===\s*['"]global-launcher['"][\s\S]*item\.inputPolicy\s*!=\s*null/, 'global launcher text tools should enter the shared manual input flow')
assert.match(launcherController, /submitParams[\s\S]*shouldCollectTextInput\(top\.item\)[\s\S]*collectInputFrameFor\(top\.item,\s*top\.params\)/, 'global launcher param tools should collect manual input after params')
assert.match(launcherController, /previewInput\(\)[\s\S]*previewOutput[\s\S]*previewInputText/, 'launcher controller should keep live preview output on the collect-input frame')
assert.match(launcherTypes, /source:\s*['"]selection['"]\s*\|\s*['"]all['"]\s*\|\s*['"]manual['"]\s*\|\s*['"]empty['"]/, 'manual launcher input should be represented distinctly from pane/selection text')
assert.match(toolAdapter, /hasManualInput[\s\S]*manualTextInput\(ctx\.input\?\.text\s*\?\?\s*['"]['"],\s*mode\)/, 'launcher tool adapter should prefer controller-collected manual input')
assert.match(toolAdapter, /isGlobal[\s\S]*textResult\(value,\s*api,\s*locale\)[\s\S]*replaceActiveTextResult\(value,\s*api,\s*locale\)/, 'global manual quick text should copy generated output instead of replacing active pane text')
assert.doesNotMatch(globalLauncherHost, /quickTextSession/, 'GlobalLauncherHost should not keep a parallel quick text session')
assert.doesNotMatch(globalLauncherHost, /runQuickTextCommand|isQuickTextCommand/, 'GlobalLauncherHost should not use the legacy quick text command runner')
assert.doesNotMatch(globalLauncherHost, /pluginRegistry\.getAllCommands\(\)/, 'GlobalLauncherHost should not auto-discover commands for quick text')
assert.doesNotMatch(commandPalette, /pluginRegistry\.getAllCommands\(\)/, 'CommandPalette should not auto-discover commands for launcher items')
assert.doesNotMatch(globalLauncherHost, /runPluginCommandById|hiven:\/\/run-plugin-command/, 'GlobalLauncherHost should not restore the legacy command execution protocol')
assert.doesNotMatch(commandPalette, /runPluginCommandById|hiven:\/\/run-plugin-command/, 'CommandPalette should not restore the legacy command execution protocol')
assert.doesNotMatch(app, /runPluginCommandById|hiven:\/\/run-plugin-command/, 'App should not bridge launcher selections through the legacy command protocol')
assert.doesNotMatch(globalLauncherFrames, /global-launcher-quick-preview/, 'legacy quick preview UI should be removed in favor of controller result frames')

console.log('global launcher quick text checks passed')
