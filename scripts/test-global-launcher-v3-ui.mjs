#!/usr/bin/env node

/**
 * Global launcher v3 UI contract
 *
 * The standalone/global launcher should keep the v3 mixed command/app row
 * language and make multi-result output rows keyboard-selectable.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const files = {
  packageJson: read('package.json'),
  globalLauncher: read('src/components/GlobalLauncher.tsx'),
  commandPalette: read('src/components/CommandPalette.tsx'),
  launcherParamStep: read('src/components/launcher/LauncherParamStep.tsx'),
  launcherController: read('src/workspace/launcher/controller.ts'),
  launcherTypes: read('src/workspace/launcher/types.ts'),
  css: read('src/index.css'),
  palette: read('src/i18n/locales/palette.ts'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:global-launcher-v3-ui'],
  'node scripts/test-global-launcher-v3-ui.mjs',
  'package.json must expose test:global-launcher-v3-ui',
)

assert.match(files.globalLauncher, /resultSelectedIndex/, 'GlobalLauncher result frame must track a selected result row')
assert.match(files.globalLauncher, /event\.key === 'ArrowDown'[\s\S]{0,320}setResultSelectedIndex/, 'GlobalLauncher result frame must support ArrowDown selection')
assert.match(files.globalLauncher, /event\.key === 'ArrowUp'[\s\S]{0,320}setResultSelectedIndex/, 'GlobalLauncher result frame must support ArrowUp selection')
assert.match(files.globalLauncher, /choices\[Math\.min\(resultSelectedIndex/, 'Enter should activate the selected result choice instead of always using the first row')
assert.match(files.globalLauncher, /global-launcher-result-row/, 'GlobalLauncher result rows must have a stable v3 row styling hook')
assert.match(files.globalLauncher, /ResultChoiceRow/, 'GlobalLauncher must render result choices through the shared v3 result row')
assert.match(files.globalLauncher, /l-result-block/, 'GlobalLauncher must support the long text result fallback block')
assert.match(files.globalLauncher, /toggleResultChoice/, 'GlobalLauncher must support selectable multi-result rows')
assert.match(files.globalLauncher, /global-launcher-header l-search/, 'GlobalLauncher must use the v3 search header structure')
assert.match(files.globalLauncher, /className=\{`l-row/, 'GlobalLauncher list rows must use the v3 l-row structure')
assert.match(files.globalLauncher, /global-launcher-footer l-foot/, 'GlobalLauncher must use the v3 footer structure')
assert.match(files.globalLauncher, /launcher-kind-tag/, 'GlobalLauncher list rows must render right-side type tags')
assert.match(files.globalLauncher, /kindApp/, 'GlobalLauncher must distinguish application rows')
assert.match(files.globalLauncher, /kindCommand/, 'GlobalLauncher must distinguish command rows')
assert.match(files.globalLauncher, /GLOBAL_LAUNCHER_PANEL_WIDTH\s*=\s*680/, 'GlobalLauncher panel should be widened to 680px')
assert.doesNotMatch(files.globalLauncher, /MAX_GLOBAL_LAUNCHER_RENDERED_ITEMS/, 'GlobalLauncher should not keep the old rendered item cap')
assert.match(files.globalLauncher, /collectDynamicItems\(q,\s*['"]global-launcher['"],\s*locale/, 'GlobalLauncher should collect host dynamic items even for empty-query app mixing')

assert.match(files.commandPalette, /command-launcher-panel global-launcher-panel/, 'CommandPalette must use the same v3 launcher panel shell')
assert.match(files.commandPalette, /global-launcher-header l-search/, 'CommandPalette must use the v3 search header')
assert.match(files.commandPalette, /className=\{`l-row command-launcher-row/, 'CommandPalette list rows must use the v3 row structure')
assert.match(files.commandPalette, /global-launcher-footer l-foot/, 'CommandPalette must use the v3 footer structure')

assert.match(files.launcherParamStep, /l-option-row/, 'Launcher param option rows must use the v3 option-list row')
assert.match(files.launcherParamStep, /onMultiToggle/, 'Launcher multi-select params must toggle in place instead of confirming immediately')
assert.match(files.launcherParamStep, /selectedCountMax/, 'Launcher multi-select params must show selected/max copy in the search header')
assert.match(files.launcherController, /toggleCurrentMultiParamValue/, 'Launcher controller must expose a multi-select param toggle intent')
assert.match(files.launcherTypes, /maxSelect/, 'Launcher param type must include maxSelect for multi-select limits')

assert.match(files.css, /\.global-launcher-result-row/, 'Result row selection must have CSS')
assert.match(files.css, /\.l-option-row/, 'Launcher option rows must have v3 CSS')
assert.match(files.css, /\.check\.on/, 'Launcher multi-select checkbox must have checked CSS')
assert.match(files.css, /\.l-result-block/, 'Long text result fallback must have CSS')
assert.match(files.css, /\.l-search/, 'Launcher search bar must have the v3 CSS')
assert.match(files.css, /\.l-row\.sel/, 'Launcher selected rows must have the v3 expanded row CSS')
assert.match(files.css, /\.l-foot/, 'Launcher footer must have the v3 CSS')
assert.match(files.css, /\.launcher-kind-tag/, 'Launcher type tags must have CSS')
assert.match(files.css, /--launcher-panel-width:\s*680px/, 'Launcher CSS should expose the widened 680px panel width')

assert.match(files.palette, /kindCommand/, 'Palette i18n must include command tag copy')
assert.match(files.palette, /kindApp/, 'Palette i18n must include app tag copy')
assert.match(files.palette, /kindView/, 'Palette i18n must include view tag copy')
assert.match(files.palette, /kindPinned/, 'Palette i18n must include pinned tag copy')
assert.match(files.palette, /搜索命令，或输入公式、关键词…/, 'Global launcher zh placeholder must match the v3 UX copy')
assert.match(files.palette, /selectedCountMax/, 'Palette i18n must include selected/max copy')

console.log('global launcher v3 UI checks passed')
