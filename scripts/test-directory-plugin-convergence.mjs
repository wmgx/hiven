#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function readIfExists(path) {
  const fullPath = join(root, path)
  return existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : ''
}

const files = {
  packageJson: read('package.json'),
  scriptsView: read('src/views/ScriptsView.tsx'),
  settingsView: read('src/views/SettingsView.tsx'),
  pluginRuntime: read('src/workspace/pluginRuntime.ts'),
  pluginStore: read('src/workspace/pluginStore.ts'),
  pluginTypes: read('src/workspace/pluginTypes.ts'),
  configInit: read('src/configInit.ts'),
  store: read('src/store.ts'),
  app: read('src/App.tsx'),
  tauriLib: read('src-tauri/src/lib.rs'),
  pluginEditorView: readIfExists('src/views/PluginEditorView.tsx'),
  pluginDebugRunner: readIfExists('src/workspace/pluginDebugRunner.ts'),
  pluginHostSdk: readIfExists('src/pluginHostSdk.ts'),
  pluginScaffold: readIfExists('src/workspace/pluginScaffold.ts'),
  bundledPluginLoader: readIfExists('src/workspace/bundledPluginLoader.ts'),
  builtinPluginIndex: readIfExists('src/builtin-plugins/index.json'),
  timestampManifest: readIfExists('src/plugins/timestamp/manifest.json'),
  dateTimeAssistantPlugin: readIfExists('src/plugins/date-time-assistant/index.ts'),
  dateTimeAssistantManifest: readIfExists('src/plugins/date-time-assistant/manifest.json'),
  directoryConventionDoc: readIfExists('doc/plugin-directory-convention.md'),
  directoryConvergencePlan: readIfExists('doc/plans/2026-06-03-directory-plugin-convergence.md'),
}

const failures = []

function check(name, fn) {
  try {
    fn()
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
  }
}

function assertExports(source, names, label) {
  for (const name of names) {
    assert.match(
      source,
      new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b|export\\s+const\\s+${name}\\b`),
      `${label} should export ${name}`,
    )
  }
}

function assertTauriCommand(source, name) {
  assert.match(source, new RegExp(`fn\\s+${name}\\b`), `src-tauri/src/lib.rs should define ${name}`)
  assert.match(
    source,
    new RegExp(`generate_handler!\\[[\\s\\S]*\\b${name}\\b`),
    `src-tauri/src/lib.rs should register ${name} in generate_handler`,
  )
}

check('In-app debugger view and editing are removed in favor of external IDE', () => {
  assert.ok(!readIfExists('src/views/DebuggerView.tsx'), 'DebuggerView should be deleted')
  assert.doesNotMatch(files.app, /DebuggerView/, 'App should not route to a debugger view')
  assert.doesNotMatch(files.app, /case\s+['"]debugger['"]/, 'App should not keep a debugger route branch')
})

check('ScriptsView removes single-file import and raw script persistence', () => {
  assert.doesNotMatch(
    files.scriptsView,
    /filters:\s*\[\s*\{[^}\]]*extensions:\s*\[\s*['"]js['"]\s*,\s*['"]ts['"]\s*\]/,
    'ScriptsView should not expose js/ts file filters for local import',
  )
  assert.doesNotMatch(files.scriptsView, /\breadTextFile\b/, 'ScriptsView should not read bare script files')
  assert.doesNotMatch(files.scriptsView, /invoke\(\s*['"]save_script['"]/, 'ScriptsView should not save bare scripts')
  assert.doesNotMatch(files.scriptsView, /invoke\(\s*['"]read_scripts_dir['"]/, 'ScriptsView should not list legacy scripts as active plugins')
  assert.doesNotMatch(files.scriptsView, /\baddDebuggerTab\b/, 'ScriptsView should not open single-file script editor tabs')
  assert.doesNotMatch(files.scriptsView, /My Script|my-script\.ts/, 'ScriptsView should not keep old New single-file UI')
})

check('ScriptsView scans plugins/installed directories instead of only reading persisted store', () => {
  assert.match(files.scriptsView, /import\s*\{[\s\S]*\blistPluginDirs\b[\s\S]*\}\s*from\s*['"]\.\.\/workspace\/pluginRuntime['"]/, 'ScriptsView should import listPluginDirs')
  assert.match(files.scriptsView, /\binstalledPackages\b/, 'ScriptsView should keep installed directory scan results')
  assert.match(
    files.scriptsView,
    /listPluginDirs\([^)]*plugins\/installed[^)]*\)|listPluginDirs\([^)]*['"]installed['"][^)]*\)/,
    'ScriptsView should scan the plugins/installed root',
  )
  assert.match(
    files.scriptsView,
    /setInstalledPackages\(\s*installedSummaries\s*\)|setInstalledPackages\(/,
    'ScriptsView should store installed package summaries from directory scan',
  )
  assert.match(
    files.scriptsView,
    /store\.installPlugin\(|usePluginStore\.getState\(\)\.installPlugin\(/,
    'ScriptsView should reconcile discovered installed directories into pluginStore for enable/reload flows',
  )
  assert.match(
    files.scriptsView,
    /pkg\.error[\s\S]*status:\s*['"]error['"][\s\S]*error:\s*pkg\.error/,
    'ScriptsView should surface malformed installed plugin directories as visible error cards',
  )
  assert.match(
    files.scriptsView,
    /if\s*\(\s*pkg\.error\s*\)\s*continue/,
    'ScriptsView should not reconcile malformed package summaries into the persistent plugin store',
  )
})

check('Plugin package roots are builtin, installed, and dev directories', () => {
  for (const rootName of ['builtin', 'installed', 'dev']) {
    assert.match(
      files.configInit + files.scriptsView + files.pluginRuntime + files.tauriLib,
      new RegExp(`plugins/${rootName}|plugins['"],\\s*['"]${rootName}`),
      `plugin system should reference plugins/${rootName}`,
    )
  }
})

check('Plugin records carry package source and update metadata but no migration metadata', () => {
  assert.match(files.pluginTypes, /source:\s*['"]?(?:local|github|zip|builtin)/, 'InstalledPlugin should include source')
  assert.match(files.pluginTypes, /sourceUrl\??:/, 'InstalledPlugin should include sourceUrl')
  assert.match(files.pluginTypes, /packagePath\??:|folderPath:/, 'InstalledPlugin should include package/folder path')
  assert.match(files.pluginTypes, /update\??:/, 'InstalledPlugin should include update metadata')

  for (const [label, source] of [
    ['pluginTypes', files.pluginTypes],
    ['pluginStore', files.pluginStore],
    ['configInit', files.configInit],
  ]) {
    assert.doesNotMatch(source, /\.migrated-scripts-v1/, `${label} should not keep a migration marker`)
    assert.doesNotMatch(source, /\bmigratedFrom\b/, `${label} should not expose migratedFrom metadata`)
    assert.doesNotMatch(source, /\bmarkScriptsMigrated\b|\bsetScriptsMigrated\b|\brecordScriptsMigration\b/, `${label} should not persist migration state`)
  }
  assert.doesNotMatch(files.pluginTypes, /\bmigration\??:/, 'InstalledPlugin should not have a migration field')
  assert.doesNotMatch(files.pluginStore, /\bmigration\b/, 'pluginStore should not persist migration state')
})

check('Directory plugin plan matches compatibility-release wording', () => {
  assert.ok(files.directoryConvergencePlan, 'directory plugin convergence plan should exist')
  assert.doesNotMatch(files.directoryConvergencePlan, /\.migrated-scripts-v1|migratedFrom|write\s+the\s+marker|persist\s+[^.]*migration/i, 'directory convergence plan should not require migration markers or migration metadata')
  assert.match(files.directoryConvergencePlan, /compatibility release source|compatibility input/i, 'directory convergence plan should describe old scripts as compatibility release input')
})

check('Generated directory packages do not advertise legacy migration capabilities', () => {
  for (const capability of ['legacy-script', 'builtin-script']) {
    const escaped = capability.replace('-', '\\-')
    assert.doesNotMatch(files.configInit, new RegExp(`['"]${escaped}['"]`), `configInit should not write ${capability} capability`)
    assert.doesNotMatch(files.pluginTypes, new RegExp(`['"]${escaped}['"]`), `pluginTypes should not model ${capability} as a first-class capability`)
  }
})

check('Legacy defineAction script release is fully removed', () => {
  assert.doesNotMatch(
    files.configInit,
    /releaseUserScriptPluginPackages|releaseBuiltinScriptPluginPackages/,
    'configInit should no longer release defineAction scripts as plugin packages',
  )
  assert.doesNotMatch(files.configInit, /createScriptPluginEntrySource|parseScriptToAction/, 'configInit should not depend on the legacy defineAction parser/wrapper')
  assert.doesNotMatch(files.configInit, /read_scripts_dir/, 'configInit should not scan the legacy scripts directory anymore')
  assert.ok(!readIfExists('src/workspace/legacyScriptPlugin.ts'), 'legacyScriptPlugin.ts should be deleted')
  assert.doesNotMatch(files.store, /parseScriptToAction|defineAction/, 'store should no longer parse defineAction scripts')
})

check('Runtime resolves fixed index.* entry and rejects manifest entry', () => {
  assert.match(
    files.pluginRuntime,
    /PLUGIN_ENTRY_CANDIDATES[\s\S]*index\.tsx[\s\S]*index\.ts[\s\S]*index\.js/,
    'runtime should define fixed index.* entry candidates',
  )
  assert.match(
    files.pluginRuntime,
    /resolveFixedPluginEntry[\s\S]*readFileText/,
    'runtime should resolve the first existing fixed entry file',
  )
  assert.match(
    files.pluginRuntime,
    /entry:\s*entry|\bentry,/,
    'runtime should return the resolved fixed entry value',
  )
  assert.doesNotMatch(
    files.pluginRuntime,
    /manifest\.entry\s*\?\?|manifest\.entry\s*\|\||missing entry/,
    'runtime should not read manifest.entry',
  )
})

check('pluginRuntime exposes directory, zip, GitHub directory, and single-file rejection APIs', () => {
  assertExports(files.pluginRuntime, ['installLocalPlugin'], 'pluginRuntime')
  assert.match(files.pluginRuntime, /installPluginZip|installZipPlugin|importPluginZip/, 'pluginRuntime should expose a zip import/install entry')
  assert.match(files.pluginRuntime, /installPluginZipUrl|importPluginZipUrl/, 'pluginRuntime should expose a remote zip URL import/install entry')
  assert.match(files.pluginRuntime, /fetchGithubDirectory|importGithubDirectory|installGithubDirectory/, 'pluginRuntime should expose a GitHub directory import entry')
  assert.match(files.pluginRuntime, /checkInstalledPluginUpdate|updateInstalledPlugin/, 'pluginRuntime should expose per-plugin update check and update APIs')
  assert.match(files.pluginRuntime, /comparePluginVersions[\s\S]*latestVersion/, 'pluginRuntime should compare installed and remote plugin versions')
  assert.match(
    files.pluginRuntime,
    /rejectSingleFileRemoteImport|single-file plugin import is no longer supported|no longer supported[\s\S]*\.(?:js|ts)|\.(?:js|ts)[\s\S]*no longer supported/i,
    'pluginRuntime should reject remote single-file .js/.ts imports explicitly',
  )
  assert.match(files.scriptsView, /importPluginZipUrl/, 'ScriptsView should import remote zip URLs directly')
  assert.match(files.scriptsView, /checkInstalledPluginUpdate[\s\S]*updateInstalledPlugin|updateInstalledPlugin[\s\S]*checkInstalledPluginUpdate/, 'ScriptsView should expose installed GitHub plugin update check and one-click update actions')
})

check('pluginRuntime exposes injected SDK helpers for plugin authors', () => {
  assert.match(
    files.pluginRuntime + files.pluginHostSdk,
    /createPluginHostSdk[\s\S]*definePlugin[\s\S]*effects[\s\S]*ui/,
    'pluginRuntime should inject definePlugin/effects/ui helpers',
  )
  assert.match(files.pluginRuntime, /window\.HivenPlugin\s*=\s*sdk/, 'pluginRuntime should install the hiven SDK global')
  assert.match(
    files.pluginRuntime + files.pluginScaffold,
    /createDevPluginScaffold[\s\S]*index\.js[\s\S]*createPluginScaffoldFiles|createPluginScaffoldFiles[\s\S]*indexSource[\s\S]*globalThis\.HivenPlugin[\s\S]*ui/,
    'new plugin scaffolds should use injected SDK with UI helpers and fixed index.js',
  )
})

check('Builtin packages are released purely from auto-discovered first-party plugin directories', () => {
  assert.match(files.configInit, /releaseBuiltinPluginManifests/, 'configInit should release builtin plugin package directories')
  assert.match(files.configInit, /pluginBuiltinDir[\s\S]*manifest\.json|BUILTIN_PLUGIN_PACKAGES/, 'builtin packages should be written under plugins/builtin from discovered packages')
  assert.doesNotMatch(files.configInit, /DEMO_PLUGIN_SOURCE|DEMO_PLUGIN_README|demo-text-plugin/, 'configInit should not release a defineAction-based demo plugin')
})

check('Text Diff builtin directory includes the adaptive diff UI source files', () => {
  // First-party packages are auto-discovered (no hardcoded file lists), and the
  // package directory must be self-contained with the renderer + auto diff mode.
  assert.match(
    files.configInit,
    /import\.meta\.glob\(['"]\.\/plugins\/\*\/manifest\.json['"]/,
    'configInit should auto-discover first-party plugin manifests via import.meta.glob',
  )
  assert.match(
    files.configInit,
    /import\.meta\.glob\(['"]\.\/plugins\/\*\/\*\*\/\*\.\{[^}]+\}['"]/,
    'configInit should auto-discover all package source files via import.meta.glob, not a hardcoded list',
  )
  assert.doesNotMatch(
    files.configInit,
    /BUILTIN_PLUGIN_SOURCE_FILES/,
    'configInit should not keep a hardcoded BUILTIN_PLUGIN_SOURCE_FILES map',
  )
  const renderer = read('src/plugins/textDiff/TextDiffRenderer.tsx')
  assert.match(renderer, /JSON semantic status|json-semantic|semanticAvailable/, 'text-diff renderer should own the adaptive JSON/text UI controls')
  assert.ok(readIfExists('src/plugins/textDiff/autoDiffMode.ts'), 'text-diff package should ship autoDiffMode.ts')
  assert.ok(readIfExists('src/plugins/textDiff/manifest.json'), 'text-diff package should ship manifest.json')
  assert.doesNotMatch(
    files.configInit,
    /pluginId:\s*['"]json-diff['"]|['"]json-diff['"]:\s*\{/,
    'json-diff should not be released as a separate first-party plugin package',
  )
})

check('Built-in release packages should not include internal core', () => {
  assert.doesNotMatch(
    files.configInit,
    /const\s+BUILTIN_PLUGIN_PACKAGES[\s\S]*\{[\s\S]*pluginId:\s*['"]core['"][\s\S]*\}/,
    'BUILTIN_PLUGIN_PACKAGES should not include core pseudo-plugin metadata',
  )
})

check('Time utilities ship as one first-party plugin package', () => {
  assert.ok(files.dateTimeAssistantManifest, 'date-time-assistant plugin manifest should exist')
  assert.ok(files.dateTimeAssistantPlugin, 'date-time-assistant plugin entry should exist')
  assert.ok(!files.timestampManifest, 'timestamp should be merged into date-time-assistant instead of shipping as a separate plugin package')

  const manifest = JSON.parse(files.dateTimeAssistantManifest)
  assert.deepEqual(manifest.capabilities?.sort(), ['command', 'instant-suggestion'], 'date-time-assistant should advertise both command and instant-suggestion capabilities')
  assert.match(files.dateTimeAssistantPlugin, /\bcommands\s*:/, 'date-time-assistant should include the timestamp conversion command')
  assert.match(files.dateTimeAssistantPlugin, /\blauncher\s*:\s*\{[\s\S]*\bdynamicItems\s*\(/, 'date-time-assistant should keep date/time instant suggestions through launcher dynamic items')
  assert.match(files.dateTimeAssistantPlugin, /tomorrow\s+/, 'date-time-assistant instant suggestions should preserve natural date query support')
})

check('First-party diff registration goes through bundled plugin package loader', () => {
  assert.ok(files.bundledPluginLoader, 'src/workspace/bundledPluginLoader.ts should exist')
  assert.match(files.bundledPluginLoader, /import\.meta\.glob\(['"]\.\.\/plugins\/\*\/manifest\.json['"]/, 'bundled loader should discover plugin package manifests')
  assert.match(files.bundledPluginLoader, /import\.meta\.glob\(['"]\.\.\/plugins\/\*\/index\.\{ts,tsx\}['"]/, 'bundled loader should load fixed plugin package entries')
  assert.match(files.bundledPluginLoader, /registerProductionPlugin/, 'bundled loader should register plugin definitions through the registry')
  assert.match(files.app, /registerBundledPluginPackages\(\)/, 'App should register first-party product plugin packages through the bundled loader')
  assert.doesNotMatch(files.app, /import\s+['"]\.\/plugins\/(?:textDiff|jsonDiff)['"]/, 'App should not side-effect import individual first-party diff plugins')
  assert.doesNotMatch(files.configInit, /pluginId:\s*['"]json-diff['"]|['"]json-diff['"]:\s*\{/, 'json-diff should not be released as a separate builtin package')
})

check('Plugin main view includes builtin, installed, and dev package tabs', () => {
  assert.match(files.scriptsView, /type\s+TabId\s*=\s*['"]builtin['"]\s*\|\s*['"]installed['"]\s*\|\s*['"]dev['"]/, 'ScriptsView should model builtin/installed/dev tabs')
  assert.match(files.scriptsView, /t\(locale,\s*['"]scripts\.tabBuiltin['"]/, 'ScriptsView should localize builtin tab')
  assert.match(files.scriptsView, /t\(locale,\s*['"]scripts\.tabInstalled['"]/, 'ScriptsView should localize installed tab')
  assert.match(files.scriptsView, /t\(locale,\s*['"]scripts\.tabDev['"]/, 'ScriptsView should localize dev tab')
})

check('Plugin cards expose read-only source viewer and external-editor entry', () => {
  assert.match(
    files.scriptsView,
    /renderInstalled[\s\S]*openPluginEditor\(\{\s*pluginId:\s*plugin\.pluginId[\s\S]*source:\s*['"]installed['"]/,
    'installed plugin cards should open the read-only source viewer',
  )
  assert.match(
    files.scriptsView,
    /renderBuiltin[\s\S]*openPluginEditor\(\{\s*pluginId:\s*plugin\.pluginId[\s\S]*source:\s*['"]builtin['"][\s\S]*readOnly:\s*true/,
    'builtin plugin cards should open the read-only source viewer',
  )
  assert.match(
    files.scriptsView,
    /renderDev[\s\S]*openPluginDir\(/,
    'dev plugin cards should offer opening the package directory in an external editor',
  )
})

check('PluginEditorView is a read-only source viewer with directory tree and no debug/edit', () => {
  assert.ok(files.pluginEditorView, 'src/views/PluginEditorView.tsx should exist')
  assert.match(files.pluginEditorView + files.pluginRuntime, /list_plugin_files|PluginFileTree|activeFile/i, 'plugin viewer should include directory tree/file switching')
  assert.match(files.pluginEditorView + files.pluginRuntime, /read_plugin_file/, 'plugin viewer should read selected plugin files')
  assert.match(files.pluginEditorView, /readOnly:\s*true/, 'PluginEditorView should render the editor read-only')
  assert.doesNotMatch(files.pluginEditorView, /saveActiveFile|save_plugin_file/, 'PluginEditorView should not save files anymore')
  assert.doesNotMatch(files.pluginEditorView, /runDebug|runPluginDebugSource|debugOutput|debugLogs/, 'PluginEditorView should not include a debug panel anymore')
})

check('App protects menu navigation from plugin view render crashes', () => {
  assert.match(files.app, /class\s+ViewErrorBoundary/, 'App should define a view error boundary')
  assert.match(files.app, /ViewErrorBoundary[\s\S]*ViewContent/, 'App should wrap view content with the error boundary')
})

check('Tauri exposes plugin directory filesystem commands', () => {
  assert.match(
    files.packageJson,
    /test:tauri-plugin-dir-commands/,
    'package.json should expose a Tauri plugin directory command test',
  )
  assert.match(
    files.tauriLib,
    /mod\s+plugin_dir_command_tests/,
    'Tauri plugin directory commands should have Rust unit coverage',
  )
  for (const name of [
    'list_plugin_dirs',
    'list_plugin_files',
    'read_plugin_file',
    'save_plugin_file',
    'remove_plugin_dir',
    'install_plugin_zip',
    'install_plugin_zip_url',
    'fetch_github_directory',
  ]) {
    assertTauriCommand(files.tauriLib, name)
  }
})

check('Tauri plugin file commands stay within plugin roots', () => {
  assert.match(files.tauriLib, /ensure_existing_plugin_path|ensure_plugin_path_for_write/, 'plugin file commands should enforce the config plugins root')
  assert.match(
    files.tauriLib,
    /validate_plugin_id[\s\S]*contains\('\/'\)|contains\('\\\\'\)|Plugin manifest pluginId must be a plain package id/,
    'manifest pluginId should reject path separators',
  )
  assert.match(files.tauriLib, /symlink_metadata[\s\S]*is_symlink\(\)[\s\S]*continue/, 'plugin file listing/copying should skip symlinks')
  assert.match(files.tauriLib, /find_fixed_plugin_entry[\s\S]*index\.tsx[\s\S]*index\.js/, 'Tauri manifest parsing should resolve fixed index.* entries')
  assert.match(
    files.tauriLib,
    /for entry in fs::read_dir\(&root\)[\s\S]*match\s+read_plugin_manifest_summary\(&folder\)/,
    'list_plugin_dirs should handle malformed package manifests without aborting the whole list',
  )
  assert.match(
    files.tauriLib,
    /plugins\.push\(\s*PluginDirSummary\s*\{\s*plugin_id:\s*plugin_id\.clone\(\),[\s\S]*error:\s*Some\(error\),/,
    'list_plugin_dirs should return malformed plugin packages as visible error summaries',
  )
  assert.doesNotMatch(
    files.tauriLib,
    /plugins\.push\(read_plugin_manifest_summary\(&folder\)\?\)/,
    'list_plugin_dirs should never abort on a malformed manifest',
  )
  assert.match(
    files.tauriLib,
    /validate_plugin_relative_path\(&path,\s*["']GitHub directory path["']\)[\s\S]*canonical_candidate[\s\S]*starts_with/,
    'GitHub directory import should reject parent paths and confirm the selected path stays inside the archive',
  )
  assert.match(files.tauriLib, /Plugin file writes may not target symlinks|is_symlink\(\)[\s\S]*return Err/, 'save_plugin_file should reject writing through existing symlinks')
  assert.match(files.tauriLib, /fn\s+remove_plugin_dir[\s\S]*validate_plugin_id[\s\S]*remove_dir_all/, 'remove_plugin_dir should only remove a validated plugin package directory')
})

check('Builtin plugin update check compares remote package metadata', () => {
  assert.doesNotMatch(files.configInit, /checkBuiltinScriptsUpdate/, 'configInit should replace script update checks with plugin package update checks')
  assert.match(files.configInit, /checkBuiltinPluginsUpdate/, 'configInit should expose builtin plugin package update checks')
  assert.match(files.configInit, /fetchWithFallback|remote|index|manifest|version|update metadata|updateMetadata/i, 'update check should fetch/read plugin package index or manifest version metadata')
  assert.match(files.configInit, /version[\s\S]*(?:>|!==|compare|semver|newer)|(?:>|!==|compare|semver|newer)[\s\S]*version/i, 'update check should compare installed and remote/index versions')
  assert.match(files.configInit, /downloadRemoteBuiltinPackage|stageRemoteBuiltinPackage|REMOTE_BUILTIN_PLUGIN_SOURCE_BASE_URLS/, 'builtin plugin updates should download remote package files, not only the index')
  assert.match(files.configInit, /replace_plugin_dir/, 'builtin plugin updates should replace whole plugin package directories')
  assert.match(files.configInit, /validateStagedBuiltinPackage[\s\S]*manifest\.json[\s\S]*pluginId/, 'builtin plugin updates should validate staged package manifests before replacing directories')
  assert.doesNotMatch(files.configInit, /if\s*\(\s*remoteVersion\s*>\s*localVersion\s*\)\s*\{\s*await\s+ensureTextFile\(\s*localIndexPath,\s*JSON\.stringify\(remoteIndex/s, 'builtin plugin updates must not only write the remote index when a newer version exists')
  assert.match(files.tauriLib, /fn\s+replace_plugin_dir[\s\S]*backup[\s\S]*fs::rename/, 'Tauri should provide a replace_plugin_dir command with backup/rename replacement')
  assert.match(files.tauriLib, /generate_handler!\[[\s\S]*replace_plugin_dir/, 'replace_plugin_dir should be registered as a Tauri command')
  assert.ok(files.builtinPluginIndex, 'remote builtin plugin index should exist at src/builtin-plugins/index.json')
  assert.match(files.builtinPluginIndex, /"version"\s*:\s*23/, 'remote builtin plugin index should carry the current package index version')
  assert.doesNotMatch(files.builtinPluginIndex, /"files"\s*:/, 'remote builtin plugin index should not expose file lists as part of the plugin package contract')
  assert.doesNotMatch(files.configInit, /declare downloadable files/, 'builtin plugin updates should not reject package indexes that omit explicit file lists')
  assert.match(files.configInit, /fetchRemoteBuiltinPackageIndex|GitHub tree|recursive|tree API/i, 'builtin plugin updates should discover package files from the directory instead of requiring explicit file lists')
  assert.match(files.configInit, /data\.jsdelivr\.com[\s\S]*flat|flat[\s\S]*data\.jsdelivr\.com/i, 'builtin plugin update file discovery should include a non-GitHub-API flat file-list fallback')
})

check('Directory plugin convention document captures the new contract', () => {
  assert.ok(files.directoryConventionDoc, 'doc/plugin-directory-convention.md should exist')
  for (const phrase of [
    'plugins/builtin',
    'plugins/installed',
    'plugins/dev',
    'manifest.json',
    'index.js',
    'pluginId',
    'displayNameI18n',
    'params',
    'globalThis.HivenPlugin',
    'GitHub',
    'zip',
    'local',
    '不做迁移 UI',
    '更新检测',
  ]) {
    assert.match(files.directoryConventionDoc, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `document should mention ${phrase}`)
  }
})

if (failures.length > 0) {
  console.error(`directory plugin convergence checks failed (${failures.length}):`)
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('directory plugin convergence checks passed')
