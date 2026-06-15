#!/usr/bin/env node

/**
 * Command palette extension settings entry
 *
 * A plugin/extension with a settings contribution should be discoverable from
 * the in-app command palette, and selecting that entry should open that
 * plugin's settings panel directly.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadLauncherRegistry(globals = {}) {
  let src = readFileSync('src/workspace/launcher/registry.ts', 'utf8')
  src = src.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?\n/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const openedSettingsTargets = []
const demoSettingsContribution = {
  title: 'Demo Extension Settings',
  titleI18n: { zh: 'Demo 扩展设置' },
  defaultValue: { enabled: true },
  component: function DemoSettingsBody() {},
}

const registry = loadLauncherRegistry({
  makePluginT: () => (key) => key,
  resolvePluginSettingsSource: (pluginId, source) => source === 'dev' ? 'dev' : pluginId === 'demo-installed' ? 'installed' : 'builtin',
  getPluginLauncherItemKey: (pluginId, itemId) => `plugin:${pluginId}:launcher:${itemId}`,
  getPluginToolItemKey: (pluginId, toolId) => `plugin:${pluginId}:tool:${toolId}`,
  getPluginDynamicItemKey: (pluginId, itemId) => `plugin:${pluginId}:dynamic:${itemId}`,
  getPluginSurfaceItemKey: (source, pluginId, surfaceId) => `plugin-surface:${source}:${pluginId}:${surfaceId}`,
  validateLauncherItemIds: () => [],
  sanitizeSurfaces: (surfaces) => surfaces,
  findUnknownSurfaces: () => [],
  createPluginLauncherApi: () => ({}),
  createPluginLauncherStorage: () => ({}),
  adaptToolToLauncherItem: () => null,
  usePluginSettingsStore: {
    getState: () => ({
      openSettingsDialog: (target) => openedSettingsTargets.push(target),
    }),
  },
  pluginRegistry: {
    getAllPluginDefinitions: () => [
      {
        pluginId: 'demo-extension',
        source: 'production',
        definition: {
          settings: demoSettingsContribution,
          launcher: { items: [] },
          tools: [],
          ui: { surfaces: [] },
        },
      },
    ],
    getPluginPermissions: () => [],
  },
})

const commandPaletteItems = registry.collectStaticCandidates('command-palette')
const settingsItem = commandPaletteItems.find((item) =>
  item.pluginId === 'demo-extension' &&
  item.source === 'builtin' &&
  /settings/i.test(item.display.title) &&
  /设置/.test(item.display.titleI18n?.zh ?? ''),
)

assert.ok(
  settingsItem,
  'Command palette should include a plugin/extension settings entry for plugins that declare settings',
)
assert.equal(settingsItem.pinnable, false, 'Settings shortcut should be a navigation entry, not a pinnable transform action')
assert.ok(settingsItem.surfaces?.includes('command-palette'), 'Settings shortcut should be visible in the command palette')

const result = await settingsItem.execute({
  surfaceId: 'command-palette',
  settings: demoSettingsContribution.defaultValue,
  locale: 'zh',
  api: {},
  storage: {},
  t: (key) => key,
})

assert.equal(openedSettingsTargets.length, 1, 'Selecting the command-palette settings entry should open one settings target')
assert.equal(openedSettingsTargets[0]?.pluginId, 'demo-extension', 'Settings target should use the matching plugin id')
assert.equal(openedSettingsTargets[0]?.source, 'builtin', 'Settings target should use the matching plugin source')
assert.equal(openedSettingsTargets[0]?.presentation, 'dialog', 'Command palette settings target should request dialog presentation')
assert.equal(openedSettingsTargets[0]?.context?.surfaceId, 'command-palette', 'Command palette settings target should record its launcher surface context')
assert.equal(result?.ok, true, 'Opening settings should complete the launcher action')
assert.equal(result?.keepOpen, undefined, 'Command palette settings shortcut should remain a terminal success and close normally')
assert.equal('output' in result, false, 'Opening settings should not leave the launcher in a result frame')

openedSettingsTargets.length = 0

const globalLauncherItems = registry.collectStaticCandidates('global-launcher')
const globalSettingsItem = globalLauncherItems.find((item) =>
  item.pluginId === 'demo-extension' &&
  item.source === 'builtin' &&
  /settings/i.test(item.display.title) &&
  /设置/.test(item.display.titleI18n?.zh ?? ''),
)

assert.ok(
  globalSettingsItem,
  'Global launcher should include a plugin/extension settings entry for plugins that declare settings',
)
assert.equal(globalSettingsItem.pinnable, false, 'Global launcher settings shortcut should not be pinnable')
assert.ok(globalSettingsItem.surfaces?.includes('global-launcher'), 'Settings shortcut should be visible in the global launcher')

const globalResult = await globalSettingsItem.execute({
  surfaceId: 'global-launcher',
  settings: demoSettingsContribution.defaultValue,
  locale: 'zh',
  api: {},
  storage: {},
  t: (key) => key,
})

assert.equal(openedSettingsTargets.length, 1, 'Selecting the global-launcher settings entry should open one settings target')
assert.equal(openedSettingsTargets[0]?.pluginId, 'demo-extension', 'Global launcher settings target should use the matching plugin id')
assert.equal(openedSettingsTargets[0]?.source, 'builtin', 'Global launcher settings target should use the matching plugin source')
assert.equal(openedSettingsTargets[0]?.presentation, 'global-launcher', 'Global launcher settings target should request inline launcher presentation')
assert.equal(openedSettingsTargets[0]?.context?.surfaceId, 'global-launcher', 'Global launcher settings target should record its launcher surface context')
assert.equal(globalResult?.ok, true, 'Opening global launcher settings should complete the launcher action')
assert.equal(globalResult?.keepOpen, true, 'Global launcher settings shortcut should keep the launcher window open for inline settings content')
assert.equal('output' in globalResult, false, 'Opening global launcher settings should not leave the launcher in a result frame')

console.log('extension settings launcher checks passed')
