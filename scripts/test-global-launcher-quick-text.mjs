#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

const globalLauncher = read('src/components/GlobalLauncher.tsx')
const commandPalette = read('src/components/CommandPalette.tsx')
const app = read('src/App.tsx')
const lineToolsPlugin = read('src/plugins/lineTools/index.ts')
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
    new RegExp(`id:\\s*['"]${escapedId}['"][\\s\\S]{0,1800}surfaces:\\s*\\{[\\s\\S]{0,180}launcher:\\s*\\{[\\s\\S]{0,120}surfaces:\\s*\\[[\\s\\S]{0,80}['"]command-palette['"][\\s\\S]{0,80}\\]`),
    `${id} should remain command-palette only because global quick text is single-line`,
  )
}
assert.match(
  lineToolsPlugin,
  /id:\s*['"]line-tools\.trim-whitespace['"][\s\S]{0,700}surfaces:\s*\{[\s\S]{0,180}launcher:\s*\{[\s\S]{0,120}surfaces:\s*\[[\s\S]{0,80}['"]command-palette['"][\s\S]{0,80}['"]global-launcher['"]/,
  'trim whitespace should be exposed in global launcher quick text and command palette',
)
assert.match(
  lineToolsPlugin,
  /id:\s*['"]line-tools\.reverse-text['"][\s\S]{0,700}surfaces:\s*\{[\s\S]{0,180}launcher:\s*\{[\s\S]{0,120}surfaces:\s*\[[\s\S]{0,80}['"]command-palette['"][\s\S]{0,80}['"]global-launcher['"]/,
  'reverse text should be exposed in global launcher quick text and command palette',
)
assert.match(lineToolsPlugin, /inputPolicy:\s*\{\s*mode:\s*['"]auto['"]\s*\}/, 'reverse should use the shared auto input policy')
assert.match(lineToolsPlugin, /id:\s*['"]line-tools\.reverse['"][\s\S]{0,360}ctx\.output\.replaceActiveText/, 'reverse launcher tool should replace active text, not copy-only')
assert.doesNotMatch(launcherRegistry, /adaptCommandToLauncherItem|canAdaptCommandToLauncher|commandAdapter/, 'launcher registry should not use a command adapter')
assert.doesNotMatch(launcherRegistry, /def\.commands|getAllCommands/, 'launcher registry should not scan plugin commands')
assert.match(globalLauncher, /collectStaticCandidates\(['"]global-launcher['"]\)/, 'GlobalLauncher should source quick text style tools from the launcher registry')
assert.match(globalLauncher, /controllerRef\.current\?\.submitInput\(\)|controllerRef\.current\.selectItem\(domainItem\)/, 'GlobalLauncher should execute tool output through LauncherController')
assert.match(globalLauncher, /controllerState[\s\S]{0,240}kind\s*===\s*['"]result['"]/, 'GlobalLauncher should render controller output result frames')
assert.match(globalLauncher, /controllerRef\.current\?\.previewInput\(\)/, 'GlobalLauncher should request live previews while manual input changes')
assert.match(globalLauncher, /previewChoices[\s\S]*frame\.previewOutput\?\.choices\s*\?\?\s*\[\]/, 'GlobalLauncher should render controller preview output inside the manual input frame')
assert.match(globalLauncher, /previewChoices[\s\S]*palette\.enterToCopy/, 'GlobalLauncher should show Enter-to-copy wording when a live preview is available')
assert.match(launcherController, /shouldCollectTextInput[\s\S]*surfaceId\s*===\s*['"]global-launcher['"][\s\S]*item\.inputPolicy\s*!=\s*null/, 'global launcher text tools should enter the shared manual input flow')
assert.match(launcherController, /submitParams[\s\S]*shouldCollectTextInput\(top\.item\)[\s\S]*collectInputFrameFor\(top\.item,\s*top\.params\)/, 'global launcher param tools should collect manual input after params')
assert.match(launcherController, /previewInput\(\)[\s\S]*previewOutput[\s\S]*previewInputText/, 'launcher controller should keep live preview output on the collect-input frame')
assert.match(launcherTypes, /source:\s*['"]selection['"]\s*\|\s*['"]all['"]\s*\|\s*['"]manual['"]\s*\|\s*['"]empty['"]/, 'manual launcher input should be represented distinctly from pane/selection text')
assert.match(toolAdapter, /hasManualInput[\s\S]*manualTextInput\(ctx\.input\?\.text\s*\?\?\s*['"]['"],\s*mode\)/, 'launcher tool adapter should prefer controller-collected manual input')
assert.match(toolAdapter, /copyReplaceOutput[\s\S]*textResult\(value,\s*api,\s*locale\)[\s\S]*replaceActiveTextResult\(value,\s*api,\s*locale\)/, 'global manual quick text should copy generated output instead of replacing active pane text')
assert.doesNotMatch(globalLauncher, /quickTextSession/, 'GlobalLauncher should not keep a parallel quick text session')
assert.doesNotMatch(globalLauncher, /runQuickTextCommand|isQuickTextCommand/, 'GlobalLauncher should not use the legacy quick text command runner')
assert.doesNotMatch(globalLauncher, /pluginRegistry\.getAllCommands\(\)/, 'GlobalLauncher should not auto-discover commands for quick text')
assert.doesNotMatch(commandPalette, /pluginRegistry\.getAllCommands\(\)/, 'CommandPalette should not auto-discover commands for launcher items')
assert.doesNotMatch(globalLauncher, /runPluginCommandById|hiven:\/\/run-plugin-command/, 'GlobalLauncher should not restore the legacy command execution protocol')
assert.doesNotMatch(commandPalette, /runPluginCommandById|hiven:\/\/run-plugin-command/, 'CommandPalette should not restore the legacy command execution protocol')
assert.doesNotMatch(app, /runPluginCommandById|hiven:\/\/run-plugin-command/, 'App should not bridge launcher selections through the legacy command protocol')
assert.doesNotMatch(globalLauncher, /global-launcher-quick-preview/, 'legacy quick preview UI should be removed in favor of controller result frames')

console.log('global launcher quick text checks passed')
