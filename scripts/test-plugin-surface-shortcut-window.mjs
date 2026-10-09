#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const shortcutHotkeys = read('src/hotkeys/pluginSurfaceShortcuts.ts')
const surfaceWindows = read('src/workspace/pluginSurfaceWindows.ts')
const windowManager = read('src/workspace/windowManager/pluginSurfaceWindows.ts')
const clipboardHistory = read('src/plugins/clipboard-history/index.tsx')
const openRequest = read('src/workspace/pluginSurfaceOpenRequest.ts')
const selectionController = read('src/components/launcher/useGlobalLauncherSelectionController.ts')
const globalLauncher = read('src/launcher/hosts/GlobalLauncherHost.tsx') + '\n' + read('src/components/launcher/GlobalLauncherSurfaceFrame.ts')

assert.match(surfaceWindows, /getPluginSurfaceShortcutPresentation[\s\S]*shortcutPresentation === ['"]window['"]/, 'surface metadata must choose window presentation for shortcuts')
assert.match(windowManager, /function\s+showPluginSurfaceWindow\(target:[\s\S]*requestOpenPluginSurfaceWindow\(target, options\)/, 'window manager must expose plugin surface open lifecycle through a facade')
assert.match(shortcutHotkeys, /getPluginSurfaceShortcutPresentation\(target\) === ['"]window['"][\s\S]*showPluginSurfaceWindow\(target\)/, 'shortcut handler must route window surfaces through the window manager')
assert.doesNotMatch(shortcutHotkeys, /requestOpenPluginSurfaceWindow/, 'shortcut handler must not call the lower-level plugin surface lifecycle API directly')
assert.match(shortcutHotkeys, /requestOpenPluginSurfaceTool\(target\)/, 'shortcut handler must keep launcher presentation fallback')
assert.match(clipboardHistory, /shortcutPresentation:\s*['"]window['"]/, 'clipboard history shortcut must open as an independent window')

// Global/tool open request: window-presentation surfaces still open as independent windows.
assert.match(
  openRequest,
  /requestOpenPluginSurfaceTool[\s\S]*getPluginSurfaceShortcutPresentation\(target\) === ['"]window['"][\s\S]*showPluginSurfaceWindow\(target\)/,
  'requestOpenPluginSurfaceTool must redirect window-presentation surfaces to an independent window',
)
// Launcher list: window-presentation surfaces open as independent windows, with blur suppress
// so Global Launcher stays open (smart companion blur — see launcherBlurGuard).
assert.match(
  selectionController,
  /getPluginSurfaceShortcutPresentation\(target\) === ['"]window['"][\s\S]*showPluginSurfaceWindow\(target,/,
  'launcher list selection must open window-presentation surfaces as independent windows',
)
assert.match(
  selectionController,
  /suppressStandaloneLauncherBlur/,
  'opening companion window from launcher must suppress blur-dismiss during focus handoff',
)
const blurGuard = read('src/workspace/launcherBlurGuard.ts')
assert.match(blurGuard, /isHivenCompanionWindowActive|shouldKeepLauncherOpenOnBlur/, 'blur guard must keep launcher open for companion windows')
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
const lifecycle = read('src/components/launcher/GlobalLauncherWindowLifecycle.ts')
assert.match(lifecycle, /shouldKeepLauncherOpenOnBlur/, 'blur dismiss must use smart companion keep-open')
assert.match(openRequest, /if \(!isNativeDesktopRuntime\(\)\) \{[\s\S]*openLauncherHostedPluginSurface\(target\)/, 'non-Tauri launcher-presentation shortcuts must use the bridge instead of duplicating store writes')
assert.match(globalLauncher, /pluginSurfaceToolTarget/, 'global launcher must keep a separate tool-shell target')
assert.match(globalLauncher, /samePluginSurfaceTarget/, 'global launcher must distinguish current launcher surface from shortcut tool target')
assert.match(globalLauncher, /clearPluginSurfaceTool\(\)[\s\S]*openPluginSurface/, 'launcher-list surface opens must not be confused with shortcut tool requests')

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
