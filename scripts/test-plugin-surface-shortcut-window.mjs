#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const shortcutHotkeys = read('src/hotkeys/pluginSurfaceShortcuts.ts')
const surfaceWindows = read('src/workspace/pluginSurfaceWindows.ts')
const windowManager = read('src/workspace/windowManager/pluginSurfaceWindows.ts')
const clipboardHistory = read('src/plugins/clipboard-history/index.tsx')
const openRequest = read('src/workspace/pluginSurfaceOpenRequest.ts')
const globalLauncher = read('src/launcher/hosts/GlobalLauncherHost.tsx') + '\n' + read('src/components/launcher/GlobalLauncherSurfaceFrame.ts')

assert.match(surfaceWindows, /getPluginSurfaceShortcutPresentation[\s\S]*shortcutPresentation === ['"]window['"]/, 'surface metadata must choose window presentation for shortcuts')
assert.match(windowManager, /function\s+showPluginSurfaceWindow\(target:[\s\S]*requestOpenPluginSurfaceWindow\(target\)/, 'window manager must expose plugin surface open lifecycle through a facade')
assert.match(shortcutHotkeys, /getPluginSurfaceShortcutPresentation\(target\) === ['"]window['"][\s\S]*showPluginSurfaceWindow\(target\)/, 'shortcut handler must route window surfaces through the window manager')
assert.doesNotMatch(shortcutHotkeys, /requestOpenPluginSurfaceWindow/, 'shortcut handler must not call the lower-level plugin surface lifecycle API directly')
assert.match(shortcutHotkeys, /requestOpenPluginSurfaceTool\(target\)/, 'shortcut handler must keep launcher presentation fallback')
assert.match(clipboardHistory, /shortcutPresentation:\s*['"]window['"]/, 'clipboard history shortcut must open as an independent window')
assert.match(openRequest, /openGlobalLauncherOverlay\(['"]pinned-only['"]\)/, 'launcher-presentation shortcuts must still open the transient launcher shell')
assert.match(globalLauncher, /pluginSurfaceToolTarget/, 'global launcher must keep a separate tool-shell target')
assert.match(globalLauncher, /samePluginSurfaceTarget/, 'global launcher must distinguish current launcher surface from shortcut tool target')
assert.match(globalLauncher, /clearPluginSurfaceTool\(\)[\s\S]*openPluginSurface/, 'launcher-list surface opens must not be confused with shortcut tool requests')

console.log('plugin surface shortcut window checks passed')
