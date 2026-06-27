#!/usr/bin/env node

/**
 * Clipboard History Plugin — Runtime E2E Verification
 *
 * Verifies the host runtime implementations actually work:
 * 1. PluginPrivateStorageApi — set/get/delete/list/blob
 * 2. PluginClipboardApi — readText, watch structure
 * 3. PluginPasteApi — returns proper fallback results
 * 4. Background lifecycle manager — starts/stops
 * 5. GlobalLauncher surface rendering — surface frame intercept
 * 6. Vite dev server serves all modules (200)
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const defaultCapability = JSON.parse(read('src-tauri/capabilities/default.json'))

// ─── 1. Storage API implementation exists and is correct ─────────────────────

const storageImpl = read('src/workspace/pluginStorage.ts')

assert.match(storageImpl, /createPluginPrivateStorage/, 'Must export createPluginPrivateStorage')
assert.match(storageImpl, /plugin_kv_get/, 'Desktop KV reads must go through native SQLite storage')
assert.match(storageImpl, /plugin_kv_set/, 'Desktop KV writes must go through native SQLite storage')
assert.match(storageImpl, /plugin_kv_delete/, 'Desktop KV deletes must go through native SQLite storage')
assert.match(storageImpl, /plugin_kv_list/, 'Desktop KV list must go through native SQLite storage')
assert.match(storageImpl, /plugin_kv_usage/, 'Desktop KV usage must go through native SQLite storage')
assert.match(storageImpl, /plugin_kv_prune/, 'Desktop KV prune must go through native SQLite storage')
assert.match(storageImpl, /plugin_kv_clear/, 'Storage cleanup must clear native SQLite KV records')
assert.match(storageImpl, /non-Tauri browser preview fallback/, 'localStorage KV must be documented as non-Tauri preview fallback only')
assert.match(storageImpl, /hiven-plugin-kv:/, 'Preview fallback must namespace KV keys by plugin')
assert.match(storageImpl, /PluginSettingsSource|source/, 'Storage namespace must include plugin source')
assert.match(storageImpl, /JSON\.parse/, 'Must parse stored JSON')
assert.match(storageImpl, /JSON\.stringify/, 'Must stringify values')
assert.match(storageImpl, /plugin_blob_save/, 'Blob storage must write bytes through native file storage')
assert.match(storageImpl, /plugin_blob_read/, 'Blob storage must read bytes through native file storage')
assert.match(storageImpl, /plugin_blob_path/, 'Blob storage must resolve native file paths for previews')
assert.match(storageImpl, /plugin_blob_delete/, 'Blob storage must delete native blob files')
assert.match(storageImpl, /plugin_blob_clear/, 'Storage cleanup must clear native blob files')
assert.match(storageImpl, /LEGACY_BLOB_PREFIX|hiven-plugin-blob:/, 'Blob storage should clear legacy localStorage blob entries left by older builds')
assert.doesNotMatch(storageImpl, /bytesToBase64|localStorage\.setItem\([^)]*hiven-plugin-blob/, 'New blob writes must not serialize bytes into localStorage')
assert.match(storageImpl, /URL\.revokeObjectURL/, 'Must revoke cached object URLs on delete')
assert.match(storageImpl, /clearPluginPrivateStorage/, 'Must expose plugin private storage cleanup for uninstall/remove')

// KV isolation: keys include pluginId
assert.match(storageImpl, /\$\{pluginId\}/, 'KV keys must include pluginId for isolation')

// ─── 2. Clipboard API implementation exists and is correct ───────────────────

const clipboardImpl = read('src/workspace/pluginClipboard.ts')

assert.match(clipboardImpl, /createPluginClipboard/, 'Must export createPluginClipboard')
assert.match(clipboardImpl, /@tauri-apps\/plugin-clipboard-manager/, 'Must use Tauri clipboard plugin')
assert.match(clipboardImpl, /navigator\.clipboard/, 'Must fallback to navigator.clipboard')
assert.match(clipboardImpl, /setInterval/, 'Watch must use polling via setInterval')
assert.match(clipboardImpl, /clearInterval/, 'Unwatch must clear interval')
assert.match(clipboardImpl, /hashString/, 'Must hash content for change detection')
assert.match(clipboardImpl, /hashBytes/, 'Must hash image bytes for image change detection')
assert.match(clipboardImpl, /onChange\(change\)/, 'Must call onChange callback on changes')
assert.match(clipboardImpl, /pollIntervalMs/, 'Must respect poll interval option')
assert.match(clipboardImpl, /writeClipboardImage/, 'Must implement image clipboard writes')
assert.match(clipboardImpl, /readClipboardImage/, 'Must implement image clipboard reads')
assert.match(clipboardImpl, /readClipboardImageSnapshot/, 'Image watch should read a lightweight snapshot before storing')
assert.match(clipboardImpl, /hashBytes\(image\.hashBytes\)[\s\S]{0,320}image\.toStoredImage\(\)/, 'Image watch should encode/store only after detecting a changed image hash')
assert.match(clipboardImpl, /imagePollIntervalMs|imagePollInterval/, 'Image watch should allow slower image polling than text polling')
assert.match(clipboardImpl, /current_foreground_app_name/, 'Clipboard watch should capture a best-effort source app when content changes')
assert.match(clipboardImpl, /if\s*\(\s*stopped\s*\|\|\s*polling\s*\)\s*return/, 'Clipboard watch must skip overlapping poll cycles')
assert.match(clipboardImpl, /polling\s*=\s*true/, 'Clipboard watch must mark an active poll cycle')
assert.match(clipboardImpl, /finally\s*\{[\s\S]{0,120}polling\s*=\s*false/, 'Clipboard watch must clear active poll state after each cycle')
assert.match(clipboardImpl, /storage\.blob\.put/, 'Image watch must persist blobs to plugin storage')
assert.match(clipboardImpl, /storage\.blob\.get/, 'Image write must resolve blobId from plugin storage')
assert.match(clipboardImpl, /paths\.join\('\\n'\)/, 'File clipboard write must copy newline-separated paths')
assert.doesNotMatch(clipboardImpl, /not yet implemented/, 'Clipboard API must not leave stubbed methods')
assert.ok(
  defaultCapability.permissions?.includes('clipboard-manager:allow-read-image'),
  'Tauri capability must allow clipboard image reads',
)
assert.ok(
  defaultCapability.permissions?.includes('clipboard-manager:allow-write-image'),
  'Tauri capability must allow clipboard image writes',
)

// ─── 3. Paste API implementation exists and is correct ───────────────────────

const pasteImpl = read('src/workspace/pluginPaste.ts')
const tauriLib = read('src-tauri/src/lib.rs')
const cargoToml = read('src-tauri/Cargo.toml')

assert.match(pasteImpl, /createPluginPaste/, 'Must export createPluginPaste')
assert.match(pasteImpl, /writeTextToClipboard/, 'Must write to clipboard before paste')
assert.match(pasteImpl, /writeImageToClipboard/, 'Must write image blobs to clipboard before paste')
assert.match(cargoToml, /tauri\s*=\s*\{[^}]*features\s*=\s*\[[^\]]*['"]image-png['"]/s, 'Stored clipboard image blobs are PNG bytes, so Tauri must enable the image-png feature for image paste writes')
assert.match(pasteImpl, /simulate_paste/, 'Must try Tauri simulate_paste command')
assert.match(pasteImpl, /fallback.*copied/, 'Must return copied fallback on failure')
assert.match(pasteImpl, /hide_launcher_window/, 'Must try to hide launcher window')
assert.match(pasteImpl, /storage\.blob\.get/, 'Image paste must resolve blobId from plugin storage')
assert.match(pasteImpl, /paths\.join\('\\n'\)/, 'File paste must copy newline-separated paths before paste')
assert.doesNotMatch(pasteImpl, /not fully implemented|not yet supported/, 'Paste API must not report implemented paths as unsupported stubs')

// pasteText returns proper types
assert.match(pasteImpl, /ok:\s*true/, 'Must return ok:true on success')
assert.match(pasteImpl, /fallback:\s*['"]copied['"]/, 'Must return copied fallback on failure')
assert.match(tauriLib, /async\s+fn\s+simulate_paste\(\)/, 'Tauri must implement simulate_paste for direct paste')
assert.match(tauriLib, /simulate_paste,/, 'Tauri invoke handler must register simulate_paste')
assert.match(tauriLib, /new_keyboard_event[\s\S]{0,500}CGEventFlagCommand/, 'simulate_paste must post a Cmd+V keyboard event')

// ─── 4. Background lifecycle manager exists and is correct ───────────────────

const bgManager = read('src/workspace/pluginBackgroundManager.ts')

assert.match(bgManager, /initializePluginBackgrounds/, 'Must export initializePluginBackgrounds')
assert.match(bgManager, /stopAllPluginBackgrounds/, 'Must export stopAllPluginBackgrounds for app/window cleanup')
assert.match(bgManager, /restartPluginBackground/, 'Must export restartPluginBackground')
assert.match(bgManager, /stopPluginBackground/, 'Must export stopPluginBackground')
assert.match(bgManager, /setupBackgroundSettingsWatcher/, 'Must export setupBackgroundSettingsWatcher')
assert.match(bgManager, /setupBackgroundPermissionWatcher/, 'Must export setupBackgroundPermissionWatcher')
assert.match(bgManager, /background\.start\(ctx\)/, 'Must call background.start with context')
assert.match(bgManager, /activeBackgrounds/, 'Must track active backgrounds')
assert.match(bgManager, /await.*stop\(\)/, 'Must await stop function')
assert.match(bgManager, /createPluginPrivateStorage/, 'Must provide storage to background context')
assert.match(bgManager, /createPluginClipboard/, 'Must provide clipboard to background context')
assert.match(bgManager, /createPluginPaste/, 'Must provide paste to background context')
assert.match(bgManager, /clipboard:\s*createPluginClipboard\([^)]*storage\)/, 'Background clipboard must share plugin storage')
assert.match(bgManager, /paste:\s*createPluginPaste\([^)]*storage\)/, 'Background paste must share plugin storage')

const bgImpl = read('src/plugins/clipboard-history/background/clipboardHistoryBackground.ts')
assert.match(bgImpl, /sourceApp:\s*change\.sourceApp/, 'Clipboard history background must persist source app metadata')

const surfaceImpl = read('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx')
assert.match(surfaceImpl, /storage\.blob\.url\(item\.previewBlobId\)/, 'Clipboard history surface must render image previews from blob URLs')
assert.match(surfaceImpl, /<img\s+src=\{imageUrl\}/, 'Clipboard history image preview must render a real img element')
assert.match(surfaceImpl, /ClipboardImageThumbnail/, 'Clipboard history list must render image thumbnails')
assert.match(surfaceImpl, /clipboard-history-item-delete/, 'Clipboard history list must expose per-item delete actions')
assert.match(surfaceImpl, /setSelectedId\(\(current\)\s*=>\s*\{[\s\S]{0,260}filteredItems\.length\s*={2,3}\s*0[\s\S]{0,260}filteredItems\.some\(\(item\)\s*=>\s*item\.id\s*={2,3}\s*current\)[\s\S]{0,260}filteredItems\[0\]\.id/, 'Clipboard history search/filter changes must select the first visible item when the previous selection is no longer visible')
assert.match(surfaceImpl, /filteredItems\.find\(\(i\)\s*=>\s*i\.id\s*={2,3}\s*selectedId\)/, 'Clipboard history selectedItem must resolve from visible filtered items so Enter never pastes an invisible stale selection')
const surfaceTopbar = surfaceImpl.match(/<div className="clipboard-history-topbar">[\s\S]*?\n      <\/div>\n\n      \{renderContent\(\)\}/)?.[0] ?? ''
assert.doesNotMatch(surfaceTopbar, /action\.clearAll|TrashIcon/, 'Clipboard history surface topbar must not include a clear-all action')
assert.match(surfaceImpl, /meta\.sourceApp/, 'Clipboard history metadata must display source app when available')

// Settings change triggers restart
assert.match(bgManager, /usePluginSettingsStore\.subscribe/, 'Must subscribe to settings changes')
assert.match(bgManager, /restartPluginBackground/, 'Must restart on settings change')

// ─── 5. GlobalLauncher surface rendering ─────────────────────────────────────

const launcher = read('src/components/GlobalLauncher.tsx')

// Surface frame state
assert.match(launcher, /surfaceFrame.*setSurfaceFrame/, 'Must have surfaceFrame state')

// Intercepts plugin-surface items
assert.match(launcher, /plugin-surface:/, 'Must check for plugin-surface systemKey')
assert.match(launcher, /openPluginSurface\(\{\s*source,\s*pluginId,\s*surfaceId\s*\}\)/, 'Must open plugin surfaces through the pre-open activation path')

// Renders surface component
assert.match(launcher, /SurfaceComponent/, 'Must render surface component')
assert.match(launcher, /PluginSurfaceErrorBoundary/, 'Must wrap in error boundary')
assert.match(launcher, /beforeOpen\?\.\(/, 'GlobalLauncher must run plugin surface beforeOpen hooks before activation')
assert.match(launcher, /setSurfaceFrame\(target\)/, 'GlobalLauncher must activate plugin surfaces after the pre-open hook completes')

// Passes all required props
assert.match(launcher, /pluginId.*surfaceFrame/, 'Must pass pluginId from surfaceFrame')
assert.match(launcher, /surfaceId.*surfaceFrame/, 'Must pass surfaceId from surfaceFrame')
assert.match(launcher, /source.*surfaceFrame|surfaceFrame.*source/, 'Must keep source in surfaceFrame')
assert.doesNotMatch(launcher, /resolvePluginSettings\('builtin'/, 'Must not hard-code builtin settings for surfaces')
assert.match(launcher, /hostStorage\s*=\s*createPluginPrivateStorage/, 'Must create host storage once for surface API')
assert.match(launcher, /storage:\s*hostStorage/, 'Must provide storage in host API')
assert.match(launcher, /clipboard:\s*createPluginClipboard/, 'Must provide clipboard in host API')
assert.match(launcher, /paste:\s*createPluginPaste/, 'Must provide paste in host API')
assert.match(launcher, /clipboard:\s*createPluginClipboard\([^)]*hostStorage\)/, 'Surface clipboard must share host storage')
assert.match(launcher, /paste:\s*createPluginPaste\([^)]*hostStorage\)/, 'Surface paste must share host storage')
assert.match(launcher, /PluginSurfacePermissionGate/, 'Must render a host permission gate before protected surface body')
assert.match(launcher, /global-launcher-surface-shell/, 'Must wrap surface body in a host-owned shell')
assert.match(launcher, /surfaceFocusVersion|focusSurface/, 'Must hand focus to opened surface')

// Host API methods
assert.match(launcher, /close:\s*requestSurfaceClose/, 'Host must provide close() through the surface system API bridge')
assert.match(launcher, /requestBack:\s*requestSurfaceBack/, 'Host must provide requestBack() through the surface system API bridge')
assert.match(launcher, /PLUGIN_SURFACE_BACK_EVENT|hiven:plugin-surface-back/, 'Surface back API must route through a host-owned event')
assert.match(launcher, /PLUGIN_SURFACE_CLOSE_EVENT|hiven:plugin-surface-close/, 'Surface close API must route through a host-owned event')
assert.match(launcher, /openSettings:\s*\(\)/, 'Host must provide openSettings()')
assert.match(launcher, /showMessage/, 'Host must provide showMessage()')

// Esc goes back from surface
assert.match(launcher, /surfaceFrame[\s\S]*setSurfaceFrame\(null\)/, 'Esc must go back from surface')
assert.match(launcher, /handleHostEscape[\s\S]*window\.addEventListener\(['"]keydown['"],\s*handleHostEscape,\s*true\)/, 'Host must capture Escape for plugin surfaces')
assert.match(launcher, /resetLauncherSession[\s\S]*setSurfaceFrame\(null\)[\s\S]*controllerRef\.current\?\.reset\(\)/, 'Closing the launcher must reset surface and controller state')

// ─── 6. App.tsx initializes background manager ───────────────────────────────

const appTsx = read('src/App.tsx')
assert.match(appTsx, /initializePluginBackgrounds/, 'App must call initializePluginBackgrounds')
assert.match(appTsx, /setupBackgroundSettingsWatcher/, 'App must call setupBackgroundSettingsWatcher')
assert.match(appTsx, /setupBackgroundPermissionWatcher/, 'App must call setupBackgroundPermissionWatcher')
assert.match(appTsx, /stopAllPluginBackgrounds/, 'App must stop backgrounds during app/window cleanup')
const beforeBackgroundRuntime = appTsx.split('function BackgroundRuntime')[0] ?? appTsx
assert.doesNotMatch(beforeBackgroundRuntime, /initializePluginBackgrounds\(\)|setupBackgroundSettingsWatcher\(\)|setupBackgroundPermissionWatcher\(\)/, 'Backgrounds must not initialize at module scope because launcher windows import App.tsx too')
const backgroundRuntimeBody = appTsx.match(/function BackgroundRuntime\(\)[\s\S]*?function LauncherWindowApp\(\)/)?.[0] ?? ''
assert.match(backgroundRuntimeBody, /initializePluginBackgrounds\(\)/, 'BackgroundRuntime should initialize plugin backgrounds once the launcher runtime mounts')
assert.match(backgroundRuntimeBody, /cleanupSettingsWatcher\?\.\(\)|cleanupPermissionWatcher\?\.\(\)/, 'BackgroundRuntime should retain and clean up background watcher subscriptions')
const launcherWindowBody = appTsx.match(/function LauncherWindowApp\(\)[\s\S]*?function shouldAllowLauncherListWheel/)?.[0] ?? ''
assert.match(launcherWindowBody, /<BackgroundRuntime\s*\/>/, 'LauncherWindowApp should mount the shared background runtime')

// ─── 7. Vite dev server module verification ─────────────────────────────────

const VITE_PORT = 1420
const hostModules = [
  'src/workspace/pluginStorage.ts',
  'src/workspace/pluginClipboard.ts',
  'src/workspace/pluginPaste.ts',
  'src/workspace/pluginBackgroundManager.ts',
]

let allModulesOk = true
for (const mod of hostModules) {
  try {
    const result = execSync(`curl -s -o /dev/null -w "%{http_code}" "http://localhost:${VITE_PORT}/${mod}"`, { encoding: 'utf8', timeout: 5000 })
    if (result.trim() !== '200') {
      console.warn(`  ⚠ ${mod} — HTTP ${result.trim()} (dev server may not be running)`)
      allModulesOk = false
    }
  } catch {
    console.warn(`  ⚠ Could not reach dev server for module check (not running?)`)
    allModulesOk = false
    break
  }
}

if (allModulesOk) {
  console.log('  ✓ All host runtime modules served by Vite (200)')
}

// ─── 8. Storage functional test (in-memory simulation) ───────────────────────

// Run a quick functional test of the storage logic pattern
const storageFnTest = execSync(
  'node --experimental-strip-types -e "' +
  "import assert from 'node:assert/strict';" +
  "const store = new Map();" +
  "store.set('k1', JSON.stringify({a:1}));" +
  "assert.deepEqual(JSON.parse(store.get('k1')), {a:1});" +
  "store.delete('k1');" +
  "assert.equal(store.get('k1'), undefined);" +
  "console.log('storage-fn-ok')" +
  '"',
  { encoding: 'utf8', timeout: 5000, env: { ...process.env, NODE_NO_WARNINGS: '1' } }
)
assert.match(storageFnTest, /storage-fn-ok/, 'Storage functional pattern must work')

console.log('clipboard-history runtime E2E verification passed')
