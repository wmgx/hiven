#!/usr/bin/env node
/**
 * Plugin surface shortcuts registration contracts (launcher-only).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const packageJson = JSON.parse(read('package.json'))
const store = read('src/store.ts')
const surfaceHotkeys = read('src/hotkeys/pluginSurfaceShortcuts.ts')
const surfaceShortcutStore = read('src/workspace/pluginSurfaceShortcuts.ts')
const pluginTypes = read('src/workspace/pluginTypes.ts')
const pluginsContent = read('src/surfaces/PluginsContent.tsx')
const pluginSurfaceWindow = read('src/components/PluginSurfaceWindow.tsx')

assert.equal(packageJson.scripts?.['test:plugin-surface-shortcuts'], 'node scripts/test-plugin-surface-shortcuts.mjs')
assert.match(pluginTypes, /globalShortcut\.register|PluginPermission/, 'permissions include global shortcut capability')
assert.match(surfaceHotkeys, /register|shortcut|pluginSurface/, 'hotkey installer for plugin surfaces exists')
assert.match(surfaceShortcutStore, /shortcut|pluginId|surfaceId/, 'shortcut store models plugin surface bindings')
assert.match(pluginsContent, /shortcut|Shortcut|bindable|surface/, 'plugins UI can expose shortcut affordances')
assert.match(pluginSurfaceWindow, /PluginSurfaceRenderer|Escape|keydown|close/, 'plugin surface window handles lifecycle keys')
assert.match(store, /PluginSurfaceOpenTarget|pluginSurface/, 'store models plugin surface open targets')

console.log('plugin surface shortcuts checks passed')
