#!/usr/bin/env node
/** Plugin surface open lifecycle static contract. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const lifecycle = readFileSync('src/workspace/pluginSurfaceWindows.ts', 'utf8')
const blur = readFileSync('src/workspace/launcherBlurGuard.ts', 'utf8')
const windowManager = readFileSync('src/workspace/windowManager/pluginSurfaceWindows.ts', 'utf8')

assert.match(blur, /export function suppressStandaloneLauncherBlur/, 'blur guard export')
assert.match(lifecycle, /suppressStandaloneLauncherBlur/, 'open path suppresses launcher blur')
assert.match(lifecycle, /requestOpenPluginSurfaceWindow|showPluginSurfaceWindow/, 'open API')
assert.match(windowManager, /showPluginSurfaceWindow|hidePluginSurfaceWindow/, 'window manager')
console.log('plugin surface window lifecycle (static) checks passed')
