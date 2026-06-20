#!/usr/bin/env node

/**
 * Editor topbar and plugin detail contract
 *
 * The host owns fixed editor topbar actions. Plugins may contribute trailing
 * toolbar buttons, and schema settings render inline on plugin detail cards.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const files = {
  packageJson: read('package.json'),
  editorView: read('src/views/EditorView.tsx'),
  scriptsView: read('src/views/ScriptsView.tsx'),
  sidebar: read('src/components/Sidebar.tsx'),
  settingsSchemaRenderer: read('src/components/PluginSettingsSchemaRenderer.tsx'),
  globalLauncher: read('src/components/GlobalLauncher.tsx'),
  renderStatusBar: read('src/components/workspace/RenderStatusBar.tsx'),
  schemaInline: existsSync(join(root, 'src/components/PluginSettingsInline.tsx'))
    ? read('src/components/PluginSettingsInline.tsx')
    : '',
  scriptsI18n: read('src/i18n/locales/scripts.ts'),
  css: read('src/index.css'),
  settingsView: read('src/views/SettingsView.tsx'),
  navI18n: read('src/i18n/locales/nav.ts'),
  paletteI18n: read('src/i18n/locales/palette.ts'),
  settingsI18n: read('src/i18n/locales/settings.ts'),
  workspaceI18n: read('src/i18n/locales/workspace.ts'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:editor-topbar-plugin-detail'],
  'node scripts/test-editor-topbar-plugin-detail.mjs',
  'package.json must expose test:editor-topbar-plugin-detail',
)

assert.match(files.editorView, /editor-topbar/, 'EditorView must render a dedicated editor topbar')
assert.match(files.editorView, /editor-topbar-system/, 'EditorView must separate fixed host actions')
assert.match(files.editorView, /editor-topbar-plugin-slot/, 'EditorView must keep a plugin contribution slot')
assert.match(files.editorView, /getAction\(actionId\)/, 'Topbar host editor actions must prefer active editor actions')
assert.match(files.editorView, /trigger\?\.\(['"]editor-topbar['"],\s*actionId,\s*null\)/, 'Topbar host editor actions must fall back to Monaco commands')
assert.doesNotMatch(files.editorView, /runEditorAction\(['"]undo['"]\)|<Undo2\b/, 'Topbar must not expose the removed undo action')
assert.doesNotMatch(files.editorView, /runEditorAction\(['"]redo['"]\)|<Redo2\b/, 'Topbar must not expose the removed redo action')
assert.doesNotMatch(files.editorView, /editor-topbar-status|status-dot ready|\{t\(['"]ready['"]\)\}/, 'Topbar must not show the removed ready status')
assert.match(files.editorView, /updateSetting\(['"]wordWrap['"],\s*!wordWrap\)/, 'Topbar must expose host word-wrap toggle')
assert.match(files.editorView, /runEditorAction\(['"]editor\.action\.startFindReplaceAction['"]\)/, 'Topbar must expose host find/replace action')
assert.match(files.editorView, /createPane\(\{[\s\S]*direction:\s*['"]right['"]/, 'Topbar must expose host split-right action')
assert.match(files.editorView, /createPane\(\{[\s\S]*direction:\s*['"]bottom['"]/, 'Topbar must expose host split-down action')
assert.doesNotMatch(files.editorView, /title=\{t\(['"]closePane['"]\)\}[\s\S]{0,120}<X/, 'Topbar must not expose the close-pane action')
assert.match(files.renderStatusBar, /statusbar-close[\s\S]{0,240}closeActiveSurfaceOrPane\(\)/, 'Statusbar must expose host close-pane/surface action')
assert.match(files.editorView, /setGlobalLauncherOpen\(true,\s*['"]full['"]\)/, 'Topbar must expose the host global launcher action')
assert.match(files.editorView, /setCommandPaletteOpen\(true\)/, 'Editor run-action affordance must preserve the in-app command palette')
assert.match(files.editorView, /toolbarItems\.map/, 'EditorView must still render plugin toolbar contributions')
assert.match(files.editorView, /runToolbarCommand\(item\.contribution\.commandId/, 'Plugin toolbar slot must execute plugin commands through the toolbar runner')

assert.match(files.css, /\.editor-topbar/, 'Topbar must have stable styling')
assert.match(files.css, /\.editor-topbar-plugin-slot/, 'Plugin topbar slot must have stable styling')

assert.ok(files.schemaInline, 'PluginSettingsInline component must exist')
assert.match(files.schemaInline, /export function PluginSettingsInline/, 'PluginSettingsInline must export a component')
assert.match(files.schemaInline, /PluginSettingsSchemaRenderer/, 'PluginSettingsInline must render schema settings')
assert.match(files.schemaInline, /contribution\.schema/, 'PluginSettingsInline must render only schema-capable settings inline')
assert.match(files.schemaInline, /settingsModalTarget/, 'PluginSettingsInline must support schema-declared modal settings')

assert.match(files.scriptsView, /PluginSettingsInline/, 'ScriptsView must render inline schema settings on plugin details')
assert.match(files.scriptsView, /plugin-settings-inline-detail/, 'ScriptsView must wrap inline schema settings in a detail section')
assert.match(files.scriptsView, /plugin-master-detail/, 'ScriptsView must render plugin management as a master-detail surface')
assert.match(files.scriptsView, /listBundledPluginPackageSummaries/, 'ScriptsView browser preview must list bundled plugins without Tauri directory APIs')
assert.match(files.scriptsView, /if \(!isTauri\(\)\)[\s\S]{0,220}setBuiltinPlugins\(listBundledPluginPackageSummaries\(\)\)/, 'ScriptsView non-Tauri path must render real bundled plugin details for visual QA')
assert.match(files.scriptsView, /className=["']phead["'][\s\S]{0,220}className=["']ptitle["'][\s\S]{0,220}className=["']pcount["']/, 'ScriptsView must render the plugin page title and total count header')
assert.match(files.scriptsView, /className=["']ptools["']/, 'ScriptsView must use the design ptools header row')
assert.doesNotMatch(files.scriptsView, /scripts-title|className=["']phead scripts-header["']|className=["']ptitle scripts-title["']/, 'ScriptsView must not render the old plugin page title/count header')
assert.equal((files.scriptsView.match(/data-testid=["']plugin-new-button["']/g) ?? []).length, 1, 'ScriptsView top bar must expose exactly one add-plugin button')
assert.doesNotMatch(files.scriptsView, /handleSideloadDev|handleCreatePlugin|scripts\.importDev|scripts\.new/, 'Add Plugin menu must only expose GitHub, zip, and directory imports')
assert.doesNotMatch(files.scriptsView, /scripts-header-actions/, 'ScriptsView must not render the old multi-button header action group')
assert.match(files.scriptsView, /selectedPluginKey/, 'ScriptsView must keep a selected plugin detail target')
assert.match(files.scriptsView, /hasSchemaSettings/, 'ScriptsView must distinguish schema settings from legacy settings')
assert.match(files.scriptsView, /hasLegacySettings/, 'ScriptsView must keep legacy settings button fallback')
assert.match(files.scriptsView, /pluginDetailDescription/, 'Plugin detail must resolve a runtime description for the selected plugin')
assert.match(files.scriptsView, /className=["']d-desc plugin-detail-description["']/, 'Plugin detail must render the plugin description as a dedicated description block')
assert.match(files.scriptsView, /surfaceShortcutHintForPlugin/, 'Plugin master list must show shortcut hints instead of generic status text')
assert.match(files.scriptsView, /function capabilityLabel\(/, 'ScriptsView must map raw plugin capability ids through localized labels')
assert.match(files.scriptsView, /\{capabilityLabel\(capability,\s*locale\)\}/, 'ScriptsView capability badges must render localized labels')
assert.match(files.scriptsI18n, /['"]capability\.command['"]:\s*['"]Command['"]/, 'Scripts i18n must include the English command capability label')
assert.match(files.scriptsI18n, /['"]capability\.instantSuggestion['"]:\s*['"]Instant suggestion['"]/, 'Scripts i18n must include the English instant suggestion capability label')
assert.match(files.scriptsI18n, /['"]capability\.command['"]:\s*['"]命令['"]/, 'Scripts i18n must include the Chinese command capability label')
assert.match(files.scriptsI18n, /['"]capability\.instantSuggestion['"]:\s*['"]即时建议['"]/, 'Scripts i18n must include the Chinese instant suggestion capability label')

for (const [name, source] of Object.entries({
  scriptsView: files.scriptsView,
  settingsView: files.settingsView,
  sidebar: files.sidebar,
  settingsSchemaRenderer: files.settingsSchemaRenderer,
  globalLauncher: files.globalLauncher,
})) {
  assert.doesNotMatch(source, /(?:ctx\.)?locale\s*===\s*['"]zh['"]/, `${name} must use the shared i18n registry instead of inline zh branches`)
}

assert.match(files.scriptsI18n, /['"]settingsPermissionRequired['"]/, 'Scripts i18n must include schema permission dependency copy')
assert.match(files.scriptsI18n, /['"]surfaceShortcutRecommended['"]/, 'Scripts i18n must include surface shortcut recommendation copy')
assert.match(files.settingsI18n, /['"]languageInfo['"]/, 'Settings i18n must include language row description copy')
assert.match(files.navI18n, /['"]switchToLightTheme['"]/, 'Nav i18n must include theme toggle labels')
assert.match(files.paletteI18n, /['"]pluginPermissionTitle['"]/, 'Palette i18n must include plugin permission gate copy')
assert.match(files.workspaceI18n, /['"]pane\.stickyScroll\.enabled['"]/, 'Workspace i18n must include host action toast copy')

assert.match(files.css, /\.plugin-master-detail/, 'Plugin master-detail layout must have stable styling')
assert.match(files.css, /\.plugin-detail-panel/, 'Plugin detail panel must have stable styling')
assert.match(files.css, /\.ptools/, 'Plugin page toolbar must use the design ptools CSS')
assert.match(files.css, /\.a-list/, 'Plugin page list must use the design a-list CSS')
assert.match(files.css, /\.scripts-content\.body[\s\S]{0,120}overflow:\s*hidden/, 'Plugin page must not expose a global page scrollbar')
assert.match(files.css, /\.scripts-search-results[\s\S]{0,160}overflow:\s*hidden/, 'Plugin page results must constrain scrolling to inner panes')
assert.match(files.css, /\.a-list[\s\S]{0,180}overflow-y:\s*auto/, 'Plugin master list must scroll internally')
assert.match(files.css, /\.a-detail[\s\S]{0,180}overflow-y:\s*auto/, 'Plugin detail pane must scroll internally')
assert.match(files.css, /\.splitwrap\.plugin-master-detail[\s\S]{0,120}flex-direction:\s*column/, 'Plugin master-detail must collapse to one column on narrow viewports')
assert.match(files.css, /\.plugin-master-list\.a-list[\s\S]{0,180}width:\s*100%/, 'Plugin master list must use full width in the mobile master-detail layout')
assert.match(files.css, /\.settings-page\.body[\s\S]{0,160}overflow:\s*hidden/, 'Settings page must keep scrolling inside its design scroller')
assert.match(files.css, /\.body\s*\{[\s\S]{0,160}min-height:\s*0/, 'View bodies must be allowed to shrink so nested scroll panes can scroll')
assert.match(files.css, /\.sscroll\s*\{[\s\S]{0,180}min-height:\s*0/, 'Settings page scroll surface must shrink inside the fixed app viewport')
assert.match(files.css, /\.flux-spatial-shell\s+\*\s*\{[\s\S]{0,180}scrollbar-color:\s*var\(--scrollbar-thumb\)\s+var\(--scrollbar-track\)/, 'App scrollbars must use the hiven theme tokens')
assert.match(files.css, /::-webkit-scrollbar-thumb\s*\{[\s\S]{0,220}background:\s*var\(--scrollbar-thumb\)/, 'WebKit scrollbar thumbs must use the hiven theme token')
assert.match(files.css, /\.psearch[\s\S]{0,120}height:\s*34px/, 'Plugin search input shell must align with toolbar button height')
assert.match(files.css, /\.btn\s*\{[\s\S]{0,120}height:\s*34px/, 'Plugin toolbar buttons must align with the search input height')

assert.match(files.settingsView, /className=["']settings-page body["']/, 'SettingsView must use the redesigned settings shell')
assert.match(files.settingsView, /phead[\s\S]{0,260}<UpdateChecker/, 'Settings page header must place the update checker button at the top right')
assert.doesNotMatch(files.settingsView, /暗色 token 待补|Reserved for the dark token pass/, 'Settings dark theme copy must not claim the dark token pass is pending')
assert.match(files.settingsView, /<SettingGroup title=/, 'SettingsView must render settings as grouped rows')
assert.match(files.settingsView, /<SettingsListRow icon=/, 'SettingsView must render design srow rows')
assert.doesNotMatch(files.settingsView, /<SettingCard/, 'SettingsView must not render the old grid card layout')
assert.match(files.css, /\.sscroll/, 'Settings page must have the design scrolling surface CSS')
assert.match(files.css, /\.sgroup/, 'Settings page must have the design group CSS')
assert.match(files.css, /\.srow/, 'Settings page must have the design row CSS')

console.log('editor topbar and plugin detail checks passed')
