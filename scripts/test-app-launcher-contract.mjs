#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function readJson(path) {
  return JSON.parse(read(path))
}

const files = {
  packageJson: read('package.json'),
  builtinIndex: read('src/builtin-plugins/index.json'),
  bundledLoader: read('src/workspace/bundledPluginLoader.ts'),
  registry: read('src/workspace/launcher/registry.ts'),
  hostProvider: read('src/workspace/launcher/hostProvider.ts'),
  hostActions: read('src/workspace/launcher/hostActions.ts'),
  hostAppLauncher: read('src/workspace/appLauncher/hostAppLauncher.ts'),
  app: read('src/App.tsx'),
  resolveIcon: read('src/utils/resolveIcon.tsx'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:app-launcher-contract'],
  'node scripts/test-app-launcher-contract.mjs',
  'package.json must expose test:app-launcher-contract',
)

assert.ok(existsSync(join(root, 'src/workspace/appLauncher/hostAppLauncher.ts')), 'host app launcher module must exist')
assert.ok(existsSync(join(root, 'src/workspace/launcher/hostActions.ts')), 'host pane action module must exist')
assert.ok(existsSync(join(root, 'src/workspace/launcher/hostProvider.ts')), 'host launcher provider module must exist')

const builtinIndex = readJson('src/builtin-plugins/index.json')
assert.equal(
  builtinIndex.packages.some((pkg) => pkg.pluginId === 'app-launcher'),
  false,
  'app-launcher must not be shipped as a bundled plugin package',
)

assert.equal(existsSync(join(root, 'src/plugins/app-launcher')), false, 'app-launcher plugin package should be removed from source')
assert.doesNotMatch(files.bundledLoader, /HOST_OWNED_BUNDLED_PLUGIN_IDS|app-launcher/, 'bundled loader should not carry retired app-launcher plugin compatibility')
assert.match(files.app, /registerHostLauncherProviders\(\)/, 'App must register host launcher providers')
assert.match(files.app, /refreshHostApplicationIndexOnStartup\(\)/, 'App must refresh the host-owned application index on startup')

assert.match(files.registry, /setHostLauncherDynamicItemsProvider/, 'launcher registry must support host-owned dynamic providers')
assert.match(files.registry, /hostDynamicItemsProvider\(\{ query:\s*q,\s*surfaceId,\s*locale \}\)/, 'registry must run host dynamic items outside plugin providers')
assert.match(files.registry, /\.\.\.hostDynamicItems[\s\S]*\.\.\.results\.flat/, 'host dynamic items must be merged with plugin dynamic items')

assert.match(files.hostProvider, /getHostPaneControlItems/, 'host provider must include pane controls')
assert.match(files.hostProvider, /getHostAppLauncherStaticItems/, 'host provider must include app launcher static items')
assert.match(files.hostProvider, /setHostLauncherDynamicItemsProvider\(getHostAppLauncherDynamicItems\)/, 'host provider must wire app launcher dynamic items')

assert.match(files.hostActions, /host:pane:new/, 'pane controls must expose a host new-pane item')
assert.match(files.hostActions, /host:pane:split-right/, 'pane controls must expose a split-right item')
assert.match(files.hostActions, /host:pane:split-down/, 'pane controls must expose a split-down item')
assert.match(files.hostActions, /host:pane:close/, 'pane controls must expose a close-pane item')
assert.match(files.hostActions, /host:pane:focus-next/, 'pane controls must expose focus-next')
assert.match(files.hostActions, /host:pane:focus-previous/, 'pane controls must expose focus-previous')
assert.match(files.hostActions, /host:pane:toggle-sticky-scroll/, 'pane controls must expose sticky-scroll toggle')
assert.match(files.hostActions, /host:pane:set-language/, 'pane controls must expose language selection')
assert.match(files.hostActions, /useWorkspaceStore\.getState\(\)\.createPane/, 'pane controls must use host workspace APIs directly')
assert.doesNotMatch(files.hostActions, /definePlugin|PluginLauncherApi|pluginRegistry/, 'pane controls must not be implemented as a plugin')
assert.equal(existsSync(join(root, 'src/plugins/core-pane')), false, 'core-pane plugin package should be retired')

assert.match(files.hostAppLauncher, /HOST_APP_INDEX_CACHE_KEY\s*=\s*['"]hiven:host-app-launcher:index:v1['"]/, 'host app launcher must use a new host-owned cache key')
assert.doesNotMatch(files.hostAppLauncher, /app-launcher:index:v5|createPluginPrivateStorage|PluginPrivateStorageApi|storage\.kv/, 'host app launcher must not reuse the old plugin cache or plugin storage')
assert.match(files.hostAppLauncher, /invoke\(['"]discover_installed_apps['"]\)/, 'host app launcher must discover apps via native command')
assert.doesNotMatch(files.hostAppLauncher, /cache_installed_app_icons|prewarmAppIcons|APP_ICON_PREWARM/, 'host app launcher must not prewarm app icons during startup/index refresh')
assert.match(files.hostAppLauncher, /invoke\(['"]launch_installed_app['"][\s\S]*appId/, 'host app launcher must launch by appId')
assert.doesNotMatch(files.hostAppLauncher, /displayPath[\s\S]*launch_installed_app|path[\s\S]*launch_installed_app/, 'host app launcher must not launch by path')
assert.doesNotMatch(files.hostAppLauncher, /MAX_DYNAMIC_APP_ITEMS/, 'host app launcher results should no longer use the old dynamic result cap')
assert.match(files.hostAppLauncher, /if\s*\(!q\)\s*return true/, 'host app launcher should include apps in the empty-query mixed list')
assert.doesNotMatch(files.hostAppLauncher, /\.filter\(\(app\) => appMatchesQuery\(app,\s*query,\s*locale\)\)\s*\n\s*\.slice\(/, 'host app launcher dynamic results should not be sliced after matching')
assert.match(files.hostAppLauncher, /searchableFieldsMatch/, 'host app launcher must reuse shared launcher search ranking')
assert.doesNotMatch(files.hostAppLauncher, /pinyin-pro|pinyin\(value/, 'host app launcher must not reimplement pinyin search locally')
assert.match(files.hostAppLauncher, /app-icon:\$\{appId\}/, 'host app launcher must use host app-icon refs')
assert.match(files.hostAppLauncher, /host:app-launcher:refresh/, 'host app launcher must expose a host refresh item')
assert.match(files.hostAppLauncher, /host:app-launcher:app:\$\{app\.appId\}/, 'host app dynamic items must use host-owned identity')
assert.match(files.hostAppLauncher, /installedAt:\s*app\.installedAt/, 'host app dynamic items must pass install time into launcher ranking metadata')
assert.doesNotMatch(files.hostAppLauncher, /kind:\s*['"]plugin['"]/, 'host app launcher items must not be plugin items')

assert.match(files.resolveIcon, /read_installed_app_icon_url/, 'existing icon resolver must still load host app icon refs')
assert.match(files.resolveIcon, /APP_ICON_MAX_CONCURRENT\s*=\s*2/, 'host app icon refs should remain lazy-loaded with bounded concurrency')

console.log('host app launcher contract checks passed')
