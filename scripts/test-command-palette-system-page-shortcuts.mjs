#!/usr/bin/env node

/**
 * System page launcher shortcuts
 *
 * Command palette and global launcher expose system page shortcuts through the
 * first-party core controls plugin. The launcher registry should only collect
 * contributions; it should not hard-code concrete app pages.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function read(path) {
  return readFileSync(path, 'utf8')
}

function loadCorePlugin() {
  let src = read('src/plugins/core-pane/index.ts')
  src = src.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?\n/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const moduleExports = {}
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    definePlugin: (definition) => definition,
    console,
  }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports.default ?? sandbox.module.exports.corePanePlugin
}

const registrySource = read('src/workspace/launcher/registry.ts')
assert.doesNotMatch(
  registrySource,
  /HOST_VIEW_SHORTCUTS|collectDefaultHostItems|host:view:|setActiveView/,
  'launcher registry should not hard-code concrete Plugins or Settings page shortcuts',
)

const manifest = JSON.parse(read('src/plugins/core-pane/manifest.json'))
assert.notEqual(manifest.displayName, 'Pane Controls', 'core plugin display name should be broader than pane controls')
assert.notEqual(manifest.displayNameI18n?.zh, '面板控制', 'core plugin Chinese display name should be broader than pane controls')

const corePlugin = loadCorePlugin()
const launcherItems = corePlugin.launcher?.items ?? []

function findRequiredItem(id) {
  const item = launcherItems.find((candidate) => candidate.id === id)
  assert.ok(item, `core plugin should contribute launcher item ${id}`)
  assert.deepEqual(
    Array.from(item.surfaces ?? []),
    ['command-palette', 'global-launcher'],
    `${id} should appear in both launcher surfaces`,
  )
  assert.equal(item.pinnable, false, `${id} should not be pinnable`)
  return item
}

const apiCalls = []
const ctx = {
  surfaceId: 'command-palette',
  settings: {},
  locale: 'zh',
  api: {
    showPluginsPage: async () => apiCalls.push('plugins'),
    showSettingsPage: async () => apiCalls.push('settings'),
  },
  storage: {},
  t: (key) => key,
}

const pluginsItem = findRequiredItem('show-plugins-page')
assert.equal(pluginsItem.display.icon, 'Puzzle', 'plugins page shortcut should use the Plugins sidebar icon')
assert.ok(pluginsItem.display.aliases?.includes('plugins'), 'plugins page shortcut should be searchable by plugins')
assert.ok(pluginsItem.display.aliases?.includes('plugin'), 'plugins page shortcut should be searchable by singular plugin')
assert.ok(pluginsItem.display.aliases?.includes('插件'), 'plugins page shortcut should be searchable by Chinese plugin query')
const pluginsResult = await pluginsItem.execute(ctx)
assert.deepEqual(apiCalls, ['plugins'], 'plugins page shortcut should navigate through the plugin launcher API')
assert.equal(pluginsResult?.ok, true, 'plugins page shortcut should complete successfully')

apiCalls.length = 0
const globalPluginsResult = await pluginsItem.execute({ ...ctx, surfaceId: 'global-launcher' })
assert.deepEqual(apiCalls, ['plugins'], 'global launcher plugins page shortcut should navigate through the plugin launcher API')
assert.equal(globalPluginsResult?.ok, true, 'global launcher plugins page shortcut should complete successfully')

apiCalls.length = 0

const settingsItem = findRequiredItem('show-settings-page')
assert.equal(settingsItem.display.icon, 'Settings', 'settings page shortcut should use the Settings sidebar icon')
assert.ok(settingsItem.display.aliases?.includes('settings'), 'settings page shortcut should be searchable by settings')
assert.ok(settingsItem.display.aliases?.includes('setting'), 'settings page shortcut should be searchable by singular setting')
assert.ok(settingsItem.display.aliases?.includes('设置'), 'settings page shortcut should be searchable by Chinese settings query')
const settingsResult = await settingsItem.execute(ctx)
assert.deepEqual(apiCalls, ['settings'], 'settings page shortcut should navigate through the plugin launcher API')
assert.equal(settingsResult?.ok, true, 'settings page shortcut should complete successfully')

apiCalls.length = 0
const globalSettingsResult = await settingsItem.execute({ ...ctx, surfaceId: 'global-launcher' })
assert.deepEqual(apiCalls, ['settings'], 'global launcher settings page shortcut should navigate through the plugin launcher API')
assert.equal(globalSettingsResult?.ok, true, 'global launcher settings page shortcut should complete successfully')

const appSource = read('src/App.tsx')
const pluginApiSource = read('src/workspace/launcher/pluginApi.ts')
assert.match(pluginApiSource, /hiven:\/\/show-plugins-page/, 'plugin launcher API should route standalone plugins page requests to the main window')
assert.match(pluginApiSource, /hiven:\/\/show-settings-page/, 'plugin launcher API should route standalone settings page requests to the main window')
assert.match(appSource, /listen\(['"]hiven:\/\/show-plugins-page['"][\s\S]{0,260}setActiveView\(['"]scripts['"]\)/, 'main window should handle plugins page requests from the standalone launcher')
assert.match(appSource, /listen\(['"]hiven:\/\/show-settings-page['"][\s\S]{0,260}setActiveView\(['"]settings['"]\)/, 'main window should handle settings page requests from the standalone launcher')

console.log('command palette system page shortcut checks passed')
