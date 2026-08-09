#!/usr/bin/env node
/** Plugin surface window native + Escape hide contract. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p) => readFileSync(join(root, p), 'utf8')
const tauriLib = read('src-tauri/src/lib.rs')
const windowComponent = read('src/components/PluginSurfaceWindow.tsx')
const surfaceLifecycle = read('src/workspace/pluginSurfaceWindows.ts')
const windowManager = read('src/workspace/windowManager/pluginSurfaceWindows.ts')
const capability = JSON.parse(read('src-tauri/capabilities/default.json'))

assert.match(tauriLib, /show_plugin_surface_window|hide_plugin_surface_window/, 'native plugin surface window commands')
assert.match(tauriLib, /plugin-surface:/, 'stable plugin-surface labels')
assert.ok(
  capability.windows?.some?.((w) => String(w).includes('plugin-surface')) ||
    capability.windows?.includes?.('plugin-surface:*'),
  'capability allows plugin-surface',
)
assert.match(windowComponent, /parseTargetFromUrl|plugin-surface/, 'window parses target')
assert.match(windowComponent, /addEventListener\(['"]keydown['"]/, 'Escape captured via keydown listener')
assert.match(windowComponent, /hidePluginSurfaceWindow|hideCurrentPluginSurfaceWindow/, 'hide via window manager')
assert.doesNotMatch(windowComponent, /getCurrentWindow\(\)\.hide/, 'must not hide native window directly')
assert.match(surfaceLifecycle, /showPluginSurfaceWindow|requestOpenPluginSurfaceWindow/, 'lifecycle open API')
assert.match(windowManager, /showPluginSurfaceWindow|hidePluginSurfaceWindow/, 'window manager exports')
console.log('plugin surface window checks passed')
