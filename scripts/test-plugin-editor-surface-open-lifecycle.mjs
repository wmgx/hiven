#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')
const bridge = readFileSync('src/surfaces/pluginEditorSurfaceBridge.ts', 'utf8')
const pluginsSurface = readFileSync('src/surfaces/PluginsSurface.tsx', 'utf8')
const actions = readFileSync('src/surfaces/actions.ts', 'utf8')

assert.equal(
  packageJson.scripts?.['test:plugin-editor-surface-open-lifecycle'],
  'node scripts/test-plugin-editor-surface-open-lifecycle.mjs',
  'package.json must expose plugin editor surface lifecycle coverage',
)
assert.match(
  refactorSuite,
  /test:plugin-editor-surface-open-lifecycle/,
  'refactor suite must include plugin editor surface lifecycle coverage',
)

assert.match(
  bridge,
  /PLUGIN_EDITOR_SURFACE_PENDING_KEY/,
  'plugin editor surface bridge must keep a cross-window persistent pending-open queue',
)
assert.match(
  bridge,
  /requestOpenPluginEditorSurface[\s\S]*persistPendingPluginEditorOpen\(pluginEditor\)[\s\S]*dispatchPluginEditorOpen\(pluginEditor\)[\s\S]*emit\(PLUGIN_EDITOR_SURFACE_OPEN_EVENT, pluginEditor\)/,
  'plugin editor open requests must be persisted before same-webview and Tauri event delivery',
)
assert.match(
  bridge,
  /subscribePluginEditorSurfaceOpen[\s\S]*drainPersistedPluginEditorOpenRequests\(\)[\s\S]*drainPendingPluginEditorOpenRequests\(\)/,
  'plugin editor subscribers must drain persisted requests before in-memory requests',
)

assert.match(
  bridge,
  /listen<unknown>\(PLUGIN_EDITOR_SURFACE_OPEN_EVENT[\s\S]*isPluginEditorState\(event\.payload\)[\s\S]*dispatchPluginEditorOpen\(event\.payload\)/,
  'Tauri plugin editor open events must use the same dispatch path so persistent pending entries are cleared',
)

assert.match(
  bridge,
  /function dispatchPluginEditorOpen[\s\S]*if \(listeners\.size === 0\)[\s\S]*pendingPluginEditorOpenRequests\.push\(pluginEditor\)[\s\S]*removePendingPluginEditorOpen\(pluginEditor\)[\s\S]*for \(const listener of listeners\)/,
  'delivered plugin editor opens must clear persistent pending entries',
)
assert.match(
  bridge,
  /function readPendingPluginEditorOpens[\s\S]*window\.localStorage\.getItem\(PLUGIN_EDITOR_SURFACE_PENDING_KEY\)[\s\S]*parsed\.filter\(isPluginEditorState\)/,
  'pending plugin editor opens must be validated when read from cross-window local storage',
)
assert.match(
  bridge,
  /function pluginEditorOpenKey[\s\S]*pluginEditor\.source \?\? ['"]installed['"][\s\S]*pluginEditor\.pluginId[\s\S]*pluginEditor\.folderPath[\s\S]*pluginEditor\.activeFile \?\? ['"]/,
  'pending plugin editor opens must dedupe by source/plugin/folder/active file',
)

assert.match(
  pluginsSurface,
  /subscribePluginEditorSurfaceOpen\(setPluginEditor\)/,
  'PluginsSurface must subscribe to plugin editor surface open requests',
)
assert.match(
  actions,
  /kind === ['"]plugin-editor['"][\s\S]*requestOpenLauncherHostSurface\(['"]plugins['"]\)[\s\S]*requestOpenPluginEditorSurface\(/,
  'focusing a plugin-editor surface must bridge to the launcher-hosted plugins surface and request the editor sub-surface',
)

console.log('plugin editor surface open lifecycle checks passed')
