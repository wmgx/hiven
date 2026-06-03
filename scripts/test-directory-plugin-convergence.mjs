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
  scriptsView: read('src/views/ScriptsView.tsx'),
  settingsView: read('src/views/SettingsView.tsx'),
  pluginRuntime: read('src/workspace/pluginRuntime.ts'),
  pluginStore: read('src/workspace/pluginStore.ts'),
  pluginTypes: read('src/workspace/pluginTypes.ts'),
  configInit: read('src/configInit.ts'),
  app: read('src/App.tsx'),
  tauriLib: read('src-tauri/src/lib.rs'),
  debuggerView: read('src/views/DebuggerView.tsx'),
  legacyScriptPlugin: readIfExists('src/workspace/legacyScriptPlugin.ts'),
  pluginEditorView: readIfExists('src/views/PluginEditorView.tsx'),
  pluginDebugRunner: readIfExists('src/workspace/pluginDebugRunner.ts'),
  bundledPluginLoader: readIfExists('src/workspace/bundledPluginLoader.ts'),
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

check('DebuggerView imports every React hook it uses', () => {
  assert.match(files.debuggerView, /\buseState\s*\(/, 'DebuggerView should still be checked when it uses useState')
  assert.match(
    files.debuggerView,
    /import\s*\{[^}]*\buseState\b[^}]*\}\s*from\s*['"]react['"]/,
    'DebuggerView should import useState from react so Plugins navigation cannot white-screen on that view error',
  )
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

check('User scripts are released as ordinary installed plugin directories', () => {
  assert.match(
    files.configInit,
    /export\s+async\s+function\s+releaseUserScriptPluginPackages\b/,
    'configInit should expose releaseUserScriptPluginPackages rather than a migration API',
  )
  assert.doesNotMatch(
    files.configInit,
    /migrateLegacyScriptsToPlugins|migrateLegacyScripts|legacyScriptsToPlugins/,
    'user script release should not be named as a migration flow',
  )
  assert.match(files.configInit, /const\s+installedDir\s*=\s*`\$\{configDir\}\/plugins\/installed`/, 'user script packages should be written under plugins/installed')
  assert.match(files.configInit, /read_scripts_dir/, 'user script release may scan the old scripts directory as an input source')
  assert.match(files.configInit, /manifest\.json/, 'user script release should write manifest.json')
  assert.match(files.configInit, /index\.js/, 'user script release should write fixed index.js')
  assert.match(files.configInit, /capabilities:\s*\[\s*['"]command['"]\s*\]/, 'released user scripts should be normal command plugins')
  assert.doesNotMatch(files.configInit, /usePluginStore\.getState\(\)\.(?:markScriptsMigrated|setScriptsMigrated|recordScriptsMigration|installPlugin)/, 'configInit should not special-register released script packages in store')
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
  assert.match(files.pluginRuntime, /fetchGithubDirectory|importGithubDirectory|installGithubDirectory/, 'pluginRuntime should expose a GitHub directory import entry')
  assert.match(
    files.pluginRuntime,
    /rejectSingleFileRemoteImport|single-file plugin import is no longer supported|no longer supported[\s\S]*\.(?:js|ts)|\.(?:js|ts)[\s\S]*no longer supported/i,
    'pluginRuntime should reject remote single-file .js/.ts imports explicitly',
  )
})

check('pluginRuntime exposes injected SDK helpers for plugin authors', () => {
  assert.match(
    files.pluginRuntime,
    /window\.FluxTextPlugin[\s\S]*definePlugin[\s\S]*effects/,
    'pluginRuntime should inject definePlugin/effects helpers',
  )
  assert.match(
    files.pluginRuntime,
    /createDevPluginScaffold[\s\S]*index\.js[\s\S]*globalThis\.FluxTextPlugin/,
    'new plugin scaffolds should use injected SDK and fixed index.js',
  )
})

check('Builtin scripts and demo are released as ordinary builtin plugin directories', () => {
  assert.match(files.configInit, /releaseBuiltinScriptPluginPackages/, 'configInit should release builtin scripts as package directories')
  assert.match(files.configInit, /scripts\/builtin|scriptsBuiltinDir/, 'builtin package release should scan scripts/builtin as an input source')
  assert.match(files.configInit, /pluginBuiltinDir[\s\S]*manifest\.json[\s\S]*index\.js/, 'builtin packages should get manifest.json and fixed index.js under plugins/builtin')
  assert.match(files.configInit, /createScriptPluginEntrySource/, 'script-origin packages should be released through the standard command plugin wrapper')
  assert.doesNotMatch(files.legacyScriptPlugin, /const legacySource|source:\s*legacySource/, 'generated plugin entries should not expose legacySource variables')
  assert.match(files.configInit, /demo-text-plugin[\s\S]*DEMO_PLUGIN_SOURCE[\s\S]*DEMO_PLUGIN_README/, 'configInit should release a visible demo plugin package')
})

check('Text Diff builtin directory includes the adaptive diff UI source files', () => {
  assert.match(
    files.configInit,
    /textDiffRendererSource[\s\S]*\.\/plugins\/textDiff\/TextDiffRenderer\.tsx\?raw/,
    'configInit should bundle TextDiffRenderer.tsx as raw source',
  )
  assert.match(
    files.configInit,
    /BUILTIN_PLUGIN_SOURCE_FILES[\s\S]*['"]text-diff['"][\s\S]*TextDiffRenderer\.tsx[\s\S]*autoDiffMode\.ts|BUILTIN_PLUGIN_SOURCE_FILES[\s\S]*['"]text-diff['"][\s\S]*autoDiffMode\.ts[\s\S]*TextDiffRenderer\.tsx/,
    'text-diff builtin package should release the renderer and auto diff mode files, not manifest.json only',
  )
  assert.match(
    files.configInit,
    /TextDiffRenderer\.tsx[\s\S]*JSON semantic status|JSON semantic status[\s\S]*TextDiffRenderer\.tsx/,
    'text-diff package README/source metadata should make the adaptive JSON/text UI controls visible in the directory editor',
  )
  assert.doesNotMatch(
    files.configInit,
    /pluginId:\s*['"]json-diff['"]|['"]json-diff['"]:\s*\{/,
    'json-diff should not be released as a separate first-party plugin package',
  )
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

check('Plugin cards expose directory editor entry for builtin, installed, and dev packages', () => {
  assert.match(
    files.scriptsView,
    /renderInstalled[\s\S]*openPluginEditor\(\{\s*pluginId:\s*plugin\.pluginId[\s\S]*source:\s*['"]installed['"]/,
    'installed plugin cards should open the directory editor',
  )
  assert.match(
    files.scriptsView,
    /renderBuiltin[\s\S]*openPluginEditor\(\{\s*pluginId:\s*plugin\.pluginId[\s\S]*source:\s*['"]builtin['"][\s\S]*readOnly:\s*true/,
    'builtin plugin cards should open the directory editor as a read-only reference',
  )
  assert.match(
    files.scriptsView,
    /renderDev[\s\S]*openPluginEditor\(\{\s*pluginId:\s*plugin\.pluginId[\s\S]*source:\s*['"]dev['"]/,
    'dev plugin cards should open the directory editor',
  )
  assert.match(
    files.pluginEditorView,
    /readOnly[\s\S]*saveActiveFile[\s\S]*if \(!activeFile \|\| readOnly\) return[\s\S]*options=\{\{[\s\S]*readOnly/,
    'PluginEditorView should enforce read-only reference mode for builtin plugins',
  )
})

check('PluginEditorView includes directory tree, file switching, and runnable debug panel', () => {
  assert.ok(files.pluginEditorView, 'src/views/PluginEditorView.tsx should exist')
  assert.ok(files.pluginDebugRunner, 'src/workspace/pluginDebugRunner.ts should exist')
  assert.match(files.pluginEditorView + files.pluginRuntime, /list_plugin_files|PluginFileTree|activeFile|selectedFile/i, 'plugin editor should include directory tree/file switching')
  assert.match(files.pluginEditorView + files.pluginRuntime, /read_plugin_file/, 'plugin editor should read selected plugin files')
  assert.match(files.pluginEditorView + files.pluginRuntime, /save_plugin_file/, 'plugin editor should save selected plugin files')
  assert.match(files.pluginEditorView + files.pluginDebugRunner, /parsePluginDefinitionSource/, 'PluginEditorView should run plugin command definitions for debugging')
  assert.match(files.pluginEditorView + files.pluginDebugRunner, /runPluginDebugSource/, 'PluginEditorView should use the tested plugin debug runner')
  assert.doesNotMatch(files.pluginEditorView, /legacySource|extractRunnableSource/, 'PluginEditorView should not extract legacySource from generated entries')
  assert.match(files.pluginEditorView, /runDebug/, 'PluginEditorView should expose a debug run path')
  assert.match(files.pluginEditorView, /debugInput[\s\S]*debugOutput[\s\S]*debugLogs/, 'PluginEditorView should include input, output, and console state')
})

check('App protects menu navigation from plugin view render crashes', () => {
  assert.match(files.app, /class\s+ViewErrorBoundary/, 'App should define a view error boundary')
  assert.match(files.app, /ViewErrorBoundary[\s\S]*ViewContent/, 'App should wrap view content with the error boundary')
})

check('Tauri exposes plugin directory filesystem commands', () => {
  for (const name of [
    'list_plugin_dirs',
    'list_plugin_files',
    'read_plugin_file',
    'save_plugin_file',
    'remove_plugin_dir',
    'install_plugin_zip',
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
    'globalThis.FluxTextPlugin',
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
