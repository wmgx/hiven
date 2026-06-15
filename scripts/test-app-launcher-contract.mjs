#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function read(path) {
  return readFileSync(path, 'utf8')
}

function readJson(path) {
  return JSON.parse(read(path))
}

function assertFile(path) {
  assert.equal(existsSync(path), true, `${path} should exist`)
}

function readFilesUnder(dir, pattern) {
  if (!existsSync(dir)) return ''
  const chunks = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      chunks.push(readFilesUnder(path, pattern))
    } else if (pattern.test(entry.name)) {
      chunks.push(read(path))
    }
  }
  return chunks.join('\n')
}

function assertPluginPackageShape() {
  for (const path of [
    'src/plugins/app-launcher/manifest.json',
    'src/plugins/app-launcher/index.ts',
    'src/plugins/app-launcher/locales/en.json',
    'src/plugins/app-launcher/locales/zh.json',
    'src/plugins/app-launcher/storage/model.ts',
    'src/plugins/app-launcher/storage/repository.ts',
  ]) {
    assertFile(path)
  }

  assert.equal(existsSync('src/plugins/app-launcher/settings'), false, 'app-launcher should not have settings')
  assert.equal(existsSync('src/plugins/app-launcher/surfaces'), false, 'app-launcher should not have custom surfaces')
  assert.equal(existsSync('src/plugins/app-launcher/background'), false, 'app-launcher should not have background')

  const manifest = readJson('src/plugins/app-launcher/manifest.json')
  assert.equal(manifest.pluginId, 'app-launcher')
  assert.deepEqual(manifest.capabilities, ['launcher', 'hooks'])
  assert.deepEqual(manifest.permissions, ['app.discover', 'app.launch', 'storage.private'])

  const bundledIndex = readJson('src/builtin-plugins/index.json')
  const bundledEntry = bundledIndex.packages.find((pkg) => pkg.pluginId === 'app-launcher' && pkg.dir === 'app-launcher')
  assert(
    bundledEntry,
    'builtin plugin index should register app-launcher',
  )
  assert.equal(bundledEntry.version, manifest.version, 'builtin plugin index should publish the current app-launcher package version')

  const configInit = read('src/configInit.ts')
  assert.doesNotMatch(configInit, /version:\s*7,/, 'embedded builtin plugin index should not hard-code an old release version')
  assert.match(configInit, /BUILTIN_PLUGIN_INDEX_MODULES|builtin-plugins\/index\.json/, 'embedded builtin plugin index should read the source package index version')
  assert.match(configInit, /packageVersionsChanged[\s\S]*needsRelease/, 'builtin plugin release should overwrite stale local package mirrors when package versions change')
}

function assertHostLauncherApiBoundary() {
  const types = read('src/workspace/launcher/types.ts')
  assert.match(types, /export type DiscoveredApp\s*=\s*\{[\s\S]*appId:\s*string[\s\S]*nameI18n\?:[\s\S]*displayPath\?:\s*string/, 'launcher types should expose installed app metadata and localized app names')
  assert.doesNotMatch(types, /export type DiscoveredApp\s*=\s*\{[\s\S]*icon\?:\s*\{[\s\S]*bytes/, 'discoverApps should not move app icon bytes through the plugin API')
  assert.doesNotMatch(types, /shellCommand|launchArgs|executablePath|targetPath|commandLine/, 'DiscoveredApp should not expose shell commands, launch args, or executable targets')
  assert.match(types, /export type PluginAppsApi\s*=\s*\{[\s\S]*discoverApps\(\):\s*Promise<DiscoveredApp\[\]>[\s\S]*cacheAppIcons\(appIds:\s*string\[\]\):\s*Promise<number>[\s\S]*launchApp\(appId:\s*string\):\s*Promise<void>/, 'PluginLauncherApi should include a gated apps API and host-owned icon cache warmup')
  assert.match(types, /apps:\s*PluginAppsApi/, 'PluginLauncherApi should expose apps namespace')

  const pluginApi = read('src/workspace/launcher/pluginApi.ts')
  assert.match(pluginApi, /createPluginAppsApi/, 'host should build apps API outside plugins')
  const discoverApps = sliceBetween(
    pluginApi,
    'discoverApps: async () => {',
    '\n    },',
    'discoverApps implementation should be present',
  )
  assert.match(discoverApps, /invoke(?:<[^>]+>)?\(['"]discover_installed_apps['"]\)/, 'discoverApps should let the host use the system application language')
  assert.doesNotMatch(discoverApps, /useAppStore\.getState\(\)\.locale|locale/, 'discoverApps should not pass the UI locale as the application discovery language')
  assert.match(pluginApi, /invoke(?:<[^>]+>)?\(['"]cache_installed_app_icons['"][\s\S]*appIds/, 'cacheAppIcons should call the host icon cache warmup command')
  assert.match(pluginApi, /invoke(?:<[^>]+>)?\(['"]launch_installed_app['"][\s\S]*appId/, 'launchApp should pass only appId to the host command')
  assert.doesNotMatch(pluginApi, /displayPath[\s\S]*launch_installed_app|path[\s\S]*launch_installed_app/, 'launch API should not launch by display path or arbitrary path')
}

function assertPermissions() {
  const pluginTypes = read('src/workspace/pluginTypes.ts')
  const permissions = read('src/workspace/pluginPermissions.ts')
  assert.match(pluginTypes, /'app\.discover'/, 'PluginPermission should include app.discover')
  assert.match(pluginTypes, /'app\.launch'/, 'PluginPermission should include app.launch')
  assert.match(permissions, /'app\.discover'/, 'permission store should list app.discover')
  assert.match(permissions, /'app\.launch'/, 'permission store should list app.launch')
  assert.match(permissions, /Discover installed applications|扫描已安装应用/, 'app.discover should have a user-visible label')
  assert.match(permissions, /Launch installed applications|启动已安装应用/, 'app.launch should have a user-visible label')
}

function assertGlobalLauncherDomainPermissionGate() {
  const globalLauncher = read('src/components/GlobalLauncher.tsx')
  const selectItemStart = globalLauncher.indexOf('const selectItem = (item:')
  assert.notEqual(selectItemStart, -1, 'GlobalLauncher should keep selection handling in selectItem')
  const standaloneStart = globalLauncher.indexOf('if (standaloneLauncher)', selectItemStart)
  assert.notEqual(standaloneStart, -1, 'GlobalLauncher selectItem should keep standalone branch after domain item handling')
  const domainSelectPath = globalLauncher.slice(selectItemStart, standaloneStart)

  const missing = []
  if (!/item\.kind\s*===\s*['"]domain['"][\s\S]*missingPluginItemPermissions\([^)]*item\.domainItem[^)]*\)|item\.kind\s*===\s*['"]domain['"][\s\S]*pluginRegistry\.getPluginPermissions[\s\S]*missingPluginPermissions/.test(domainSelectPath)) {
    missing.push('detect plugin requested permissions and missing grants before executing an ordinary domain launcher item')
  }
  if (!/itemPermissionFrame|setItemPermissionFrame|PermissionGate/.test(domainSelectPath) || !/itemPermissionFrame \? \([\s\S]{0,500}<PluginSurfacePermissionGate[\s\S]{0,500}onGrant=\{grantItemPermissionsAndRun\}/.test(globalLauncher)) {
    missing.push('render or invoke an authorization gate for ordinary plugin-backed domain launcher items')
  }
  if (!/grantPluginPermissions\([^)]*itemPermissionFrame\.source[^)]*itemPermissionFrame\.pluginId[^)]*itemPermissionFrame\.permissions[^)]*\)[\s\S]*executeDomainItem\([^)]*item[^)]*customizeParams/.test(globalLauncher)) {
    missing.push('grant the missing permissions and then retry or explicitly continue the original launcher item execution')
  }

  assert.deepEqual(
    missing,
    [],
    'GlobalLauncher ordinary plugin domain launcher items need a permission authorization entry before execution',
  )
}

function assertScriptsViewPluginPermissionEntry() {
  const scriptsView = read('src/views/ScriptsView.tsx')

  const missing = []
  if (!/pluginRegistry\.getPluginPermissions\([^)]*pluginId[^)]*source[^)]*\)[\s\S]*getPluginPermissionSnapshot\([^)]*source[^)]*pluginId[^)]*requested[^)]*\)[\s\S]*missingPluginPermissions\([^)]*snapshot[^)]*requested[^)]*\)/.test(scriptsView)) {
    missing.push('detect plugins that declare permissions and still have missing grants in ScriptsView plugin rows')
  }
  if (!/(missingPermissions|permissionsMissing|missingDeclaredPermissions)[\s\S]{0,1200}(button|IconButton|scripts-btn|授权|Authorize|Grant|Permission|权限)/.test(scriptsView)) {
    missing.push('show an authorization status/button for plugins that declare permissions with missing grants')
  }
  if (!/grantPluginPermissions\([^)]*source[^)]*pluginId[^)]*missingPermissions[^)]*\)/.test(scriptsView)) {
    missing.push('grant all missing permissions at once with grantPluginPermissions(source, pluginId, missingPermissions)')
  }

  assert.deepEqual(
    missing,
    [],
    'ScriptsView plugin management page needs a permission authorization entry for plugins with missing declared permissions',
  )
}

function assertPluginBehavior() {
  const index = read('src/plugins/app-launcher/index.ts')
  assert.match(index, /dynamicItems\s*\(/, 'app-launcher should provide cached apps as dynamic launcher items')
  assert.match(index, /surfaces:\s*\[\s*['"]global-launcher['"]\s*\]/g, 'app launcher items should be global-launcher only')
  assert.doesNotMatch(index, /command-palette/, 'app-launcher should not appear in CommandPalette')
  assert.match(index, /pinnable:\s*false/, 'app launcher entries should not be pinnable in the first version')
  assert.match(index, /ctx\.api\.apps\.launchApp\(app\.appId\)/, 'dynamic app items should launch by appId')
  assert.doesNotMatch(index, /launchApp\([^)]*displayPath|launchApp\([^)]*path|launchApp\([^)]*command/, 'dynamic app items should not launch by path or command')
  assert.doesNotMatch(index, /launched successfully|启动成功|已启动/, 'successful app launch should not emit success copy')
  assert.match(index, /ctx\.api\.apps\.discoverApps\(\)/, 'refresh item should call host app discovery')
  assert.match(index, /title:\s*['"]refresh\.title['"]/, 'refresh item title should use the plugin locale key')
  assert.match(index, /subtitle:\s*['"]refresh\.subtitle['"]/, 'refresh item subtitle should use the plugin locale key')
  assert.match(index, /ctx\.t\(['"]refresh\.success['"]/, 'refresh success should use plugin i18n')
  assert.match(index, /ctx\.t\(['"]refresh\.permissionDenied['"]/, 'refresh permission failure should use plugin i18n')
  assert.doesNotMatch(index, /titleI18n:\s*\{[^}]*刷新应用索引|subtitleI18n:\s*\{[^}]*扫描已安装应用/, 'refresh launcher item should not hard-code localized display strings')
  assert.doesNotMatch(index, /Refresh Applications Index|Scan installed applications|Refreshed application index: \{count\} apps|Cannot refresh application index: missing application discovery permission/, 'refresh display and status copy should live in locales/*.json')
  for (const alias of ['app', 'apps', 'application', 'refresh apps', 'scan apps', '应用', '刷新应用', '扫描应用']) {
    assert.match(index, new RegExp(String.raw`['"]${alias}['"]`), `refresh item should declare alias ${alias}`)
  }
  assert.match(index, /aliases:\s*REFRESH_ALIASES|aliases:\s*\[[\s\S]*refresh apps[\s\S]*扫描应用[\s\S]*\]/, 'refresh item should use the documented aliases')
  assert.match(index, /try\s*\{[\s\S]*ctx\.api\.apps\.discoverApps\(\)[\s\S]*\}\s*catch/, 'refresh flow should catch discover failures')
  assert.doesNotMatch(index, /catch\s*\([^)]*\)\s*\{[\s\S]{0,600}(replaceCache|clearCache|deleteCache|storage\.kv\.set)/, 'refresh failure should not clear or overwrite the previous cache')
  assert.doesNotMatch(index, /ENABLE_REAL_APP_ICONS\s*=\s*false/, 'app-launcher should not ship with real app icon loading disabled')
  assert.match(index, /app-icon:\$\{appId\}|app-icon:/, 'app launcher items should use host app-icon refs with a default app icon fallback')
  assert.doesNotMatch(index, /plugin-blob|iconBlobId|storage\.blob/, 'app launcher should not copy app icons into plugin blob storage')
  assert.match(index, /hooks:\s*\{[\s\S]*startup/, 'app-launcher should register a startup hook to warm the application index')
  assert.match(index, /MAX_DYNAMIC_APP_ITEMS\s*=\s*20/, 'app-launcher dynamic items should be capped to 20 results')
  assert.match(index, /APP_INDEX_CACHE_MAX_AGE_MS|shouldRefreshApplicationIndex/, 'startup refresh should use cache age gating')
  assert.match(index, /prewarmAppIcons[\s\S]*ctx\.api\.apps\.cacheAppIcons\(appIds\)/, 'startup refresh should warm the host-owned icon disk cache through the apps API')
  assert.match(index, /appIds\s*=\s*apps\.slice\(0,\s*MAX_DYNAMIC_APP_ITEMS\)/, 'app icon warmup should be capped to the dynamic item budget')
  assert.match(index, /execute:\s*\(ctx\)\s*=>\s*refreshApplicationIndex\(ctx,\s*\{[^}]*force:\s*true/, 'manual app index refresh should force a scan')
  assert.match(index, /startup[\s\S]{0,240}refreshApplicationIndex\(ctx,\s*\{[^}]*notify:\s*false/, 'startup hook should refresh silently and only when cache is stale')
}

function assertLocales() {
  const en = JSON.stringify(readJson('src/plugins/app-launcher/locales/en.json'))
  const zh = JSON.stringify(readJson('src/plugins/app-launcher/locales/zh.json'))

  assert.match(en, /Refresh Applications Index/, 'en locale should include the refresh launcher title')
  assert.match(zh, /刷新应用索引/, 'zh locale should include the refresh launcher title')
  assert.match(en, /Refreshed application index: \{count\} apps/, 'en locale should include refresh success text')
  assert.match(zh, /已刷新应用索引：\{count\} 个应用/, 'zh locale should include refresh success text')
  assert.match(en, /Cannot refresh application index: missing application discovery permission/, 'en locale should include discover permission error')
  assert.match(zh, /无法刷新应用索引：缺少应用发现权限/, 'zh locale should include discover permission error')
  assert.match(en, /Application/, 'en locale should include the default app subtitle')
  assert.match(zh, /应用/, 'zh locale should include the default app subtitle')
}

function assertCacheAndSearchRules() {
  const model = read('src/plugins/app-launcher/storage/model.ts')
  const repository = read('src/plugins/app-launcher/storage/repository.ts')

  assert.match(model, /type CachedAppEntry\s*=\s*\{[\s\S]*nameI18n\?:/, 'cached app entries should keep localized app display names')
  assert.match(model, /type CachedAppEntry\s*=\s*\{[\s\S]*aliases\?:\s*string\[\]/, 'cached app entries should keep host-provided app search aliases')
  assert.match(model, /type AppLauncherCache\s*=\s*\{[\s\S]*version:\s*5[\s\S]*refreshedAt:\s*number[\s\S]*apps:\s*CachedAppEntry\[\]/, 'cache model should match design schema and store system-localized app names')
  assert.doesNotMatch(model, /locale\?:\s*string/, 'app launcher cache should not be partitioned by the app UI locale')
  assert.match(model, /APP_LAUNCHER_CACHE_KEY\s*=\s*['"]app-launcher:index:v5['"]/, 'cache key should invalidate older UI-locale-scoped app indexes')
  assert.doesNotMatch(model, /iconBlobId|iconHash/, 'cached apps should not store copied app icon blob refs')
  assert.match(repository, /replaceCache/, 'repository should replace cache atomically after refresh success')
  assert.match(repository, /readCache\(\)/, 'dynamic query should read cache without scanning')
  assert.doesNotMatch(repository, /cache\.locale|locale\?:\s*string/, 'app index cache should not be invalidated by UI locale changes')
  assert.match(repository, /storeDiscoveredApps/, 'repository should store discovered app metadata')
  assert.match(repository, /nameI18n:\s*app\.nameI18n/, 'repository should persist localized app names from host discovery')
  assert.match(repository, /aliases:\s*app\.aliases/, 'repository should persist host-provided app aliases such as CFBundleName')
  assert.doesNotMatch(repository, /locale,/, 'repository should not persist the UI locale for discovered app names')
  assert.doesNotMatch(repository, /storage\.blob|icon\.bytes|contentType:\s*app\.icon/, 'repository must not persist copied app icons')
  assert.doesNotMatch(repository, /discoverApps/, 'repository reads must not trigger host scans')

  assert.match(indexOrHelpers(), /basenameForSearch|searchBasename/, 'search aliases should include only displayPath basename')
  assert.match(indexOrHelpers(), /titleI18n:\s*app\.nameI18n/, 'search should include localized app names such as Feishu/Lark translations')
  assert.match(indexOrHelpers(), /searchableFieldsMatch/, 'app launcher query prefilter should reuse the shared launcher matcher')
  assert.doesNotMatch(indexOrHelpers(), /pinyin-pro|pinyin\(value/, 'app launcher should not reimplement pinyin search locally')
  assert.match(indexOrHelpers(), /app\.aliases/, 'app launcher query prefilter should include host-provided aliases such as Feishu')
  assert.doesNotMatch(indexOrHelpers(), /aliases:\s*\[[^\]]*\n\s*app\.displayPath\s*,/, 'full displayPath should not be added to aliases')
  assert.match(indexOrHelpers(), /duplicateNameSubtitles|sameName|normalizeAppName/, 'subtitles should handle exact duplicate normalized names')
  assert.match(indexOrHelpers(), /trim\(\)[\s\S]*toLowerCase\(\)|toLowerCase\(\)[\s\S]*trim\(\)/, 'duplicate-name subtitles should use trim + lowercase normalization')
  assert.match(indexOrHelpers(), /readCache\(\)[\s\S]*dynamicItems|dynamicItems[\s\S]*readCache\(\)/, 'dynamic launcher queries should be served from the system-language cache')
  assert.match(indexOrHelpers(), /display:\s*\{[\s\S]*title:\s*app\.name/, 'dynamic app items should keep the system-localized app name as the visible title')
  assert.match(indexOrHelpers(), /aliases:\s*searchAliases\(app\)/, 'dynamic app items should pass app aliases through to launcher ranking')
  assert.doesNotMatch(indexOrHelpers(), /dynamicItems[\s\S]{0,1200}discoverApps/, 'dynamic launcher queries must not trigger a disk scan')
}

function assertAppIconRuntimeBudget() {
  const resolveIcon = read('src/utils/resolveIcon.tsx')
  const globalLauncher = read('src/components/GlobalLauncher.tsx')
  const tauriConfig = readJson('src-tauri/tauri.conf.json')
  const iconReader = sliceBetween(
    resolveIcon,
    'function AppIcon(',
    '\n/**',
    'AppIcon component should be present',
  )

  assert.match(resolveIcon, /appIconUrlCache|appIconInflight/, 'app icon reads should be cached across row mounts and query rerenders')
  assert.match(resolveIcon, /APP_ICON_MAX_CONCURRENT|activeAppIconLoads|appIconQueue/, 'app icon reads should be concurrency-limited')
  assert.match(resolveIcon, /read_installed_app_icon_url/, 'app icons should resolve through a host disk-cache URL command')
  assert.match(resolveIcon, /convertFileSrc/, 'app icon cache paths should be converted to webview-safe file URLs')
  assert.equal(tauriConfig.app.security.assetProtocol?.enable, true, 'Tauri asset protocol should be enabled for app icon cache URLs')
  assert(
    tauriConfig.app.security.assetProtocol?.scope?.some((scope) => scope.includes('.local/hiven')),
    'Tauri asset protocol scope should include the host-owned hiven cache directory',
  )
  assert.doesNotMatch(resolveIcon, /new Blob\(\[bytes\]|read_installed_app_icon['"]/, 'app icon rows should not receive icon bytes through IPC')
  assert.doesNotMatch(iconReader, /invoke(?:<[^>]+>)?\(\s*['"]read_installed_app_icon_url['"][\s\S]{0,300}\)\s*\.then/, 'AppIcon rows should not invoke native icon reads directly per mount')
  assert.match(iconReader, /width:\s*size[\s\S]*height:\s*size/, 'real app icons should fill the launcher icon well size directly')
  assert.match(globalLauncher, /MAX_GLOBAL_LAUNCHER_RENDERED_ITEMS\s*=\s*20/, 'global launcher should cap rendered result rows to 20')
  assert.match(globalLauncher, /visibleFiltered|filtered\.slice\(/, 'global launcher should cap rendered result rows to avoid mounting every app icon at once')
  assert.match(globalLauncher, /aliases:\s*domainItem\.display\.aliases/, 'GlobalLauncher should preserve dynamic item aliases for final search filtering')
  assert.match(globalLauncher, /isAppIconRef[\s\S]*startsWith\(['"]app-icon:/, 'GlobalLauncher should detect app icon refs')
  assert.match(globalLauncher, /background:\s*appIcon\s*\?\s*['"]transparent['"]/, 'app launcher icons should render without the generic colored icon background')
  assert.match(globalLauncher, /resolveIcon\(item\.icon,\s*appIcon\s*\?\s*26\s*:\s*14/, 'app launcher icons should fill the 26px launcher icon well')
}

function assertPluginStartupHooks() {
  const types = read('src/workspace/pluginTypes.ts')
  const definePlugin = read('src/workspace/definePlugin.ts')
  const hookManager = read('src/workspace/pluginHookManager.ts')
  const app = read('src/App.tsx')
  const sdk = read('src/plugin-sdk.ts')

  assert.match(types, /PluginStartupHookContext/, 'plugin types should expose a startup hook context')
  assert.match(types, /hooks\?:\s*PluginHooksContribution|hooks\?:\s*\{[\s\S]*startup/, 'PluginDefinition should accept plugin hooks')
  assert.match(definePlugin, /definition\.hooks\s*!=\s*null/, 'definePlugin should treat hooks as a valid plugin contribution')
  assert.match(hookManager, /runPluginStartupHooks/, 'plugin hook manager should expose runPluginStartupHooks')
  assert.match(hookManager, /definition\.hooks\?\.startup/, 'plugin hook manager should discover startup hooks from plugin definitions')
  assert.match(hookManager, /missingPluginPermissions/, 'plugin startup hooks should respect declared plugin permissions')
  assert.match(hookManager, /runningStartupHooks/, 'plugin startup hooks should avoid duplicate concurrent runs')
  assert.match(hookManager, /missing\.length > 0[\s\S]*return[\s\S]*runningStartupHooks\.add/, 'missing hook permissions should not mark the startup hook as completed')
  assert.match(hookManager, /await hooks\.startup[\s\S]*completedStartupHooks\.add/, 'startup hooks should only be marked completed after a successful run')
  assert.match(hookManager, /createPluginLauncherApi|createPluginAppsApi/, 'plugin startup hooks should receive controlled host APIs')
  assert.match(app, /runPluginStartupHooks\(\)/, 'MainApp should run plugin startup hooks after plugin registration/loading')
  assert.doesNotMatch(app.slice(0, app.indexOf('function MainApp')), /runPluginStartupHooks\(\)/, 'plugin startup hooks must not run at module scope or in launcher window imports')
  assert.match(sdk, /PluginStartupHookContext|PluginHooksContribution/, 'plugin SDK should export startup hook types')
  assert.match(sdk, /searchableFieldsMatch|SearchableFields/, 'plugin SDK should export the shared launcher search matcher for first-party dynamic items')
  assert.match(read('src/views/ScriptsView.tsx'), /grantPluginPermissions\([^)]*missingPermissions[^)]*\)[\s\S]*runPluginStartupHooks\(\)/, 'granting plugin permissions from the plugin page should rerun eligible startup hooks')
}

function sliceBetween(text, startNeedle, endNeedle, errorMessage) {
  const start = text.indexOf(startNeedle)
  assert.notEqual(start, -1, errorMessage)
  const end = text.indexOf(endNeedle, start + startNeedle.length)
  assert.notEqual(end, -1, errorMessage)
  return text.slice(start, end)
}

function assertPluginBlobStorageNativePersistence() {
  const pluginStorage = read('src/workspace/pluginStorage.ts')
  const tauri = readFilesUnder('src-tauri/src', /\.rs$/)
  const blobApi = sliceBetween(
    pluginStorage,
    'blob: {',
    '\n    quota:',
    'plugin private storage should expose a blob API before quota API',
  )

  const putMethod = sliceBetween(blobApi, 'async put(', '\n\n      async get', 'blob.put should be present')
  const getMethod = sliceBetween(blobApi, 'async get(', '\n\n      async delete', 'blob.get should be present')
  const deleteMethod = sliceBetween(blobApi, 'async delete(', '\n\n      async url', 'blob.delete should be present')
  const urlMethod = blobApi.slice(blobApi.indexOf('async url('))
  const hostBlobInvoke =
    /invoke(?:<[^>]+>)?\(\s*['"]plugin[_-]?blob[_-]?(put|write|save|read|get|delete|url|path)/i

  const localBlobContentAccess =
    /localStorage\.(setItem|getItem|removeItem)|readPersistedBlob|getBlobEntry|bytesToBase64|base64ToBytes|new Blob\(\[entry\.bytes\]/
  const tauriBlobCommands =
    /plugin_blob_save[\s\S]*plugin_blob_read[\s\S]*plugin_blob_delete[\s\S]*plugin_blob_path[\s\S]*plugin_blob_clear/

  const missing = []
  if (localBlobContentAccess.test(putMethod) || !hostBlobInvoke.test(putMethod)) {
    missing.push('blob.put should persist blob bytes through a host/Tauri blob API instead of localStorage or in-memory blob content storage')
  }
  if (localBlobContentAccess.test(getMethod) || !hostBlobInvoke.test(getMethod)) {
    missing.push('blob.get should read blob bytes through a host/Tauri blob API instead of localStorage or in-memory blob content storage')
  }
  if (localBlobContentAccess.test(deleteMethod) || !hostBlobInvoke.test(deleteMethod)) {
    missing.push('blob.delete should delete persisted blob bytes through a host/Tauri blob API instead of only removing localStorage or in-memory entries')
  }
  if (localBlobContentAccess.test(urlMethod) || !hostBlobInvoke.test(urlMethod)) {
    missing.push('blob.url should resolve a host/Tauri blob URL or file path instead of building object URLs from localStorage or in-memory bytes')
  }
  if (!tauriBlobCommands.test(tauri)) {
    missing.push('Tauri host should expose plugin blob write/read/delete/url-or-path commands for native blob persistence')
  }

  assert.deepEqual(
    missing,
    [],
    'plugin blob storage must keep blob bytes out of localStorage and persist them through native storage',
  )
}

function assertPluginKvStorageNativePersistence() {
  const pluginStorage = read('src/workspace/pluginStorage.ts')
  const tauri = readFilesUnder('src-tauri/src', /\.rs$/)
  const repository = read('src/plugins/app-launcher/storage/repository.ts')

  const kvApi = sliceBetween(
    pluginStorage,
    'kv: {',
    '\n    blob:',
    'plugin private storage should expose a KV API before blob API',
  )
  const quotaApi = sliceBetween(
    pluginStorage,
    'quota: {',
    '\n    },\n  }',
    'plugin private storage should expose a quota API',
  )

  assert.match(repository, /storage\.kv\.get/, 'app launcher cache should read through PluginPrivateStorageApi KV')
  assert.match(repository, /storage\.kv\.set/, 'app launcher cache should write through PluginPrivateStorageApi KV')
  assert.doesNotMatch(repository, /localStorage|@tauri-apps\/api\/core|invoke\(/, 'app launcher cache repository must not bypass plugin private storage')

  assert.match(kvApi, /plugin_kv_get/, 'desktop KV get should use the native SQLite command')
  assert.match(kvApi, /plugin_kv_set/, 'desktop KV set should use the native SQLite command')
  assert.match(kvApi, /plugin_kv_delete/, 'desktop KV delete should use the native SQLite command')
  assert.match(kvApi, /plugin_kv_list/, 'desktop KV list should use the native SQLite command')
  assert.match(quotaApi, /plugin_kv_usage/, 'desktop quota usage should use the native SQLite command')
  assert.match(quotaApi, /plugin_kv_prune/, 'desktop quota prune should use the native SQLite command')
  assert.match(pluginStorage, /plugin_kv_clear/, 'installed plugin cleanup should clear native SQLite KV records')
  assert.match(pluginStorage, /non-Tauri browser preview fallback/, 'localStorage KV should be documented as a non-Tauri preview fallback')

  assert.match(tauri, /rusqlite/, 'Tauri host should use SQLite for plugin KV storage')
  assert.match(tauri, /plugin-storage\.sqlite/, 'plugin KV SQLite file should live under plugin-data')
  assert.match(tauri, /CREATE TABLE IF NOT EXISTS plugin_kv/, 'Tauri host should initialize a fixed plugin_kv table')
  assert.match(tauri, /CREATE INDEX IF NOT EXISTS idx_plugin_kv_namespace_updated/, 'Tauri host should initialize the namespace updated_at index')
  assert.match(tauri, /fn plugin_kv_get/, 'Tauri host should expose plugin_kv_get')
  assert.match(tauri, /fn plugin_kv_set[\s\S]*ON CONFLICT\(source, plugin_id, key\) DO UPDATE/, 'plugin_kv_set should upsert by source/plugin/key')
  assert.match(tauri, /fn plugin_kv_delete/, 'Tauri host should expose plugin_kv_delete')
  assert.match(tauri, /fn plugin_kv_list/, 'Tauri host should expose plugin_kv_list')
  assert.match(tauri, /fn plugin_kv_usage/, 'Tauri host should expose plugin_kv_usage')
  assert.match(tauri, /fn plugin_kv_prune/, 'Tauri host should expose plugin_kv_prune')
  assert.match(tauri, /fn plugin_kv_clear/, 'Tauri host should expose plugin_kv_clear')
  assert.match(tauri, /"builtin" \| "installed" \| "dev"/, 'Tauri host should validate plugin storage source')
  assert.match(tauri, /plugin_kv_round_trips_lists_usage_and_deletes/, 'native tests should cover plugin KV round trip behavior')
  assert.match(tauri, /plugin_kv_prune_and_clear_are_namespace_scoped/, 'native tests should cover plugin KV prune and clear behavior')
}

function indexOrHelpers() {
  const candidates = [
    'src/plugins/app-launcher/index.ts',
    'src/plugins/app-launcher/storage/model.ts',
    'src/plugins/app-launcher/storage/repository.ts',
  ]
  return candidates.filter(existsSync).map(read).join('\n')
}

function assertNativeHostCommands() {
  const tauri = readFilesUnder('src-tauri/src', /\.rs$/)
  const iconReader = sliceBetween(
    tauri,
    'fn read_macos_app_icon_png(',
    '\n#[cfg(target_os = "macos")]\nfn extract_app_icon',
    'macOS installed app icon reader should be present',
  )
  const iconUrlCommand = sliceBetween(
    tauri,
    'fn read_installed_app_icon_url(',
    '\nfn resolve_installed_app_entry(',
    'read_installed_app_icon_url command should be present',
  )
  const cachePathResolver = sliceBetween(
    tauri,
    'fn cached_app_icon_path(',
    '\nfn extract_app_icon_for_command(',
    'cached_app_icon_path should be present',
  )
  const iconExtractor = sliceBetween(
    tauri,
    'fn extract_app_icon_for_command(',
    '\n#[cfg(target_os = "macos")]',
    'extract_app_icon_for_command should be present',
  )
  assert.match(tauri, /discover_installed_apps/, 'Tauri host should expose discover_installed_apps')
  assert.match(tauri, /read_installed_app_icon_url/, 'Tauri host should expose on-demand installed app icon cache URLs')
  assert.match(tauri, /cache_installed_app_icons/, 'Tauri host should expose startup icon cache warmup')
  assert.match(tauri, /MAX_APP_ICON_CACHE_WARM_COUNT\s*:\s*usize\s*=\s*20/, 'Tauri host should cap startup icon cache warmup to 20 apps')
  assert.match(tauri, /launch_installed_app/, 'Tauri host should expose launch_installed_app')
  assert.match(tauri, /app_icon_cache_dir|app-icons|cached_app_icon_path/, 'Tauri host should persist app icons in a host-owned disk cache')
  assert.match(iconUrlCommand, /cached_app_icon_path/, 'icon URL command should resolve a host-owned cache path')
  assert.match(iconUrlCommand, /cache_path\.exists\(\)/, 'icon URL command should return cache hits without re-reading app icons')
  assert.match(iconUrlCommand, /extract_app_icon_for_command/, 'icon URL command should extract app icons only on cache misses')
  assert.match(iconUrlCommand, /fs::write\([^)]*cache_path[^)]*icon\.bytes/, 'icon URL command should persist cache misses to disk')
  assert.match(cachePathResolver, /app_icon_cache_dir\(\)/, 'cached app icon paths should live under the host cache directory')
  assert.match(cachePathResolver, /stable_hash/, 'cached app icon paths should use stable cache keys')
  assert.match(iconExtractor, /run_on_main_thread/, 'macOS installed app icon cache misses should run AppKit work on the main thread')
  assert.doesNotMatch(tauri, /fn installed_app_from_entry[\s\S]{0,500}icon:\s*extract_app_icon/, 'app discovery should not eagerly extract and return icon bytes')
  assert.match(tauri, /InfoPlist\.strings|read_macos_localized_bundle_name/, 'macOS app names should read localized InfoPlist.strings when available')
  assert.match(tauri, /CFBundleDisplayName = "飞书"/, 'macOS localized InfoPlist.strings fixture should cover unquoted keys used by real apps')
  assert.match(tauri, /nameI18n|name_i18n/, 'Tauri host should return localized app name maps to the launcher')
  assert.match(tauri, /aliases[\s\S]*Vec<String>/, 'Tauri host should return app aliases for alternative names such as Feishu')
  assert.match(tauri, /CFBundleName should be searchable as an app alias/, 'native tests should cover CFBundleName aliases such as Feishu')
  assert.match(tauri, /displayNameAtPath|localizedName/, 'macOS app discovery should use system display-name localization')
  assert.match(tauri, /fn discover_installed_apps\(\)/, 'macOS app discovery should not accept the current UI locale')
  assert.match(tauri, /飞书/, 'native tests should cover localized macOS app display names such as Feishu/Lark')
  assert.match(iconReader, /iconForFile|NSWorkspace/, 'installed app icon reads should use the system icon API')
  assert.match(iconReader, /representationUsingType:\s*4usize|imageRepWithData/, 'installed app icon reads should convert image bytes in memory')
  assert.doesNotMatch(iconReader, /sips|hiven-app-icon|temp_dir|remove_file|Command::new/, 'installed app icon reads should not write converted icon files to disk')
  assert.match(tauri, /\/Applications|Applications/, 'macOS scanner should cover Applications directories')
  assert.match(tauri, /\/usr\/share\/applications|desktop-entry/, 'Linux scanner/parser should cover desktop entries')
  assert.match(tauri, /Start Menu|app-paths|App Paths/, 'Windows scanner/parser should cover Start Menu or App Paths')
  assert.doesNotMatch(tauri, /launch_installed_app[\s\S]{0,800}(Command::new|shell)/, 'app launch should not expose arbitrary shell execution')
  assert.match(tauri, /#\[test\][\s\S]{0,1000}(app_id|stable)/, 'native tests should cover stable appId generation')
  assert.match(tauri, /#\[test\][\s\S]{0,1000}(dedupe|dedup|duplicate)/, 'native tests should cover app discovery dedupe')
  assert.match(tauri, /#\[test\][\s\S]{0,1200}(desktop|linux)/, 'native tests should cover Linux .desktop parser fixtures')
  assert.match(tauri, /#\[test\][\s\S]{0,1200}(start_menu|Start Menu|app_paths|App Paths|windows)/, 'native tests should cover Windows Start Menu/App Paths fixtures')
  assert.match(tauri, /#\[test\][\s\S]{0,1000}(icon|missing_icon|without_icon)/, 'native tests should cover icon failure without dropping app metadata')
}

assertPluginPackageShape()
assertHostLauncherApiBoundary()
assertPermissions()
assertGlobalLauncherDomainPermissionGate()
assertScriptsViewPluginPermissionEntry()
assertPluginBehavior()
assertLocales()
assertCacheAndSearchRules()
assertAppIconRuntimeBudget()
assertPluginStartupHooks()
assertPluginBlobStorageNativePersistence()
assertPluginKvStorageNativePersistence()
assertNativeHostCommands()

console.log('app launcher contract checks passed')
