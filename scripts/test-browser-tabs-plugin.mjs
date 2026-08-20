#!/usr/bin/env node
/**
 * Browser capability (merged into `web-open`, product name “Browser / 浏览器”):
 * host SDK desktopTargets + install guide + no host deep imports.
 * The former `browser-tabs` plugin now lives inside web-open, including its
 * Chromium extension source under src/plugins/web-open/extension (embedded by Rust).
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p) => readFileSync(join(root, p), 'utf8')

for (const path of [
  'src/plugins/web-open/manifest.json',
  'src/plugins/web-open/index.tsx',
  'src/plugins/web-open/browserProvider.ts',
  'src/plugins/web-open/settings/BrowserTabsConnectionModal.tsx',
  'src/workspace/desktopTargets/pluginApi.ts',
]) {
  assert.ok(existsSync(join(root, path)), `${path} must exist`)
}

// browser-tabs is no longer a standalone plugin: no manifest/index at its root.
assert.ok(!existsSync(join(root, 'src/plugins/browser-tabs/manifest.json')), 'browser-tabs must no longer register as a plugin')
assert.ok(!existsSync(join(root, 'src/plugins/browser-tabs/index.tsx')), 'browser-tabs plugin entry must be gone (merged into web-open)')

const sdk = read('src/pluginHostSdk.ts')
const pluginSdk = read('src/plugin-sdk.ts')
const host = read('src/workspace/launcher/hostProvider.ts')
const pluginIndex = read('src/plugins/web-open/index.tsx')
const provider = read('src/plugins/web-open/browserProvider.ts')
const settings = read('src/plugins/web-open/settings/BrowserTabsConnectionModal.tsx')
const rust = read('src-tauri/src/lib.rs')
const catalog = read('src/workspace/pluginProductCatalog.ts')

assert.match(sdk, /desktopTargets:\s*DesktopTargetsHostApi/)
assert.match(sdk, /createDesktopTargetsHostApi/)
assert.match(pluginSdk, /DesktopTargetsHostApi/)
assert.match(pluginSdk, /DesktopTargetProvider/)

assert.match(pluginIndex, /registerChromiumTabsProvider|applyBrowserCapability/)
assert.match(pluginIndex, /hooks:\s*\{[\s\S]*startup/)
assert.match(pluginIndex, /component:\s*BrowserTabsConnectionModal/)
assert.match(pluginIndex, /schema:\s*\{/, 'settings schema metadata for list description / gear hosts')
const pluginsContent = read('src/surfaces/PluginsContent.tsx')
assert.match(
  pluginsContent,
  /settingsContribution\.schema\s*\|\|\s*settingsContribution\.component/,
  'plugins list gear must show for schema OR custom settings component',
)
const settingsDialog = read('src/components/PluginSettingsDialog.tsx')
assert.match(
  settingsDialog,
  /SettingsComponent\s*\?\s*\([\s\S]*contribution\.schema/,
  'settings dialog must prefer custom component over schema form',
)
assert.match(provider, /browser\.chromium/)
assert.match(provider, /getPluginHostSdk\(\)\.desktopTargets/)
// Empty open now recommends the tabs worth returning to, ranked by visit
// frecency, instead of returning nothing. See test-browser-empty-open-recommend.mjs.
assert.match(provider, /if\s*\(!q\)\s*return\s*buildEmptyOpenTargets\(\)/)
assert.match(provider, /listHistory/)
assert.match(provider, /openUrl/)
assert.match(provider, /setSourceConfig/)
assert.match(settings, /openChromiumExtensionInstallFolder/)
assert.match(settings, /historyEnabled/)
assert.match(settings, /autoCloseIdleTabs/)
assert.match(settings, /idleTimeoutMinutes/)

// Host must NOT register chromium provider directly (plugin owns it).
assert.doesNotMatch(host, /chromiumTabsProvider/)
assert.doesNotMatch(host, /vscodeDocumentsProvider|editor\.vscode/, 'D4 vscode provider must be removed')
assert.match(host, /hostWindowTargetProvider/)
assert.match(host, /getDesktopBridgeLauncherDynamicItems/)

assert.match(rust, /prepare_chromium_extension_package/)
assert.match(rust, /reveal_path_in_file_manager/)
assert.match(
  rust,
  /plugins.*builtin.*web-open.*extension|join\("plugins"\)[\s\S]*join\("builtin"\)[\s\S]*join\("web-open"\)[\s\S]*join\("extension"\)/,
  'extension package must live under plugins/builtin/web-open/extension',
)
assert.doesNotMatch(rust, /bridges.*chromium-tabs/, 'must not use bridges/chromium-tabs path')
assert.ok(
  existsSync(join(root, 'src/plugins/web-open/extension/manifest.json')),
  'extension must ship inside the web-open plugin package',
)

// Merged: the browser product is web-open renamed to Browser / 浏览器 (no separate browser-tabs entry).
assert.match(catalog, /product\('web-open', 'Browser'[\s\S]*?浏览器/)
assert.doesNotMatch(catalog, /product\('browser-tabs'/, 'browser-tabs must no longer be a separate product')

// Plugin must not deep-import workspace
assert.doesNotMatch(provider, /from ['"]\.\.\/\.\.\/workspace\//)
assert.doesNotMatch(settings, /from ['"]\.\.\/\.\.\/workspace\//)
assert.match(provider, /from ['"]@hiven\/plugin['"]/)

console.log('browser-tabs plugin contract checks passed')
