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

const pluginDir = 'src/plugins/translate'
const manifest = readIfExists(`${pluginDir}/manifest.json`)
const index = readIfExists(`${pluginDir}/index.tsx`) || readIfExists(`${pluginDir}/index.ts`)
const surface = readIfExists(`${pluginDir}/surfaces/TranslateSurface.tsx`)
const styles = readIfExists(`${pluginDir}/style.css`)
const settings = readIfExists(`${pluginDir}/settings/model.ts`)
const settingsPanel = readIfExists(`${pluginDir}/settings/TranslateSettingsPanel.tsx`)
const adapters = readIfExists(`${pluginDir}/providers/adapters.ts`)
const builtinIndex = read('src/builtin-plugins/index.json')
const packageJson = read('package.json')

assert.ok(manifest, 'translate plugin must ship manifest.json')
assert.ok(index, 'translate plugin must ship an index entry')
assert.ok(surface, 'translate plugin must ship TranslateSurface.tsx')
assert.ok(styles, 'translate plugin must ship dedicated style.css')
assert.ok(settings, 'translate plugin must define settings/model.ts')
assert.ok(settingsPanel, 'translate plugin must ship a custom TranslateSettingsPanel')
assert.ok(adapters, 'translate plugin must define provider adapters')

const manifestJson = JSON.parse(manifest)
assert.equal(manifestJson.pluginId, 'translate', 'manifest pluginId must be translate')
assert.deepEqual(
  manifestJson.capabilities?.sort(),
  ['settings', 'ui'].sort(),
  'translate is an app surface plugin with settings and ui capabilities only',
)
assert.deepEqual(
  manifestJson.permissions?.sort(),
  ['network.request', 'storage.private'].sort(),
  'translate should request only storage.private and network.request; no clipboard/paste/background permissions',
)

const builtin = JSON.parse(builtinIndex)
assert.ok(
  builtin.packages.some((pkg) => pkg.pluginId === 'translate' && pkg.dir === 'translate'),
  'builtin plugin index must include translate package',
)

const packageScripts = JSON.parse(packageJson).scripts ?? {}
assert.equal(
  packageScripts['test:translate-plugin'],
  'node scripts/test-translate-plugin-contract.mjs',
  'package.json must expose test:translate-plugin',
)

assert.match(index, /definePlugin<TranslateSettings>\s*\(/, 'translate plugin should be typed with TranslateSettings')
assert.match(index, /component:\s*TranslateSettingsPanel/, 'translate settings must use the custom settings panel')
assert.doesNotMatch(index, /schema:\s*\{/, 'translate settings should not use the generic schema renderer')
assert.match(index, /ui:\s*\{[\s\S]*surfaces:\s*\[/, 'translate plugin must contribute a ui surface')
assert.match(index, /kind:\s*['"]custom-view['"]/, 'translate plugin must use custom-view surface')
assert.match(index, /id:\s*['"]main['"]/, 'translate surface id must be main')
assert.match(index, /launcher:\s*true/, 'translate surface must be available from launcher')
assert.match(index, /shortcutBindable:\s*true/, 'translate surface must be shortcut-bindable')
assert.match(index, /recommendedShortcut:\s*['"]CmdOrCtrl\+Shift\+T['"]/, 'translate should recommend CmdOrCtrl+Shift+T')
assert.match(index, /closeOnBlur:\s*false/, 'translate surface should not close on blur')
assert.match(index, /resizable:\s*true/, 'translate surface should be resizable')
assert.doesNotMatch(index, /background\s*:/, 'translate must not register a background task')
assert.doesNotMatch(index, /commands\s*:/, 'translate should not be modeled as a command-first plugin')
assert.doesNotMatch(index, /panels\s*:/, 'translate should not register workspace panels')
assert.doesNotMatch(index, /toolbar\s*:/, 'translate should not register workspace toolbar actions')

for (const source of [index, surface, settings, adapters].join('\n')) {
  assert.doesNotMatch(source, /clipboard\.readText|host\.clipboard|pasteText|host\.paste/, 'translate must not read clipboard or paste to foreground app')
  assert.doesNotMatch(source, /replaceActiveText|insertText|getActiveText|getSelectionText|getPaneSnapshot/, 'translate must not read or write workspace text')
  assert.doesNotMatch(source, /history|repository|background/i, 'translate must not implement translation history/background storage')
}

assert.match(surface, /800/, 'TranslateSurface must debounce automatic translation at 800ms')
assert.doesNotMatch(surface, />\s*翻译\s*<|>\s*Translate\s*<\/[Bb]utton|copy translated|复制译文|从剪贴板|clipboard/i, 'surface must not expose translate/copy/clipboard buttons')
assert.match(surface, /textarea|TextArea/, 'surface must expose a text input area')
assert.match(surface, /translatedText|translationText|outputText/, 'surface must render translation text')
assert.match(surface, /smart/i, 'surface must support smart target language')
assert.match(surface, /quota|usedChars|monthlyLimit/i, 'surface must expose quota status')
assert.match(surface + styles, /translate-surface/, 'surface and styles must use translate-surface class naming')
assert.match(surface, /translate-surface__header/, 'surface must follow the designed header structure')
assert.match(surface, /translate-surface__controls/, 'surface must follow the designed controls structure')
assert.match(surface, /translate-surface__body/, 'surface must follow the designed two-pane body structure')
assert.match(surface, /translate-surface__status/, 'surface must follow the designed status bar structure')
assert.match(styles, /--panel|--surface|--text-2|--accent-soft/, 'translate styles must define restrained design tokens')
assert.doesNotMatch(styles, /translate-surface-ambient|background-size:\s*38px|border-radius:\s*18px/, 'translate UI should remove the old decorative ambient/grid/card styling')
assert.match(settingsPanel + styles, /translate-settings/, 'settings page must use matching translate-settings styling')

assert.match(settings, /profiles:\s*\[/, 'settings must default API profiles')
assert.match(settings, /defaultTargetLang:\s*['"]smart['"]/, 'settings must default target language to smart')
assert.match(settings, /monthlyLimitChars/, 'settings must model monthly character limit')
assert.match(settings, /usedChars/, 'settings must model monthly used characters')
assert.match(adapters, /provider:\s*['"]baidu['"]|case\s+['"]baidu['"]/, 'provider adapters must include baidu')
assert.doesNotMatch(adapters, /crypto\.subtle\.digest\(['"]MD5['"]/, 'Baidu signing must not rely on unsupported WebCrypto MD5')
assert.match(surface, /host\.storage\.kv\.(get|set)/, 'surface must persist monthly usage with plugin private storage')
assert.match(adapters, /provider:\s*['"]deepl['"]|case\s+['"]deepl['"]/, 'provider adapters must include deepl')

console.log('translate plugin contract checks passed')
