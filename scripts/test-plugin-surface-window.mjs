#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const tauriLib = read('src-tauri/src/lib.rs')
const windowComponent = read('src/components/PluginSurfaceWindow.tsx')
const renderer = read('src/components/pluginSurface/PluginSurfaceRenderer.tsx')
const surfaceLifecycle = read('src/workspace/pluginSurfaceWindows.ts')
const windowManager = read('src/workspace/windowManager/pluginSurfaceWindows.ts')
const capability = JSON.parse(read('src-tauri/capabilities/default.json'))

assert.match(tauriLib, /async fn show_plugin_surface_window/, 'native runtime must expose plugin surface window creation')
assert.match(tauriLib, /async fn hide_plugin_surface_window/, 'native runtime must expose plugin surface window hiding')
assert.match(tauriLib, /hide_plugin_surface_window,[\s\S]*simulate_paste/, 'hide_plugin_surface_window must be registered with Tauri')
assert.match(tauriLib, /plugin_surface_window_label[\s\S]*plugin-surface:\{source\}:\{plugin_id\}:\{surface_id\}/, 'plugin surface window labels must be stable singleton labels')
assert.match(tauriLib, /WebviewUrl::App\(url\.into\(\)\)/, 'plugin surface windows must route through URL params')
assert.match(tauriLib, /WindowEvent::Focused\(false\) if close_on_blur[\s\S]*window\.hide\(\)/, 'closeOnBlur surfaces must hide on blur')
assert.match(tauriLib, /schedule_plugin_surface_window_destroy[\s\S]*Duration::from_millis\(destroy_timeout_ms\)[\s\S]*window\.destroy\(\)/, 'hidden plugin surface windows must destroy after destroyTimeout')
assert.match(tauriLib, /touch_plugin_surface_window\(&label\)/, 'reopening a plugin surface must cancel stale destroy timers')
assert.match(tauriLib, /show_and_focus_plugin_surface_window\(&app,\s*&window\)/, 'plugin surface windows must show and focus via native helper')
assert.doesNotMatch(tauriLib.match(/async fn show_plugin_surface_window[\s\S]*?\n}\n\nfn plugin_surface_window_label/)?.[0] ?? '', /get_webview_window\("launcher"\)[\s\S]*\.hide\(\)/, 'opening a plugin surface window must not hide a launcher-hosted surface')

assert.ok(capability.windows.includes('plugin-surface:*'), 'capability scope must allow plugin surface windows')
assert.match(windowComponent, /parseTargetFromUrl/, 'plugin surface window must parse its target from URL params')
assert.match(windowComponent, /document\.addEventListener\(['"]keydown['"],\s*onKeyDown,\s*true\)/, 'plugin surface window must capture Escape at document level')
assert.match(windowComponent, /hidePluginSurfaceWindow\(target\)/, 'Escape must route hiding through the plugin surface window manager')
assert.doesNotMatch(windowComponent, /requestHidePluginSurfaceWindow\(target\)/, 'PluginSurfaceWindow must use the windowManager hide alias, not the lower-level request API directly')
assert.match(surfaceLifecycle, /invoke\(['"]hide_plugin_surface_window['"]/, 'frontend surface lifecycle must call the native hide command')
assert.match(windowManager, /requestHidePluginSurfaceWindow as hidePluginSurfaceWindow/, 'window manager must expose a hide alias for plugin surface windows')
assert.match(surfaceLifecycle, /markSurfaceInstanceState\(pluginSurfaceInstanceId\(target\),\s*['"]hidden['"]\)/, 'hiding a plugin surface window must mark the surface hidden')
assert.match(windowComponent, /<PluginSurfaceRenderer[\s\S]*presentation=['"]plugin-surface-window['"]/, 'plugin surface window must reuse shared renderer')
assert.match(renderer, /beforeOpen/, 'shared renderer must run surface beforeOpen')
assert.match(renderer, /missingPluginPermissions/, 'shared renderer must gate missing permissions')
assert.match(surfaceLifecycle, /destroyTimeoutMs/, 'frontend surface lifecycle must pass destroyTimeout to native runtime')

console.log('plugin surface window checks passed')
