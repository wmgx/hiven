#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')

assert.equal(
  packageJson.scripts?.['test:launcher-host-capability-routing-behavior'],
  'node scripts/test-launcher-host-capability-routing-behavior.mjs',
  'package.json must expose launcher host capability routing behavior coverage',
)
assert.match(
  refactorSuite,
  /test:launcher-host-capability-routing-behavior/,
  'refactor suite must include launcher host capability routing behavior coverage',
)

function loadTsModule(path, globals = {}) {
  let src = readFileSync(path, 'utf8')
  src = src.replace(/import\s+type\s*\{[\s\S]*?\}\s*from\s*['"][^'"]*['"]\s*;?\s*\n?/g, '')
  src = src.replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]*['"]\s*;?\s*\n?/g, '')
  src = src.replace(/export\s*\{[\s\S]*?\}\s*;?\s*\n?/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(out, sandbox, { filename: path })
  return sandbox.module.exports
}


function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

const launcherTypes = loadTsModule('src/workspace/launcher/types.ts')
assert.equal(launcherTypes.launcherHostHasCapability('global-launcher', 'app-search'), true)
assert.equal(launcherTypes.launcherHostHasCapability('global-launcher', 'settings'), true)
assert.equal(launcherTypes.launcherHostHasCapability('global-launcher', 'plugin-surfaces'), true)
assert.equal(launcherTypes.launcherHostHasCapability('global-launcher', 'system-power'), true)
assert.equal(launcherTypes.launcherHostHasCapability('editor-command-bar', 'text-input-actions'), true)
assert.equal(launcherTypes.launcherHostHasCapability('editor-command-bar', 'pane-actions'), true)
assert.equal(launcherTypes.launcherHostHasCapability('editor-command-bar', 'app-search'), false)
assert.equal(launcherTypes.launcherHostHasCapability('editor-command-bar', 'settings'), false)
assert.equal(launcherTypes.launcherHostHasCapability('editor-command-bar', 'plugin-surfaces'), false)
assert.equal(launcherTypes.launcherHostHasCapability('editor-command-bar', 'system-power'), false)
assert.equal(launcherTypes.normalizeLauncherSurfaceId('command-palette'), 'editor-command-bar')
assert.equal(typeof launcherTypes.filterEditorCommandBarItems, 'function', 'launcher domain must expose editor command bar item filtering')

const hostItems = [
  {
    systemKey: 'host:app:safari',
    kind: 'host',
    display: { title: 'Safari' },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher', 'editor-command-bar'],
    requiredCapabilities: ['app-search'],
  },
  {
    systemKey: 'host:view:settings',
    kind: 'host',
    display: { title: 'Settings' },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher', 'editor-command-bar'],
    requiredCapabilities: ['settings'],
  },
  {
    systemKey: 'host:system:restart',
    kind: 'host',
    display: { title: 'Restart' },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher', 'editor-command-bar'],
    requiredCapabilities: ['system-power'],
  },
  {
    systemKey: 'host:editor:format-bullets',
    kind: 'host',
    display: { title: 'Format as Bullet List' },
    behavior: { type: 'perform' },
    surfaces: ['editor-command-bar'],
    requiredCapabilities: ['text-input-actions'],
  },
  {
    systemKey: 'host:pane:close',
    kind: 'host',
    display: { title: 'Close Current Pane' },
    behavior: { type: 'perform' },
    surfaces: ['editor-command-bar'],
    requiredCapabilities: ['pane-actions'],
  },
  {
    systemKey: 'host:global:search-all-hiven',
    kind: 'host',
    display: { title: 'Search all Hiven...' },
    behavior: { type: 'perform' },
    surfaces: ['editor-command-bar'],
  },
  {
    systemKey: 'host:text:copy',
    kind: 'host',
    display: { title: 'Copy' },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher', 'editor-command-bar'],
    requiredCapabilities: ['text-input-actions'],
  },
]

const registry = loadTsModule('src/workspace/launcher/registry.ts', {
  pluginRegistry: {
    getAllPluginDefinitions: () => [
      {
        pluginId: 'translate',
        source: 'builtin',
        definition: {
          ui: {
            surfaces: [
              { id: 'main', title: 'Translate', entry: { launcher: true } },
            ],
          },
          settings: { title: 'Translate' },
          launcher: {
            items: [
              {
                id: 'editor-tool',
                display: { title: 'Plugin Text Tool' },
                behavior: { type: 'perform' },
                surfaces: ['editor-command-bar', 'global-launcher'],
                requiredCapabilities: ['text-input-actions'],
              },
            ],
          },
        },
      },
    ],
    getPluginPermissions: () => [],
  },
  usePluginSettingsStore: { getState: () => ({}) },
  makePluginT: () => (key) => key,
  launcherHostHasCapability: launcherTypes.launcherHostHasCapability,
  normalizeLauncherSurfaceId: launcherTypes.normalizeLauncherSurfaceId,
  getPluginLauncherItemKey: (pluginId, itemId) => `plugin:${pluginId}:launcher:${itemId}`,
  getPluginToolItemKey: (pluginId, itemId) => `plugin:${pluginId}:tool:${itemId}`,
  getPluginDynamicItemKey: (pluginId, itemId) => `plugin:${pluginId}:dynamic:${itemId}`,
  getPluginSurfaceItemKey: (source, pluginId, surfaceId) => `plugin-surface:${source}:${pluginId}:${surfaceId}`,
  validateLauncherItemIds: () => [],
  sanitizeSurfaces: (surfaces) => surfaces,
  findUnknownSurfaces: () => [],
  createPluginLauncherApi: () => ({}),
  createPluginLauncherStorage: () => ({}),
  resolvePluginSettingsSource: (_pluginId, source) => source,
  adaptToolToLauncherItem: () => null,
})

registry.setHostLauncherItemsProvider(() => hostItems)

const globalKeys = registry.collectStaticCandidates('global-launcher').map((item) => item.systemKey).sort()
const editorKeys = registry.collectStaticCandidates('editor-command-bar').map((item) => item.systemKey).sort()
const legacyEditorKeys = registry.collectStaticCandidates('command-palette').map((item) => item.systemKey).sort()

assert.deepEqual(plain(globalKeys), [
  'host:app:safari',
  'host:system:restart',
  'host:text:copy',
  'host:view:settings',
  'plugin-surface:builtin:translate:main',
  'plugin-settings:builtin:translate',
  'plugin:translate:launcher:editor-tool',
].sort(), 'global-launcher should receive app/settings/system/plugin-surface and shared text actions')

assert.deepEqual(plain(editorKeys), [
  'host:editor:format-bullets',
  'host:global:search-all-hiven',
  'host:pane:close',
  'host:text:copy',
  'plugin:translate:launcher:editor-tool',
].sort(), 'editor-command-bar should receive only editor-local/shared text actions plus Search all Hiven')
assert.deepEqual(plain(legacyEditorKeys), plain(editorKeys), 'legacy command-palette must normalize to editor-command-bar capability routing')

for (const globalOnlyKey of [
  'host:app:safari',
  'host:view:settings',
  'host:system:restart',
  'plugin-surface:builtin:translate:main',
  'plugin-settings:builtin:translate',
]) {
  assert.ok(!editorKeys.includes(globalOnlyKey), `${globalOnlyKey} must stay out of Editor Cmd+K`)
}
assert.ok(editorKeys.includes('host:global:search-all-hiven'), 'Editor Cmd+K must keep the explicit Search all Hiven bridge')

const dynamicItems = [
  {
    systemKey: 'dynamic:app',
    kind: 'dynamic',
    display: { title: 'Dynamic App' },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher', 'editor-command-bar'],
    requiredCapabilities: ['app-search'],
  },
  {
    systemKey: 'dynamic:text',
    kind: 'dynamic',
    display: { title: 'Dynamic Text' },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher', 'editor-command-bar'],
    requiredCapabilities: ['text-input-actions'],
  },
]
assert.deepEqual(
  plain(registry.filterDynamicForSurface(dynamicItems, 'editor-command-bar').map((item) => item.systemKey)),
  ['dynamic:text'],
  'dynamic items must use the same host capability filtering as static items',
)
assert.deepEqual(
  plain(launcherTypes.filterEditorCommandBarItems(hostItems).map((item) => item.systemKey).sort()),
  [
    'host:editor:format-bullets',
    'host:global:search-all-hiven',
    'host:pane:close',
    'host:text:copy',
  ].sort(),
  'editor command bar local filter must keep editor/pane/shared text items and the explicit global bridge only',
)

console.log('launcher host capability routing behavior checks passed')
