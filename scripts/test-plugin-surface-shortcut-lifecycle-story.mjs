#!/usr/bin/env node
/** Plugin surface shortcut → window open path (static). */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const shortcuts = readFileSync('src/hotkeys/pluginSurfaceShortcuts.ts', 'utf8')
const lifecycle = readFileSync('src/workspace/pluginSurfaceWindows.ts', 'utf8')
const windowManager = readFileSync('src/workspace/windowManager/pluginSurfaceWindows.ts', 'utf8')

assert.match(shortcuts, /showPluginSurfaceWindow|getPluginSurfaceShortcutPresentation/, 'shortcut handler opens surface')
assert.match(lifecycle, /suppressStandaloneLauncherBlur/, 'open suppresses blur')
assert.match(windowManager, /showPluginSurfaceWindow/, 'window manager show')
console.log('plugin surface shortcut lifecycle (static) checks passed')
