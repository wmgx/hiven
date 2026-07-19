#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const app = read('src/App.tsx')
const main = read('src/main.tsx')
const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'))
const capability = JSON.parse(read('src-tauri/capabilities/default.json'))
const tauriLib = read('src-tauri/src/lib.rs')
const hotkeys = read('src/hotkeys/globalPinnedLauncher.ts')

assert.ok(!tauriConfig.app.windows.some((window) => window.label === 'main'), 'Tauri config must not declare a main startup window')
assert.ok(tauriConfig.app.windows.some((window) => window.label === 'launcher' && window.visible === false), 'startup must keep only a hidden launcher runtime window')
assert.ok(!capability.windows.includes('main'), 'capability scope must not include retired main window')
assert.doesNotMatch(app, /function MainApp|<Sidebar\b|function ViewContent|ViewErrorBoundary/, 'App runtime must not mount the retired main navigation shell')
assert.match(app, /function LauncherRuntimeApp/, 'default App runtime must be launcher/background owned')
assert.match(app, /installGlobalPinnedLauncherHotkeys\(\)/, 'launcher runtime must install global launcher hotkeys')
assert.match(app, /installPluginSurfaceShortcutHotkeys\(\)/, 'launcher runtime must install plugin surface hotkeys')
assert.match(app, /initializePluginBackgrounds\(\)/, 'launcher runtime must initialize plugin backgrounds')
assert.match(main, /const windowType = new URLSearchParams/, 'entrypoint must route by window query param')
assert.doesNotMatch(tauriLib, /get_webview_window\("main"\)|show_and_focus_main_window|show_and_focus_window/, 'native runtime must not retain main window focus commands')
assert.match(hotkeys, /routeGlobalPinnedLauncherShortcut\(\)[\s\S]{0,300}showLauncherWindow\(\)/, 'global hotkey must open launcher directly')

console.log('no main window startup checks passed')
