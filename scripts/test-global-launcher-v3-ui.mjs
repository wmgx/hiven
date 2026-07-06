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
  globalLauncher: read('src/launcher/hosts/GlobalLauncherHost.tsx'),
  globalLauncherFrames: read('src/components/launcher/GlobalLauncherFrames.tsx'),
  globalLauncherHostLifecycle: read('src/components/launcher/GlobalLauncherHostLifecycle.ts'),
  globalLauncherPermissionFrame: read('src/components/launcher/GlobalLauncherPermissionFrame.tsx'),
  globalLauncherCollectInputFrame: read('src/components/launcher/GlobalLauncherCollectInputFrame.tsx'),
  globalLauncherResultFrame: read('src/components/launcher/GlobalLauncherResultFrame.tsx'),
  globalLauncherKeyboard: read('src/components/launcher/GlobalLauncherKeyboard.ts'),
  globalLauncherLayout: read('src/components/launcher/GlobalLauncherLayout.ts') + '\n' + read('src/components/launcher/GlobalLauncherGeometry.ts'),
  launcherMixedList: read('src/components/launcher/LauncherMixedList.tsx'),
  launcherResultChoiceRow: read('src/components/launcher/LauncherResultChoiceRow.tsx'),
  commandPalette: read('src/components/CommandPalette.tsx'),
  editorCommandBarHost: read('src/launcher/hosts/EditorCommandBarHost.tsx'),
  launcherDomainSearchStep: read('src/components/launcher/LauncherDomainSearchStep.tsx'),
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
assert.match(files.globalLauncherKeyboard, /event\.key === 'ArrowDown'[\s\S]{0,320}setResultSelectedIndex/, 'GlobalLauncher result frame must support ArrowDown selection')
assert.match(files.globalLauncherKeyboard, /event\.key === 'ArrowUp'[\s\S]{0,320}setResultSelectedIndex/, 'GlobalLauncher result frame must support ArrowUp selection')
assert.match(files.globalLauncherKeyboard, /choices\[Math\.min\(resultSelectedIndex/, 'Enter should activate the selected result choice instead of always using the first row')
assert.match(files.launcherResultChoiceRow, /global-launcher-result-row/, 'GlobalLauncher result rows must have a stable v3 row styling hook')
assert.match(files.globalLauncherResultFrame, /LauncherResultChoiceRow/, 'GlobalLauncher result frame must render result choices through the shared v3 result row')
assert.match(files.launcherResultChoiceRow, /l-result-block/, 'GlobalLauncher must support the long text result fallback block')
assert.match(files.globalLauncher, /toggleResultChoice/, 'GlobalLauncher must support selectable multi-result rows')
assert.match(files.globalLauncherCollectInputFrame, /global-launcher-header l-search/, 'GlobalLauncher collect-input frame must use the v3 search header structure')
assert.match(files.launcherMixedList, /className=\{`l-row/, 'GlobalLauncher list rows must use the v3 l-row structure')
assert.match(files.globalLauncherCollectInputFrame, /global-launcher-footer l-foot/, 'GlobalLauncher collect-input frame must use the v3 footer structure')
assert.match(files.launcherMixedList, /launcher-kind-tag/, 'GlobalLauncher list rows must render right-side type tags')
assert.match(files.launcherMixedList, /kindApp/, 'GlobalLauncher must distinguish application rows')
assert.match(files.launcherMixedList, /kindCommand/, 'GlobalLauncher must distinguish command rows')
assert.match(files.globalLauncherLayout, /GLOBAL_LAUNCHER_PANEL_WIDTH_PX\s*=\s*680/, 'GlobalLauncher panel should be widened to 680px')
assert.doesNotMatch(files.globalLauncher, /MAX_GLOBAL_LAUNCHER_RENDERED_ITEMS/, 'GlobalLauncher should not keep the old rendered item cap')
assert.match(files.globalLauncher, /collectDynamicWhenEmpty:\s*true/, 'GlobalLauncher should collect host dynamic items even for empty-query app mixing')
assert.match(files.globalLauncher, /useGlobalLauncherHostEscape/, 'GlobalLauncherHost must delegate host Escape handling to a lifecycle helper')
assert.match(files.globalLauncher, /useGlobalLauncherCollectInputPreview/, 'GlobalLauncherHost must delegate collect-input preview lifecycle to a helper')
assert.match(files.globalLauncher, /useGlobalLauncherFocusSession/, 'GlobalLauncherHost must delegate focus capture and restoration to a helper')
assert.match(files.globalLauncherHostLifecycle, /useGlobalLauncherHostEscape[\s\S]*window\.addEventListener\('keydown', handleHostEscape, true\)/, 'GlobalLauncher lifecycle helper must own host-level Escape subscription')
assert.match(files.globalLauncherHostLifecycle, /useGlobalLauncherCollectInputPreview[\s\S]*previewInput/, 'GlobalLauncher lifecycle helper must own collect-input preview scheduling')
assert.match(files.globalLauncherFrames, /<GlobalLauncherPermissionFrame/, 'GlobalLauncher frame switch must delegate permission rendering to a dedicated frame component')
assert.doesNotMatch(files.globalLauncherFrames, /PluginSurfacePermissionGate/, 'GlobalLauncher frame switch must not render plugin permission gate inline')
assert.match(files.globalLauncherPermissionFrame, /PluginSurfacePermissionGate/, 'GlobalLauncher permission frame must own plugin permission gate rendering')
assert.match(files.globalLauncherFrames, /<GlobalLauncherCollectInputFrame/, 'GlobalLauncher frame switch must delegate collect-input rendering to a dedicated frame component')
assert.doesNotMatch(files.globalLauncherFrames, /LauncherResultChoiceRow|LauncherHintText|resolveIcon/, 'GlobalLauncher frame switch must not render collect-input UI internals inline')
assert.match(files.globalLauncherCollectInputFrame, /LauncherResultChoiceRow[\s\S]*previewChoices/, 'GlobalLauncher collect-input frame must own preview result rows')

assert.match(files.commandPalette, /EditorCommandBar/, 'CommandPalette compatibility wrapper must delegate to EditorCommandBar')
assert.match(files.editorCommandBarHost, /<LauncherDomainSearchStep/, 'EditorCommandBarHost must use the shared v3 search step')
assert.match(files.launcherDomainSearchStep, /global-launcher-header l-search/, 'Shared launcher search step must use the v3 search header')
assert.match(files.editorCommandBarHost, /<LauncherDomainSearchStep/, 'EditorCommandBarHost must delegate v3 row rendering to shared launcher search step')
assert.match(files.launcherDomainSearchStep, /global-launcher-footer l-foot/, 'Shared launcher search step must use the v3 footer structure')

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
assert.match(
  files.css,
  /html\[data-window='launcher'\]\s+\.global-launcher-panel\.palette-panel\s*\{[\s\S]*?border-color:\s*transparent\s*!important;[\s\S]*?box-shadow:\s*none\s*!important;[\s\S]*?\}/,
  'Standalone global launcher window must suppress the outer border/outline',
)

assert.match(files.palette, /kindCommand/, 'Palette i18n must include command tag copy')
assert.match(files.palette, /kindApp/, 'Palette i18n must include app tag copy')
assert.match(files.palette, /kindView/, 'Palette i18n must include view tag copy')
assert.match(files.palette, /kindPinned/, 'Palette i18n must include pinned tag copy')
assert.match(files.palette, /搜索命令，或输入公式、关键词…/, 'Global launcher zh placeholder must match the v3 UX copy')
assert.match(files.palette, /selectedCountMax/, 'Palette i18n must include selected/max copy')

console.log('global launcher v3 UI checks passed')
