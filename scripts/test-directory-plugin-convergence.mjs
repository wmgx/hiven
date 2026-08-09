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
  pluginsSurfaceContent: readIfExists('src/surfaces/PluginsManagerSurfaceContent.tsx') + read('src/surfaces/PluginsContent.tsx'),
  settingsSurfaceContent: readIfExists('src/surfaces/SettingsSurfaceContent.tsx'),
  pluginRuntime: read('src/workspace/pluginRuntime.ts'),
  pluginStore: read('src/workspace/pluginStore.ts'),
  pluginTypes: read('src/workspace/pluginTypes.ts'),
  configInit: read('src/configInit.ts'),
  store: read('src/store.ts'),
  app: read('src/App.tsx'),
  pluginsSurface: readIfExists('src/surfaces/PluginsSurface.tsx'),
  pluginSurfaceRenderer: readIfExists('src/components/pluginSurface/PluginSurfaceRenderer.tsx'),
  tauriLib: read('src-tauri/src/lib.rs'),
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

check('PluginsManagerSurfaceContent removes single-file import and raw script persistence', () => {
  assert.doesNotMatch(
    files.pluginsSurfaceContent,
    /filters:\s*\[\s*\{[^}\]]*extensions:\s*\[\s*['"]js['"]\s*,\s*['"]ts['"]\s*\]/,
    'PluginsManagerSurfaceContent should not expose js/ts file filters for local import',
  )
  assert.doesNotMatch(files.pluginsSurfaceContent, /\breadTextFile\b/, 'PluginsManagerSurfaceContent should not read bare script files')
  assert.doesNotMatch(files.pluginsSurfaceContent, /invoke\(\s*['"]save_script['"]/, 'PluginsManagerSurfaceContent should not save bare scripts')
  assert.doesNotMatch(files.pluginsSurfaceContent, /invoke\(\s*['"]read_scripts_dir['"]/, 'PluginsManagerSurfaceContent should not list legacy scripts as active plugins')
  assert.doesNotMatch(files.pluginsSurfaceContent, /\baddDebuggerTab\b/, 'PluginsManagerSurfaceContent should not open single-file script editor tabs')
  assert.doesNotMatch(files.pluginsSurfaceContent, /My Script|my-script\.ts/, 'PluginsManagerSurfaceContent should not keep old New single-file UI')
})

check('PluginsManagerSurfaceContent scans plugins/installed directories instead of only reading persisted store', () => {
  assert.match(files.pluginsSurfaceContent, /import\s*\{[\s\S]*\blistPluginDirs\b[\s\S]*\}\s*from\s*['"]\.\.\/workspace\/pluginRuntime['"]/, 'PluginsManagerSurfaceContent should import listPluginDirs')
  assert.match(files.pluginsSurfaceContent, /\binstalledPackages\b/, 'PluginsManagerSurfaceContent should keep installed directory scan results')
  assert.match(
    files.pluginsSurfaceContent,
    /listPluginDirs\([^)]*plugins\/installed[^)]*\)|listPluginDirs\([^)]*['"]installed['"][^)]*\)/,
    'PluginsManagerSurfaceContent should scan the plugins/installed root',
  )
  assert.match(
    files.pluginsSurfaceContent,
    /setInstalledPackages\(\s*installedSummaries\s*\)|setInstalledPackages\(/,
    'PluginsManagerSurfaceContent should store installed package summaries from directory scan',
  )
  assert.match(
    files.pluginsSurfaceContent,
    /store\.installPlugin\(|usePluginStore\.getState\(\)\.installPlugin\(/,
    'PluginsManagerSurfaceContent should reconcile discovered installed directories into pluginStore for enable/reload flows',
  )
  assert.match(
    files.pluginsSurfaceContent,
    /pkg\.error[\s\S]*status:\s*['"]error['"][\s\S]*error:\s*pkg\.error/,
    'PluginsManagerSurfaceContent should surface malformed installed plugin directories as visible error cards',
  )
  assert.match(
    files.pluginsSurfaceContent,
    /if\s*\(\s*pkg\.error\s*\)\s*continue/,
    'PluginsManagerSurfaceContent should not reconcile malformed package summaries into the persistent plugin store',
  )
})

check('Plugin package roots are builtin, installed, and dev directories', () => {
  for (const rootName of ['builtin', 'installed', 'dev']) {
    assert.match(
      files.configInit + files.pluginsSurfaceContent + files.pluginRuntime + files.tauriLib,
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
  assert.match(files.pluginsSurfaceContent, /importPluginZipUrl/, 'PluginsManagerSurfaceContent should import remote zip URLs directly')
  assert.match(files.pluginsSurfaceContent, /checkInstalledPluginUpdate[\s\S]*updateInstalledPlugin|updateInstalledPlugin[\s\S]*checkInstalledPluginUpdate/, 'PluginsManagerSurfaceContent should expose installed GitHub plugin update check and one-click update actions')
})

check('Remote GitHub plugin updates use fresh metadata without the hiven-only proxy', () => {
  assert.match(
    files.pluginRuntime,
    /REMOTE_GITHUB_RAW_BASE_URLS[\s\S]*raw\.githubusercontent\.com[\s\S]*cdn\.jsdelivr\.net/,
    'GitHub plugin metadata should use public GitHub raw and CDN mirrors',
  )
  assert.doesNotMatch(
    files.pluginRuntime,
    /REMOTE_GITHUB_RAW_BASE_URLS[\s\S]*proxy\.github\.wmgx\.top/,
    'third-party GitHub plugin metadata must not use the hiven-only proxy host',
  )
  assert.doesNotMatch(
    files.tauriLib,
    /proxy\.github\.wmgx\.top\/github\/\{owner\}|GITHUB_ARCHIVE_URL_TEMPLATES/,
    'third-party GitHub plugin archive downloads must not use the hiven-only proxy host',
  )
  assert.match(
    files.pluginRuntime,
    /githubRawFileUrls[\s\S]*cacheBust[\s\S]*Date\.now\(\)|Date\.now\(\)[\s\S]*githubRawFileUrls/,
    'GitHub plugin update metadata requests should include a cache-busting query',
  )
  assert.match(
    files.pluginRuntime,
    /fetchGithubManifest\(record\.sourceUrl,[^)]*true\)/,
    'installed GitHub plugin update checks should bypass stale CDN metadata',
  )
  assert.match(
    files.pluginRuntime,
    /fetchGithubManifest\(record\.sourceUrl,[^)]*true\)[\s\S]*fetchGithubDirectory\(record\.sourceUrl,[^)]*stagingRoot/,
    'installed GitHub plugin updates should check fresh manifest metadata before downloading replacement files',
  )
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
  const renderer = read('src/plugins/textDiff/TextDiffSurface.tsx')
  assert.match(renderer, /jsonAvailable|jsonEnabled|renderMode === ['"]json['"]/, 'text-diff renderer should own the adaptive JSON/text UI controls')
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

assert.equal(existsSync('src/surfaces/PluginEditorSurface.tsx'), false)
