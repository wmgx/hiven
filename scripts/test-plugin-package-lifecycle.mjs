import fs from 'node:fs'
import assert from 'node:assert/strict'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function assertHas(source, pattern, message) {
  assert.match(source, pattern, message)
}

function assertNotHas(source, pattern, message) {
  assert.doesNotMatch(source, pattern, message)
}

const files = {
  packageJson: read('package.json'),
  pluginsSurfaceContent: read('src/surfaces/PluginsContent.tsx'),
  settingsContent: read('src/surfaces/SettingsContent.tsx'),
  pluginRuntime: read('src/workspace/pluginRuntime.ts'),
  pluginTypes: read('src/workspace/pluginTypes.ts'),
  configInit: read('src/configInit.ts'),
  tauriLib: read('src-tauri/src/lib.rs'),
}

assertHas(files.packageJson, /test:plugin-package-lifecycle/, 'package.json should expose plugin package lifecycle verifier')

assertHas(files.pluginRuntime, /export\s+async\s+function\s+uninstallPlugin/, 'uninstallPlugin should be async so it can remove package directories')
assertHas(files.pluginRuntime, /remove_plugin_dir/, 'uninstallPlugin should call the Tauri remove_plugin_dir command for installed packages')
assertHas(files.pluginRuntime, /const\s+installedRoot\s*=\s*await\s+getInstalledPluginRoot\(\)/, 'uninstallPlugin should resolve the installed plugin root')
assertHas(files.pluginRuntime, /rootPath:\s*installedRoot/, 'uninstallPlugin should delete from the installed plugin root')
assertHas(files.pluginRuntime, /clearPluginHostState/, 'plugin runtime should centralize settings/permission/storage/shortcut cleanup')
assertHas(files.pluginRuntime, /clearPluginPrivateStorage/, 'installed uninstall should clear plugin private storage')
assertHas(files.pluginRuntime, /clearPluginShortcuts/, 'installed uninstall and dev remove should clear surface shortcuts')
assertHas(files.pluginRuntime, /clearPluginPermissions/, 'installed uninstall and dev remove should clear permission grants')
assertHas(files.pluginRuntime, /removePluginSettings/, 'installed uninstall and dev remove should clear plugin settings')
assertHas(files.pluginsSurfaceContent, /await\s+uninstallPlugin\(plugin\.pluginId\)/, 'PluginsManagerSurfaceContent uninstall button should await physical uninstall')
assertHas(files.pluginsSurfaceContent, /setUpdateStatus\(['"`]checking['"`]\)|setUpdateStatus\(['"`]done['"`]\)/, 'PluginsManagerSurfaceContent should refresh directory summaries after uninstall')
// Builtin-package update checking moved from the plugins page to the settings
// page; this assertion had been pinned to the old home. PluginsContent now only
// flips a local status flag on uninstall (see the note in the cleanup commit).
assertHas(
  files.settingsContent,
  /const\s+result\s*=\s*await\s+checkBuiltinPluginsUpdate\(\)[\s\S]*result\.error[\s\S]*setPluginStatus\(['"`]error['"`]\)/,
  'settings page package update checks should surface checkBuiltinPluginsUpdate returned errors',
)

assertNotHas(files.configInit, /createScriptPluginEntrySource|parseScriptToAction/, 'configInit should no longer use the legacy defineAction parser/wrapper')
assertNotHas(files.configInit, /releaseUserScriptPluginPackages|releaseBuiltinScriptPluginPackages/, 'configInit should no longer release defineAction scripts as packages')
assertNotHas(files.configInit, /DEMO_PLUGIN_SOURCE|demo-text-plugin/, 'configInit should no longer ship a defineAction demo plugin')

assertHas(files.tauriLib, /display_name_i18n|displayNameI18n/, 'Tauri PluginDirSummary should include displayNameI18n')
assertHas(files.tauriLib, /get\("displayNameI18n"\)/, 'Tauri manifest summary should read displayNameI18n from manifest.json')
assertHas(files.pluginsSurfaceContent, /displayNameI18n:\s*pkg\.displayNameI18n/, 'PluginsManagerSurfaceContent should preserve displayNameI18n when syncing scanned packages into store')
assertHas(files.pluginsSurfaceContent, /updatePluginMetadata\(pkg\.pluginId[\s\S]*displayNameI18n:\s*pkg\.displayNameI18n/, 'PluginsManagerSurfaceContent should refresh displayNameI18n for already persisted packages')
assertHas(files.pluginsSurfaceContent, /function\s+pluginDisplayName[\s\S]*localized\([\s\S]*displayNameI18n[\s\S]*locale[\s\S]*\)/, 'PluginsManagerSurfaceContent should localize plugin package display names from displayNameI18n')
// The plugin manager became master-detail: the localized name is no longer passed
// straight into JSX, it lands on the row model (`title:`) that the list renders.
assertHas(files.pluginsSurfaceContent, /title:\s*pluginDisplayName\(plugin,\s*locale\)/, 'PluginsManagerSurfaceContent rows should carry localized plugin display names')
assertHas(files.pluginsSurfaceContent, /searchableFieldsMatch\(pluginSearchFields\(plugin\),\s*query,\s*locale\)/, 'PluginsManagerSurfaceContent search should use the shared matcher for localized plugin display names')
assertHas(files.pluginsSurfaceContent, /titleI18n:\s*plugin\.displayNameI18n/, 'PluginsManagerSurfaceContent search fields should preserve localized plugin display names')

console.log('plugin package lifecycle checks passed')
