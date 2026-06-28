#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')

assert.equal(
  packageJson.scripts?.['test:plugin-surface-shortcut-lifecycle-story'],
  'node scripts/test-plugin-surface-shortcut-lifecycle-story.mjs',
  'package.json must expose plugin surface shortcut lifecycle story coverage',
)
assert.match(
  refactorSuite,
  /test:plugin-surface-shortcut-lifecycle-story/,
  'refactor suite must include plugin surface shortcut lifecycle story coverage',
)


async function waitUntil(predicate, message, timeoutMs = 5_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail(message)
}

function loadTs(path, globals = {}, append = '') {
  let src = readFileSync(path, 'utf8')
  src = src.replace(/import\s+type\s*\{[\s\S]*?\}\s*from\s*['"][^'"]*['"]\s*;?\s*\n?/g, '')
  src = src.replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]*['"]\s*;?\s*\n?/g, '')
  src = src.replace(/export\s*\{[\s\S]*?\}\s*;?\s*\n?/g, '')
  src += append
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
  return sandbox
}

const target = { source: 'builtin', pluginId: 'clipboard-history', surfaceId: 'main' }
const launcherTarget = { source: 'builtin', pluginId: 'translate', surfaceId: 'main' }
const shortcutKey = (input) => `${input.source}:${input.pluginId}:${input.surfaceId}`
const registrations = new Map()
const shortcutState = {
  shortcuts: {
    [shortcutKey(target)]: {
      target,
      accelerator: 'Cmd+Shift+V',
      enabled: true,
      registrationStatus: 'idle',
    },
    [shortcutKey(launcherTarget)]: {
      target: launcherTarget,
      accelerator: 'Cmd+Shift+T',
      enabled: true,
      registrationStatus: 'idle',
    },
  },
  updateRegistration(key, patch) {
    this.shortcuts[key] = { ...this.shortcuts[key], ...patch }
  },
}
const calls = {
  registered: [],
  unregistered: [],
  showWindow: [],
  openLauncherTool: [],
}

const hotkeySandbox = loadTs('src/hotkeys/pluginSurfaceShortcuts.ts', {
  window: { __TAURI_INTERNALS__: {} },
  usePluginPermissionStore: { subscribe: () => () => {} },
  getPluginPermissionSnapshot: () => ({}),
  missingPluginPermissions: () => [],
  pluginRegistry: {
    subscribe: () => () => {},
    getAllPluginDefinitions: () => [
      {
        pluginId: 'clipboard-history',
        source: 'builtin',
        definition: { ui: { surfaces: [{ id: 'main', entry: { shortcutBindable: true, shortcutPresentation: 'window' } }] } },
      },
      {
        pluginId: 'translate',
        source: 'builtin',
        definition: { ui: { surfaces: [{ id: 'main', entry: { shortcutBindable: true, shortcutPresentation: 'launcher' } }] } },
      },
    ],
    getPluginPermissions: () => ['globalShortcut.register'],
  },
  requestOpenPluginSurfaceTool: async (input) => { calls.openLauncherTool.push(input) },
  getPluginSurfaceShortcutPresentation: (input) => input.pluginId === 'clipboard-history' ? 'window' : 'launcher',
  showPluginSurfaceWindow: async (input) => { calls.showWindow.push(input) },
  pluginSurfaceShortcutKey: shortcutKey,
  usePluginSurfaceShortcutStore: {
    getState: () => shortcutState,
    subscribe: () => () => {},
  },
  useAppStore: { getState: () => ({ settings: { globalPinnedLauncherShortcut: { kind: 'accelerator', accelerator: 'Command+Space' } } }) },
  resolvePluginSettingsSource: (_pluginId, source) => source,
}, `
;globalThis.__setShortcutApiForStory = (api) => { loadGlobalShortcutApi = () => Promise.resolve(api) }
`)

const shortcutApi = {
  isRegistered: async () => false,
  register: async (accelerator, handler) => {
    calls.registered.push(accelerator)
    registrations.set(accelerator, handler)
  },
  unregister: async (accelerator) => {
    calls.unregistered.push(accelerator)
    registrations.delete(accelerator)
  },
}
hotkeySandbox.__setShortcutApiForStory(shortcutApi)
const { installPluginSurfaceShortcutHotkeys } = hotkeySandbox.module.exports
const uninstall = installPluginSurfaceShortcutHotkeys()
await waitUntil(() => calls.registered.length === 2, `expected two shortcut registrations, got ${JSON.stringify(calls.registered)}`)

assert.deepEqual(calls.registered.sort(), ['Command+Shift+T', 'Command+Shift+V'])
assert.equal(shortcutState.shortcuts[shortcutKey(target)].registrationStatus, 'registered')
assert.equal(shortcutState.shortcuts[shortcutKey(launcherTarget)].registrationStatus, 'registered')

await registrations.get('Command+Shift+V')({ state: 'Pressed' })
assert.deepEqual(JSON.parse(JSON.stringify(calls.showWindow)), [target], 'window presentation shortcuts must call showPluginSurfaceWindow')
assert.deepEqual(calls.openLauncherTool, [], 'window presentation shortcuts must not open the launcher tool shell')

await registrations.get('Command+Shift+T')({ state: 'Pressed' })
assert.deepEqual(JSON.parse(JSON.stringify(calls.openLauncherTool)), [launcherTarget], 'launcher presentation shortcuts must fall back to requestOpenPluginSurfaceTool')

const lifecycleCalls = { invoke: [], upsert: [], mark: [] }
const surfaceDefinition = {
  ui: {
    surfaces: [
      {
        id: 'main',
        title: 'Clipboard History',
        entry: { shortcutPresentation: 'window' },
        shell: { defaultWidth: 720, defaultHeight: 420, closeOnBlur: false, destroyTimeout: 5_000 },
      },
    ],
  },
}
const lifecycleSandbox = loadTs('src/workspace/pluginSurfaceWindows.ts', {
  window: { __TAURI_INTERNALS__: {} },
  invoke: async (command, payload) => { lifecycleCalls.invoke.push({ command, payload }) },
  pluginRegistry: { getPluginDefinition: () => surfaceDefinition },
  upsertSurfaceInstance: (surface) => { lifecycleCalls.upsert.push(surface) },
  markSurfaceInstanceState: (id, state) => { lifecycleCalls.mark.push({ id, state }) },
})
const lifecycle = lifecycleSandbox.module.exports
assert.equal(lifecycle.pluginSurfaceInstanceId(target), 'plugin-surface:builtin:clipboard-history:main')
assert.equal(lifecycle.getPluginSurfaceShortcutPresentation(target), 'window')
await lifecycle.requestOpenPluginSurfaceWindow(target)
assert.deepEqual(JSON.parse(JSON.stringify(lifecycleCalls.invoke[0])), {
  command: 'show_plugin_surface_window',
  payload: {
    pluginId: 'clipboard-history',
    surfaceId: 'main',
    source: 'builtin',
    width: 720,
    height: 420,
    closeOnBlur: false,
    destroyTimeoutMs: 5_000,
  },
})
assert.deepEqual(JSON.parse(JSON.stringify(lifecycleCalls.upsert[0])), {
  id: 'plugin-surface:builtin:clipboard-history:main',
  kind: 'plugin-surface',
  windowLabel: 'plugin-surface:builtin:clipboard-history:main',
  title: 'Clipboard History',
  pluginId: 'clipboard-history',
  surfaceId: 'main',
  state: 'visible',
  canReceiveText: true,
  canProvideText: true,
  canAttachToEditor: true,
})
await lifecycle.requestHidePluginSurfaceWindow(target)
assert.deepEqual(JSON.parse(JSON.stringify(lifecycleCalls.mark[0])), {
  id: 'plugin-surface:builtin:clipboard-history:main',
  state: 'hidden',
})

uninstall()

console.log('plugin surface shortcut lifecycle story checks passed')
