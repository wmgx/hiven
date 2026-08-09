#!/usr/bin/env node
/**
 * Background / window lifecycle for launcher-only form factor.
 * Retired: main EditorWindow / always-visible main window.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const packageJson = JSON.parse(read('package.json'))
const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'))
const app = read('src/App.tsx')
const tauriLib = read('src-tauri/src/lib.rs')
const editorWindowApi = read('src/workspace/editorWindow.ts')
const quickEditorWindow = read('src/workspace/windowManager/quickEditorWindow.ts')
const pluginSurfaceLifecycle = read('src/workspace/pluginSurfaceWindows.ts')
const pluginSurfaceWindow = read('src/components/PluginSurfaceWindow.tsx')

assert.equal(existsSync(join(root, 'src/components/EditorWindow.tsx')), false, 'EditorWindow must stay deleted')
assert.match(editorWindowApi, /showQuickEditorWindow|requestOpenEditorWindow/, 'editor window API forwards to Quick Editor')
assert.match(quickEditorWindow, /showQuickEditorWindow|QUICK_EDITOR/, 'quick editor window manager exists')
assert.match(pluginSurfaceLifecycle, /showPluginSurfaceWindow|plugin-surface/, 'plugin surface lifecycle exists')
assert.match(pluginSurfaceWindow, /PluginSurfaceRenderer|plugin-surface/, 'plugin surface window component exists')
assert.match(app, /GlobalLauncher|LauncherRuntimeApp|registerBundledPluginPackages/, 'App hosts launcher runtime')
assert.match(tauriLib, /show_launcher_window|create_launcher|launcher/, 'native launcher window support present')
assert.ok(tauriConfig.productName || tauriConfig.identifier, 'tauri config present')
assert.ok(packageJson.scripts?.['test:background-lifecycle'], 'script registered')

console.log('background lifecycle (launcher-only) checks passed')
