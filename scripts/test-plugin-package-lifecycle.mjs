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
  scriptsView: read('src/views/ScriptsView.tsx'),
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
assertHas(files.scriptsView, /await\s+uninstallPlugin\(plugin\.pluginId\)/, 'ScriptsView uninstall button should await physical uninstall')
assertHas(files.scriptsView, /setUpdateStatus\(['"`]checking['"`]\)|setUpdateStatus\(['"`]done['"`]\)/, 'ScriptsView should refresh directory summaries after uninstall')

assertHas(files.configInit, /read_plugin_file[\s\S]*manifest\.json[\s\S]*catch/, 'user script release should read an existing package manifest before writing')
assertHas(files.configInit, /continue[\s\S]*createScriptPluginEntrySource|createScriptPluginEntrySource[\s\S]*continue/, 'user script release should skip existing packages instead of overwriting user edits')
assertHas(files.configInit, /displayNameI18n:\s*action\?\.titleI18n/, 'builtin script package manifests should inherit titleI18n as displayNameI18n')
assertHas(files.configInit, /displayNameI18n:\s*action\.titleI18n/, 'user script package manifests should inherit titleI18n as displayNameI18n')
assertHas(files.configInit, /displayNameI18n:\s*\{\s*zh:\s*['"`]示例：大写并添加前缀['"`]\s*\}/, 'demo plugin manifest should expose a localized display name')

assertHas(files.pluginTypes, /export\s+type\s+PluginDefinition[\s\S]*titleI18n\??\s*:/, 'PluginDefinition should support root titleI18n')
assertHas(files.tauriLib, /display_name_i18n|displayNameI18n/, 'Tauri PluginDirSummary should include displayNameI18n')
assertHas(files.tauriLib, /get\("displayNameI18n"\)/, 'Tauri manifest summary should read displayNameI18n from manifest.json')
assertHas(files.scriptsView, /displayNameI18n:\s*pkg\.displayNameI18n/, 'ScriptsView should preserve displayNameI18n when syncing scanned packages into store')
assertHas(files.scriptsView, /updatePluginMetadata\(pkg\.pluginId[\s\S]*displayNameI18n:\s*pkg\.displayNameI18n/, 'ScriptsView should refresh displayNameI18n for already persisted packages')
assertHas(files.scriptsView, /function\s+pluginDisplayName[\s\S]*localized\([\s\S]*displayNameI18n[\s\S]*locale[\s\S]*\)/, 'ScriptsView should localize plugin package display names from displayNameI18n')
assertHas(files.scriptsView, /title=\{pluginDisplayName\(plugin,\s*locale\)\}/, 'ScriptsView cards should render localized plugin display names')
assertHas(files.scriptsView, /textMatches\(pluginDisplayName\(plugin,\s*locale\),\s*normalizedQuery\)/, 'ScriptsView search should match localized plugin display names')

console.log('plugin package lifecycle checks passed')
