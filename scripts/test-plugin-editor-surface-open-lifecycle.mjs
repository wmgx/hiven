#!/usr/bin/env node
/**
 * Plugin Editor surface was retired (no in-app plugin IDE).
 * focusSurfaceInstance('plugin-editor') must land on Plugins + settings, not a dead bridge.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

assert.equal(existsSync('src/surfaces/pluginEditorSurfaceBridge.ts'), false, 'plugin editor bridge must be deleted')
assert.equal(existsSync('src/surfaces/pluginEditorState.ts'), false, 'plugin editor state type must be deleted')
assert.equal(existsSync('src/surfaces/PluginEditorSurface.tsx'), false, 'PluginEditorSurface UI must stay deleted')

const actions = readFileSync('src/surfaces/actions.ts', 'utf8')
assert.match(
  actions,
  /surface\.kind === ['"]plugin-editor['"][\s\S]*requestOpenLauncherHostSurface\(['"]system-plugins['"]\)/,
  'plugin-editor focus must open system-plugins host surface',
)
assert.match(
  actions,
  /requestOpenLauncherPluginSettingsSurface\(source, surface\.pluginId\)/,
  'plugin-editor focus must open plugin settings when pluginId is known',
)
assert.doesNotMatch(
  actions,
  /requestOpenPluginEditorSurface/,
  'actions must not call the deleted plugin editor bridge',
)

console.log('plugin-editor surface open lifecycle: retired path checks passed')
