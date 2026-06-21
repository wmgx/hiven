#!/usr/bin/env node

/**
 * Clipboard History Plugin — Integration Test
 *
 * Simulates the runtime loading path:
 * 1. Plugin definition is loaded via bundledPluginLoader glob
 * 2. registerProductionPlugin stores the definition
 * 3. collectStaticPluginItems() generates a launcher item from ui.surfaces
 * 4. Settings schema can be rendered by the host
 * 5. GlobalLauncher can find the surface via title/aliases matching
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

// ─── 1. Plugin definition structure ─────────────────────────────────────────

const indexContent = read('src/plugins/clipboard-history/index.tsx')
const bundledLoaderContent = read('src/workspace/bundledPluginLoader.ts')
const appCssContent = read('src/index.css')
const pluginStyleContent = read('src/plugins/clipboard-history/style.css')

// definePlugin is called with settings + ui + background
assert.match(indexContent, /definePlugin/, 'Must call definePlugin')
assert.match(indexContent, /settings:\s*\{/, 'Must declare settings contribution')
assert.match(indexContent, /ui:\s*\{/, 'Must declare ui contribution')
assert.match(indexContent, /background:\s*/, 'Must declare background contribution')

// ui.surfaces declares at least one surface
assert.match(indexContent, /surfaces:\s*\[/, 'Must declare surfaces array')
assert.match(indexContent, /id:\s*['"]main['"]/, 'Must declare surface with id "main"')
assert.match(indexContent, /kind:\s*['"]custom-view['"]/, 'Surface kind must be custom-view')
assert.match(indexContent, /component:\s*ClipboardHistorySurface/, 'Surface component must reference ClipboardHistorySurface')

// entry.launcher is true (default or explicit)
assert.match(indexContent, /launcher:\s*true/, 'Surface entry.launcher must be true')
assert.match(indexContent, /shortcutBindable:\s*true/, 'Surface entry.shortcutBindable must be true')

// aliases for launcher search
assert.match(indexContent, /aliases:\s*\[/, 'Surface must have aliases for search')
assert.match(indexContent, /['"]clipboard['"]/, 'Aliases must include "clipboard"')
assert.match(indexContent, /['"]剪贴板['"]/, 'Aliases must include Chinese "剪贴板"')

// ─── 2. Launcher registry generates item from surface ────────────────────────

const registryContent = read('src/workspace/launcher/registry.ts')

// Must iterate ui.surfaces
assert.match(registryContent, /def\.ui\?\.surfaces/, 'Registry must access def.ui?.surfaces')

// Must check entry.launcher !== false
assert.match(registryContent, /entry\?\.launcher\s*===\s*false/, 'Registry must skip surfaces with launcher=false')

// Must generate systemKey with plugin-surface prefix
assert.match(registryContent, /getPluginSurfaceItemKey\(settingsSource,\s*pluginId,\s*surface\.id\)/, 'Registry must generate source-aware surface systemKey')

// Must set surfaces to global-launcher
assert.match(registryContent, /surfaces:\s*\[['"]global-launcher['"]\]/, 'Surface item must appear in global-launcher')

// Must pass display.title and display.aliases from surface contribution
assert.match(registryContent, /title:\s*surface\.title/, 'Must pass surface title to launcher display')
assert.match(registryContent, /aliases:\s*surface\.aliases/, 'Must pass surface aliases to launcher display')

// ─── 3. Settings render through host schema controls ─────────────────────────

assert.equal(
  existsSync(join(root, 'src/plugins/clipboard-history/settings/ClipboardHistorySettingsBody.tsx')),
  false,
  'Clipboard history must not keep the legacy custom settings body',
)

assert.match(indexContent, /schema:\s*\{/, 'Clipboard history must declare a settings schema')
assert.match(indexContent, /key:\s*['"]enabled['"]/, 'Settings schema must include enabled')
assert.match(indexContent, /key:\s*['"]recordText['"]/, 'Settings schema must include recordText')
assert.match(indexContent, /key:\s*['"]recordImages['"]/, 'Settings schema must include recordImages')
assert.match(indexContent, /key:\s*['"]recordFiles['"]/, 'Settings schema must include recordFiles')
assert.match(indexContent, /key:\s*['"]maxItems['"]/, 'Settings schema must include maxItems')
assert.match(indexContent, /key:\s*['"]retentionDays['"]/, 'Settings schema must include retentionDays')
assert.match(indexContent, /key:\s*['"]maxTextBytes['"]/, 'Settings schema must include maxTextBytes')
assert.match(indexContent, /key:\s*['"]maxImageBytes['"]/, 'Settings schema must include maxImageBytes')
assert.match(indexContent, /key:\s*['"]maxTotalCacheBytes['"]/, 'Settings schema must include maxTotalCacheBytes')

// ─── 4. i18n completeness ───────────────────────────────────────────────────

const enLocale = JSON.parse(read('src/plugins/clipboard-history/locales/en.json'))
const zhLocale = JSON.parse(read('src/plugins/clipboard-history/locales/zh.json'))

const requiredKeys = [
  'settings.enabled',
  'settings.recordText',
  'settings.recordImages',
  'settings.recordFiles',
  'settings.maxItems',
  'settings.retentionDays',
  'settings.clearAll',
  'settings.clearAll.confirm',
  'surface.main.title',
  'search.placeholder',
  'filter.all',
  'filter.text',
  'filter.image',
  'filter.files',
  'filter.label',
  'group.today',
  'group.yesterday',
  'state.loading',
  'state.disabled',
  'state.empty',
  'preview.empty',
  'hint.paste',
  'hint.copy',
  'hint.delete',
  'action.back',
  'action.close',
  'message.copied',
  'message.cleared',
  'message.deleted',
  'meta.contentType',
  'meta.characters',
  'meta.words',
  'meta.byteSize',
  'meta.dimensions',
  'meta.files',
  'meta.firstCopied',
  'meta.lastCopied',
  'error.loadFailed',
  'error.pasteFailed',
]

for (const key of requiredKeys) {
  assert.ok(key in enLocale, `en.json missing key: "${key}"`)
  assert.ok(key in zhLocale, `zh.json missing key: "${key}"`)
  assert.ok(enLocale[key].length > 0, `en.json key "${key}" is empty`)
  assert.ok(zhLocale[key].length > 0, `zh.json key "${key}" is empty`)
}

// ─── 5. Surface component structure ─────────────────────────────────────────

const surfaceContent = read('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx')
const cacheContent = read('src/plugins/clipboard-history/storage/clipboardHistoryCache.ts')

// Imports are from @hiven/plugin (SDK) and local relative paths only
assert.match(surfaceContent, /from\s*['"]@hiven\/plugin['"]/, 'Surface must import types from @hiven/plugin')
assert.match(surfaceContent, /from\s*['"]\.\.\/settings\/model['"]/, 'Surface must import settings model')
assert.match(surfaceContent, /from\s*['"]\.\.\/storage\//, 'Surface must import from storage')

// Accepts PluginSurfaceProps
assert.match(surfaceContent, /PluginSurfaceProps/, 'Surface must accept PluginSurfaceProps')

// Uses host.paste for terminal action
assert.match(surfaceContent, /host\.paste\.pasteText/, 'Surface must use host.paste.pasteText')
assert.match(surfaceContent, /host\.paste\.pasteImage/, 'Surface must use host.paste.pasteImage')
assert.match(surfaceContent, /host\.paste\.pasteFiles/, 'Surface must use host.paste.pasteFiles')

// Uses host.close() after paste
assert.match(surfaceContent, /host\.close\(\)/, 'Surface must call host.close() after paste')

// Uses host.clipboard for copy action
assert.match(surfaceContent, /host\.clipboard\.writeText/, 'Surface must use host.clipboard.writeText for copy')

// Has keyboard handling (Enter, Delete, ArrowUp, ArrowDown)
assert.match(surfaceContent, /['"]Enter['"]/, 'Surface must handle Enter key')
assert.match(surfaceContent, /['"]Delete['"]|['"]Backspace['"]/, 'Surface must handle Delete/Backspace key')
assert.match(surfaceContent, /['"]ArrowDown['"]/, 'Surface must handle ArrowDown key')
assert.match(surfaceContent, /['"]ArrowUp['"]/, 'Surface must handle ArrowUp key')

// Has search/filter capability
assert.match(surfaceContent, /setQuery|query/, 'Surface must have search query state')
assert.match(surfaceContent, /setFilter|filter/, 'Surface must have filter state')
assert.match(surfaceContent, /host\.requestBack\(\)/, 'Surface must render plugin-owned back affordance through host.requestBack()')
assert.match(surfaceContent, /clipboard-history-topbar[\s\S]*<SearchField/, 'Surface must keep search in the top bar')
assert.match(surfaceContent, /clipboard-history-list-toolbar[\s\S]*<SegmentedControl/, 'Surface must place the type filter above the left history list')
assert.doesNotMatch(surfaceContent, /<Select[\s\S]{0,600}filter\.all/, 'Surface type filter must not use a native select menu')
assert.match(surfaceContent, /<SurfaceList[\s\S]{0,180}data-launcher-scrollable/, 'Surface history list must opt into launcher window wheel scrolling')
assert.match(surfaceContent, /<SurfacePreview[\s\S]{0,180}data-launcher-scrollable/, 'Surface preview pane must opt into launcher window wheel scrolling')
assert.match(surfaceContent, /clipboard-history-preview-content[\s\S]{0,120}data-launcher-scrollable/, 'Surface preview content must opt into launcher window wheel scrolling')
assert.match(surfaceContent, /<SurfaceList|<SurfaceListItem|<SurfacePreview/, 'Surface must use plugin-ui list and preview primitives')
assert.match(surfaceContent, /function\s+ClipboardHistoryItemRow[\s\S]{0,900}useRef<[\s\S]{0,360}scrollIntoView\(\{\s*block:\s*['"]nearest['"]\s*\}\)/, 'Selected clipboard history rows must scroll into view during keyboard navigation')
assert.match(surfaceContent, /getMetaRows|meta\.firstCopied|meta\.lastCopied/, 'Surface must render detailed metadata for the selected item')
assert.doesNotMatch(surfaceContent, /clipboard-history-copy-count|meta\.timesCopied/, 'Surface must not display copy-count UI')

// Shell should be large enough for the custom surface opened by shortcut
assert.match(indexContent, /defaultWidth:\s*900/, 'Clipboard history surface should open wider than the compact launcher')
assert.match(indexContent, /defaultHeight:\s*640/, 'Clipboard history surface should open taller than the compact launcher')
assert.match(bundledLoaderContent, /plugins\/\*\/style\.css/, 'Bundled plugin loader must load plugin-owned style.css assets')
assert.doesNotMatch(appCssContent, /clipboard-history-/, 'App global CSS must not own clipboard-history product styles')
assert.match(pluginStyleContent, /\.clipboard-history-surface/, 'Clipboard history package must own its surface stylesheet')

// Has loading and disabled states
assert.match(surfaceContent, /loading/, 'Surface must handle loading state')
assert.match(surfaceContent, /settings\.enabled/, 'Surface must check settings.enabled')
assert.match(cacheContent, /subscribeCachedIndex/, 'Clipboard history cache must expose change subscriptions for already-open surfaces')
assert.match(surfaceContent, /subscribeCachedIndex/, 'Clipboard history surface must subscribe to cache updates so newly copied items appear while it is open')
assert.match(surfaceContent, /indexToListItems/, 'Clipboard history surface must map subscribed index snapshots into list items without waiting for remount')

// ─── 6. Background structure ─────────────────────────────────────────────────

const bgContent = read('src/plugins/clipboard-history/background/clipboardHistoryBackground.ts')

// Must not start when disabled
assert.match(bgContent, /if\s*\(\s*!ctx\.settings\.enabled\s*\)/, 'Background must check ctx.settings.enabled')

// Must return stop function
assert.match(bgContent, /return\s+stop/, 'Background must return stop function')

// Must clean up watcher
assert.match(bgContent, /unwatch\(\)|unwatch\s*=\s*null/, 'Background stop must clean up watcher')

// ─── 7. Manifest correctness ────────────────────────────────────────────────

const manifest = JSON.parse(read('src/plugins/clipboard-history/manifest.json'))

assert.equal(manifest.pluginId, 'clipboard-history')
assert.equal(manifest.version, '1.2.0')
assert.ok(manifest.capabilities.includes('settings'))
assert.ok(manifest.capabilities.includes('ui'))
assert.ok(manifest.capabilities.includes('background'))
assert.ok(manifest.permissions.includes('clipboard.read'))
assert.ok(manifest.permissions.includes('clipboard.write'))
assert.ok(manifest.permissions.includes('clipboard.watch'))
assert.ok(manifest.permissions.includes('storage.private'))
assert.ok(manifest.permissions.includes('accessibility.paste'))

console.log('clipboard-history integration tests passed')
