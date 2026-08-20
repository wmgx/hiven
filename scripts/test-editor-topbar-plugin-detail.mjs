#!/usr/bin/env node

/**
 * Editor topbar and plugin detail contract
 *
 * Two surfaces, one guarantee each:
 *  - the editor topbar keeps host actions separated from the plugin slot;
 *  - the plugin manager keeps a per-plugin detail affordance.
 *
 * Both moved in the workbench retirement (6e69f0f): the topbar left the deleted
 * EditorView for QuickEditorDetachedView, and plugin detail stopped being a
 * master-detail split with inline schema settings — it is now a row list with an
 * expandable drawer, and schema settings open in the shared settings dialog.
 * The assertions below track them to where they live now; the retired pieces
 * (plugin toolbar contributions, pane splitting, inline settings) are gone for
 * good and are asserted absent so they cannot creep back unnoticed.
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
  quickEditorView: read('src/views/QuickEditorDetachedView.tsx'),
  breadcrumbActions: read('src/components/quickEditor/QuickEditorBreadcrumbActions.tsx'),
  pluginsSurfaceContent: read('src/surfaces/PluginsContent.tsx'),
  settingsSchemaRenderer: read('src/components/PluginSettingsSchemaRenderer.tsx'),
  globalLauncher: read('src/components/GlobalLauncher.tsx'),
  scriptsI18n: read('src/i18n/locales/scripts.ts'),
  css: read('src/index.css'),
  settingsSurfaceContent: read('src/surfaces/SettingsContent.tsx'),
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

// ─── Editor topbar (now on the quick editor window) ─────────────────────────

assert.match(files.quickEditorView, /editor-topbar/, 'Quick editor must render a dedicated editor topbar')
assert.match(files.quickEditorView, /editor-topbar-system/, 'Topbar must separate fixed host actions')
assert.match(files.quickEditorView, /editor-topbar-plugin-slot/, 'Topbar must keep a trailing slot for non-system actions')
assert.match(files.quickEditorView, /updateSetting\(['"]wordWrap['"],\s*!wordWrap\)/, 'Topbar must expose host word-wrap toggle')
assert.match(files.quickEditorView, /quickEditorImperative\.triggerFind\(\)/, 'Topbar must expose host find/replace through the editor imperative handle')
assert.match(files.quickEditorView, /openQuickEditorCommand\(\)/, 'Topbar run affordance must open the quick editor command entry')
assert.doesNotMatch(files.quickEditorView, /runEditorAction\(['"]undo['"]\)|<Undo2\b/, 'Topbar must not expose the removed undo action')
assert.doesNotMatch(files.quickEditorView, /runEditorAction\(['"]redo['"]\)|<Redo2\b/, 'Topbar must not expose the removed redo action')
assert.doesNotMatch(files.quickEditorView, /editor-topbar-status|status-dot ready/, 'Topbar must not show the removed ready status')

// The breadcrumb variant is the same topbar in the embedded quick editor; it
// must not drift into a second, differently-styled action row.
assert.match(files.breadcrumbActions, /editor-topbar-button/, 'Breadcrumb actions must reuse the topbar button style')
assert.match(files.breadcrumbActions, /updateSetting\(['"]wordWrap['"],\s*!wordWrap\)/, 'Breadcrumb actions must expose the same word-wrap toggle')

// Retired with the workbench — the topbar is no longer a plugin extension point
// and no longer splits panes. Guard against reintroduction.
for (const [name, source] of Object.entries({
  quickEditorView: files.quickEditorView,
  breadcrumbActions: files.breadcrumbActions,
})) {
  assert.doesNotMatch(source, /toolbarItems\.map|runToolbarCommand/, `${name} must not resurrect plugin toolbar contributions`)
  assert.doesNotMatch(source, /createPane\(\{/, `${name} must not resurrect pane splitting`)
}

assert.match(files.css, /\.editor-topbar/, 'Topbar must have stable styling')
assert.match(files.css, /\.editor-topbar-plugin-slot/, 'Topbar trailing slot must have stable styling')

// ─── Plugin manager: row list + expandable drawer ───────────────────────────

assert.match(files.pluginsSurfaceContent, /className="plugins-list"/, 'Plugin manager must render plugins as a row list')
assert.match(files.pluginsSurfaceContent, /className="plugins-row/, 'Plugin manager must render each plugin as a row')
assert.match(files.pluginsSurfaceContent, /expandedKey/, 'Plugin manager must track which plugin row is expanded')
assert.match(files.pluginsSurfaceContent, /function renderDrawer\(/, 'Plugin detail must render as an inline drawer under its row')
assert.match(files.pluginsSurfaceContent, /hasPluginSettings/, 'Plugin manager must know which plugins have settings')
assert.match(files.pluginsSurfaceContent, /openPluginsSurfaceSettings\(row\.pluginId,\s*row\.settingsSource\)/, 'Plugin settings must open through the shared settings dialog')
assert.match(files.pluginsSurfaceContent, /surfaceShortcutHintForPlugin/, 'Plugin rows must show shortcut hints instead of generic status text')
assert.match(files.pluginsSurfaceContent, /listBundledPluginPackageSummaries/, 'Browser preview must list bundled plugins without Tauri directory APIs')
assert.match(files.pluginsSurfaceContent, /if \(!isTauri\(\)\)[\s\S]{0,220}setBuiltinPlugins\(listBundledPluginPackageSummaries\(\)\)/, 'Non-Tauri path must render real bundled plugin details for visual QA')
assert.equal((files.pluginsSurfaceContent.match(/data-testid=["']plugin-new-button["']/g) ?? []).length, 1, 'Plugin manager must expose exactly one add-plugin button')
assert.doesNotMatch(files.pluginsSurfaceContent, /handleSideloadDev|handleCreatePlugin|scripts\.importDev|scripts\.new/, 'Add Plugin menu must only expose GitHub, zip, and directory imports')
assert.doesNotMatch(files.pluginsSurfaceContent, /scripts-title|className=["']phead scripts-header["']|className=["']ptitle scripts-title["']/, 'Plugin manager must not render the old plugin page title/count header')
assert.doesNotMatch(files.pluginsSurfaceContent, /scripts-header-actions/, 'Plugin manager must not render the old multi-button header action group')
// The master-detail split and its inline settings panel were retired together.
assert.doesNotMatch(files.pluginsSurfaceContent, /plugin-master-detail|PluginSettingsInline|plugin-settings-inline-detail/, 'Plugin manager must not resurrect the master-detail layout or inline schema settings')

assert.match(files.css, /\.plugins-list/, 'Plugin row list must have stable styling')
assert.match(files.css, /\.plugins-row/, 'Plugin rows must have stable styling')
assert.match(files.css, /\.plugins-drawer/, 'Plugin detail drawer must have stable styling')

for (const [name, source] of Object.entries({
  pluginsSurfaceContent: files.pluginsSurfaceContent,
  settingsSurfaceContent: files.settingsSurfaceContent,
  settingsSchemaRenderer: files.settingsSchemaRenderer,
  globalLauncher: files.globalLauncher,
})) {
  assert.doesNotMatch(source, /(?:ctx\.)?locale\s*===\s*['"]zh['"]/, `${name} must use the shared i18n registry instead of inline zh branches`)
}

// ─── Localized copy that both surfaces depend on ────────────────────────────

assert.match(files.scriptsI18n, /['"]settingsPermissionRequired['"]/, 'Scripts i18n must include schema permission dependency copy')
assert.match(files.scriptsI18n, /['"]surfaceShortcutRecommended['"]/, 'Scripts i18n must include surface shortcut recommendation copy')
assert.match(files.settingsI18n, /['"]languageInfo['"]/, 'Settings i18n must include language row description copy')
assert.match(files.navI18n, /['"]switchToLightTheme['"]/, 'Nav i18n must include theme toggle labels')
assert.match(files.paletteI18n, /['"]pluginPermissionTitle['"]/, 'Palette i18n must include plugin permission gate copy')
assert.match(files.workspaceI18n, /['"]pane\.stickyScroll\.enabled['"]/, 'Workspace i18n must include host action toast copy')

// ─── Scroll containment: pages never grow a second scrollbar ────────────────

assert.match(files.css, /\.scripts-content\.body[\s\S]{0,120}overflow:\s*hidden/, 'Plugin page must not expose a global page scrollbar')
assert.match(files.css, /\.settings-page\.body[\s\S]{0,160}overflow:\s*hidden/, 'Settings page must keep scrolling inside its design scroller')
assert.match(files.css, /\.body\s*\{[\s\S]{0,160}min-height:\s*0/, 'View bodies must be allowed to shrink so nested scroll panes can scroll')
assert.match(files.css, /\.sscroll\s*\{[\s\S]{0,180}min-height:\s*0/, 'Settings page scroll surface must shrink inside the fixed app viewport')
assert.match(files.css, /\.flux-spatial-shell\s+\*\s*\{[\s\S]{0,180}scrollbar-color:\s*var\(--scrollbar-thumb\)\s+var\(--scrollbar-track\)/, 'App scrollbars must use the hiven theme tokens')
assert.match(files.css, /::-webkit-scrollbar-thumb\s*\{[\s\S]{0,220}background:\s*var\(--scrollbar-thumb\)/, 'WebKit scrollbar thumbs must use the hiven theme token')

// ─── Settings surface shell ─────────────────────────────────────────────────

assert.match(files.settingsSurfaceContent, /className="sscroll"/, 'Settings surface must use the design scrolling shell')
assert.match(files.settingsSurfaceContent, /settings-about-version[\s\S]{0,220}<UpdateChecker compact/, 'Settings about card must place the compact update checker next to the current version')
assert.doesNotMatch(files.settingsSurfaceContent, /暗色 token 待补|Reserved for the dark token pass/, 'Settings dark theme copy must not claim the dark token pass is pending')
assert.match(files.settingsSurfaceContent, /<SettingGroup title=/, 'Settings surface must render settings as grouped rows')
assert.match(files.settingsSurfaceContent, /<SettingsListRow icon=/, 'Settings surface must render design srow rows')
assert.doesNotMatch(files.settingsSurfaceContent, /<SettingCard\b/, 'Settings surface must not render the old grid card layout')
assert.match(files.css, /\.sscroll/, 'Settings page must have the design scrolling surface CSS')
assert.match(files.css, /\.sgroup/, 'Settings page must have the design group CSS')
assert.match(files.css, /\.srow/, 'Settings page must have the design row CSS')

console.log('editor topbar and plugin detail checks passed')
