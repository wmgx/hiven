#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const surfaceWindows = read('src/workspace/pluginSurfaceWindows.ts')
const windowManager = read('src/workspace/windowManager/pluginSurfaceWindows.ts')
const blurGuard = read('src/workspace/launcherBlurGuard.ts')

// An independent tool left on screen must not block dismissal into another app.
let companionFocused = false
const guardApi = {}
vm.runInNewContext(ts.transpileModule(blurGuard, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: guardApi,
  window: { __TAURI_INTERNALS__: {} },
  require: () => ({
    getCurrentWindow: () => ({ isFocused: async () => false }),
    getAllWebviewWindows: async () => [{
      label: 'plugin-surface:builtin:clipboard-history:main',
      isVisible: async () => true,
      isFocused: async () => companionFocused,
    }],
  }),
})
assert.equal(await guardApi.shouldKeepLauncherOpenOnBlur({ handoffDelayMs: 0 }), false,
  'a visible, unfocused clipboard window must allow Launcher to close')
companionFocused = true
assert.equal(await guardApi.shouldKeepLauncherOpenOnBlur({ handoffDelayMs: 0 }), true,
  'focus handed to an independent tool must still preserve Launcher')

// Execute both host API layers: only the explicitly requested Launcher handoff
// may reach native as inherited; ordinary editor/shortcut opens stay unset.
const nativeCalls = []
const surfaceApi = {}
vm.runInNewContext(ts.transpileModule(surfaceWindows, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: surfaceApi,
  require: (path) => {
    if (path === '@tauri-apps/api/core') return { invoke: async (command, args) => nativeCalls.push({ command, args }) }
    if (path === './pluginRegistry') return { pluginRegistry: { getPluginDefinition: () => null } }
    if (path === '../surfaces/registry') return { upsertSurfaceInstance: () => {} }
    if (path === './launcherBlurGuard') return { suppressStandaloneLauncherBlur: () => {} }
    if (path === './webNativeBridge') return { isNativeDesktopRuntime: () => true }
    throw new Error(`Unexpected surface lifecycle import: ${path}`)
  },
})
const managerApi = {}
vm.runInNewContext(ts.transpileModule(windowManager, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: managerApi,
  require: (path) => {
    if (path === '../pluginSurfaceWindows') return surfaceApi
    throw new Error(`Unexpected surface facade import: ${path}`)
  },
})
const historyTarget = { source: 'builtin', pluginId: 'clipboard-history', surfaceId: 'main' }
await managerApi.showPluginSurfaceWindow(historyTarget)
await managerApi.showPluginSurfaceWindow(historyTarget, { pasteTarget: 'launcher' })
await managerApi.showPluginSurfaceWindow(historyTarget)
assert.deepEqual(nativeCalls.map(({ command }) => command), Array(3).fill('show_plugin_surface_window'))
assert.deepEqual(nativeCalls.map(({ args }) => args.pasteTarget), [undefined, 'launcher', undefined],
  'explicit inheritance must survive both API layers without leaking into the next ordinary open')

console.log('plugin surface shortcut window checks passed')
