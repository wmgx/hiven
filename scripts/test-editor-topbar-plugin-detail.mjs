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
  renderStatusBar: read('src/components/workspace/RenderStatusBar.tsx'),
  schemaInline: existsSync(join(root, 'src/components/PluginSettingsInline.tsx'))
    ? read('src/components/PluginSettingsInline.tsx')
    : '',
  css: read('src/index.css'),
  settingsView: read('src/views/SettingsView.tsx'),
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

assert.match(files.css, /\.plugin-master-detail/, 'Plugin master-detail layout must have stable styling')
assert.match(files.css, /\.plugin-detail-panel/, 'Plugin detail panel must have stable styling')
assert.match(files.css, /\.ptools/, 'Plugin page toolbar must use the design ptools CSS')
assert.match(files.css, /\.a-list/, 'Plugin page list must use the design a-list CSS')
assert.match(files.css, /\.scripts-content\.body[\s\S]{0,120}overflow:\s*hidden/, 'Plugin page must not expose a global page scrollbar')
assert.match(files.css, /\.scripts-search-results[\s\S]{0,160}overflow:\s*hidden/, 'Plugin page results must constrain scrolling to inner panes')
assert.match(files.css, /\.a-list[\s\S]{0,180}overflow-y:\s*auto/, 'Plugin master list must scroll internally')
assert.match(files.css, /\.a-detail[\s\S]{0,180}overflow-y:\s*auto/, 'Plugin detail pane must scroll internally')
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
