#!/usr/bin/env node
/**
 * browser-tabs first-party plugin: host SDK desktopTargets + install guide + no host deep imports.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p) => readFileSync(join(root, p), 'utf8')

for (const path of [
  'src/plugins/browser-tabs/manifest.json',
  'src/plugins/browser-tabs/index.tsx',
  'src/plugins/browser-tabs/provider.ts',
  'src/plugins/browser-tabs/settings/BrowserTabsSettingsBody.tsx',
  'src/workspace/desktopTargets/pluginApi.ts',
]) {
  assert.ok(existsSync(join(root, path)), `${path} must exist`)
}

const sdk = read('src/pluginHostSdk.ts')
const pluginSdk = read('src/plugin-sdk.ts')
const host = read('src/workspace/launcher/hostProvider.ts')
const pluginIndex = read('src/plugins/browser-tabs/index.tsx')
const provider = read('src/plugins/browser-tabs/provider.ts')
const settings = read('src/plugins/browser-tabs/settings/BrowserTabsSettingsBody.tsx')
const rust = read('src-tauri/src/lib.rs')
const catalog = read('src/workspace/pluginProductCatalog.ts')

assert.match(sdk, /desktopTargets:\s*DesktopTargetsHostApi/)
assert.match(sdk, /createDesktopTargetsHostApi/)
assert.match(pluginSdk, /DesktopTargetsHostApi/)
assert.match(pluginSdk, /DesktopTargetProvider/)

assert.match(pluginIndex, /registerChromiumTabsProvider|applyProviderRegistration/)
assert.match(pluginIndex, /hooks:\s*\{[\s\S]*startup/)
assert.match(pluginIndex, /component:\s*BrowserTabsSettingsBody/)
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
assert.match(provider, /if\s*\(!q\)\s*return\s*\[\]/)
assert.match(settings, /openChromiumExtensionInstallFolder/)

// Host must NOT register chromium provider directly (plugin owns it).
assert.doesNotMatch(host, /chromiumTabsProvider/)
assert.doesNotMatch(host, /vscodeDocumentsProvider|editor\.vscode/, 'D4 vscode provider must be removed')
assert.match(host, /hostWindowTargetProvider/)
assert.match(host, /getDesktopBridgeLauncherDynamicItems/)

assert.match(rust, /prepare_chromium_extension_package/)
assert.match(rust, /reveal_path_in_file_manager/)
assert.match(
  rust,
  /plugins.*builtin.*browser-tabs.*extension|join\("plugins"\)[\s\S]*join\("builtin"\)[\s\S]*join\("browser-tabs"\)[\s\S]*join\("extension"\)/,
  'extension package must live under plugins/builtin/browser-tabs/extension',
)
assert.doesNotMatch(rust, /bridges.*chromium-tabs/, 'must not use bridges/chromium-tabs path')
assert.ok(
  existsSync(join(root, 'src/plugins/browser-tabs/extension/manifest.json')),
  'extension must ship inside the browser-tabs plugin package',
)

assert.match(catalog, /browser-tabs/)

// Plugin must not deep-import workspace
assert.doesNotMatch(provider, /from ['"]\.\.\/\.\.\/workspace\//)
assert.doesNotMatch(settings, /from ['"]\.\.\/\.\.\/workspace\//)
assert.match(provider, /from ['"]@hiven\/plugin['"]/)

console.log('browser-tabs plugin contract checks passed')
