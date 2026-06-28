#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const shortcutHotkeys = read('src/hotkeys/pluginSurfaceShortcuts.ts')
const surfaceWindows = read('src/workspace/pluginSurfaceWindows.ts')
const clipboardHistory = read('src/plugins/clipboard-history/index.tsx')
const openRequest = read('src/workspace/pluginSurfaceOpenRequest.ts')
const globalLauncher = read('src/launcher/hosts/GlobalLauncherHost.tsx')

assert.match(surfaceWindows, /getPluginSurfaceShortcutPresentation[\s\S]*shortcutPresentation === ['"]window['"]/, 'surface metadata must choose window presentation for shortcuts')
assert.match(shortcutHotkeys, /getPluginSurfaceShortcutPresentation\(target\) === ['"]window['"][\s\S]*requestOpenPluginSurfaceWindow\(target\)/, 'shortcut handler must route window surfaces to independent windows')
assert.match(shortcutHotkeys, /requestOpenPluginSurfaceTool\(target\)/, 'shortcut handler must keep launcher presentation fallback')
assert.match(clipboardHistory, /shortcutPresentation:\s*['"]window['"]/, 'clipboard history shortcut must open as an independent window')
assert.match(openRequest, /openGlobalLauncherOverlay\(['"]pinned-only['"]\)/, 'launcher-presentation shortcuts must still open the transient launcher shell')
assert.match(globalLauncher, /pluginSurfaceToolTarget/, 'global launcher must keep a separate tool-shell target')
assert.match(globalLauncher, /samePluginSurfaceTarget/, 'global launcher must distinguish current launcher surface from shortcut tool target')
assert.match(globalLauncher, /clearPluginSurfaceTool\(\)[\s\S]*openPluginSurface/, 'launcher-list surface opens must not be confused with shortcut tool requests')

console.log('plugin surface shortcut window checks passed')
