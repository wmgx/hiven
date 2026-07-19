#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const packageJson = JSON.parse(read('package.json'))
const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'))
const capability = JSON.parse(read('src-tauri/capabilities/default.json'))
const app = read('src/App.tsx')
const tauriLib = read('src-tauri/src/lib.rs')
const editorWindowApi = read('src/workspace/editorWindow.ts')
const editorWindowManager = read('src/workspace/windowManager/editorWindow.ts')
const editorWindow = read('src/components/EditorWindow.tsx')
const pluginSurfaceLifecycle = read('src/workspace/pluginSurfaceWindows.ts')
const pluginSurfaceWindow = read('src/components/PluginSurfaceWindow.tsx')

assert.equal(
  packageJson.scripts?.['test:background-lifecycle'],
  'node scripts/test-background-lifecycle.mjs',
  'package.json must expose test:background-lifecycle',
)

const windows = tauriConfig.app?.windows ?? []
assert.equal(windows.filter((window) => window.label === 'launcher').length, 1, 'launcher/background runtime window must be the single initial app window')
assert.ok(windows.some((window) => window.label === 'launcher' && window.visible === false), 'launcher/background runtime must start hidden')
assert.ok(!windows.some((window) => window.label === 'main'), 'retired main window must not be an initial window')
assert.ok(!capability.windows?.includes('main'), 'retired main window must not remain in capability scope')

assert.match(app, /function LauncherRuntimeApp/, 'default App must be the launcher/background runtime')
assert.match(app, /initializePluginBackgrounds\(\)/, 'background runtime must initialize plugin backgrounds')
assert.match(app, /installGlobalPinnedLauncherHotkeys\(\)/, 'background runtime must keep global launcher hotkeys registered')
assert.match(app, /installPluginSurfaceShortcutHotkeys\(\)/, 'background runtime must keep plugin surface hotkeys registered')
assert.doesNotMatch(app, /function MainApp|<Sidebar\b|function ViewContent|<EditorWindow|<CommandPalette\s*\/>/, 'background runtime must not mount visible main/editor shells')

assert.match(tauriLib, /async fn close_quick_editor_window[\s\S]*window\.close\(\)/, 'closing editor should close only the editor window')
assert.match(editorWindowApi, /closeQuickEditorWindow\(\)/, 'frontend editor close must delegate to native editor close')
assert.match(editorWindowManager, /function\s+closeEditorWindow\([\s\S]*requestCloseEditorWindow\(/, 'editor window manager must expose a close facade')
assert.match(editorWindow, /closeEditorWindow\(/, 'editor window close controls must use the editor window manager facade')
assert.doesNotMatch(editorWindow, /requestCloseEditorWindow/, 'editor window close controls must not call the lower-level lifecycle API directly')
assert.doesNotMatch(tauriLib.match(/async fn close_quick_editor_window[\s\S]*?\n}\n/)?.[0] ?? '', /app\.exit|std::process::exit|ExitRequested/, 'closing editor must not exit the app process')

assert.match(tauriLib, /async fn hide_plugin_surface_window[\s\S]*window\.hide\(\)/, 'plugin surface close should hide the plugin window first')
assert.match(tauriLib, /schedule_plugin_surface_window_destroy[\s\S]*window\.destroy\(\)/, 'hidden plugin surface windows may be destroyed later without exiting the app')
assert.match(pluginSurfaceLifecycle, /invoke\(['"]hide_plugin_surface_window['"]/, 'frontend plugin surface close must delegate to native plugin hide')
assert.match(pluginSurfaceWindow, /hidePluginSurfaceWindow\(target\)/, 'plugin surface window close controls must use the window manager hide bridge')
assert.doesNotMatch(tauriLib.match(/async fn hide_plugin_surface_window[\s\S]*?\n}\n\nfn plugin_surface_window_label/)?.[0] ?? '', /app\.exit|std::process::exit|ExitRequested/, 'hiding plugin surface windows must not exit the app process')
assert.doesNotMatch(tauriLib.match(/fn schedule_plugin_surface_window_destroy[\s\S]*?\n}\n\nfn show_and_focus_plugin_surface_window/)?.[0] ?? '', /app\.exit|std::process::exit|ExitRequested/, 'destroying stale plugin surface windows must not exit the app process')

assert.match(tauriLib, /tauri::RunEvent::Reopen[\s\S]*show_launcher_window_for_hotkey/, 'reopening the app should bring back the hidden launcher runtime')
assert.doesNotMatch(tauriLib, /RunEvent::ExitRequested[\s\S]*app\.exit|process::exit|std::process::exit/, 'runtime must not explicitly exit when visible windows are closed')

console.log('background lifecycle checks passed')
