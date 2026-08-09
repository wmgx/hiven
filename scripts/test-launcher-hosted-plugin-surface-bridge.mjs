#!/usr/bin/env node
/** Launcher-hosted plugin surface open bridge. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const openReq = readFileSync('src/workspace/pluginSurfaceOpenRequest.ts', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')

assert.match(openReq, /export function openLauncherHostedPluginSurface/, 'hosted open export')
assert.match(openReq, /clearPendingPluginSurfaceOpenTarget\(\)/, 'clears pending')
assert.match(openReq, /openPluginSurfaceTool\(target\)/, 'writes AppStore tool target')
assert.match(openReq, /openGlobalLauncherOverlay/, 'opens launcher overlay')
assert.match(openReq, /requestOpenPluginSurfaceTool/, 'tool/shortcut open entry')
assert.match(openReq, /shortcutPresentation[\s\S]*window/, 'window presentation path')
assert.match(app, /openLauncherHostedPluginSurface/, 'App consumes hosted open')
console.log('launcher-hosted plugin surface bridge checks passed')
