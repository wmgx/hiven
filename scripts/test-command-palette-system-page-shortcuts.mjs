#!/usr/bin/env node
/** System settings/plugins via GlobalLauncherSystemSurfaceFrame. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const frame = readFileSync('src/components/launcher/GlobalLauncherSystemSurfaceFrame.tsx', 'utf8')
const hostActions = readFileSync('src/workspace/launcher/hostActions.ts', 'utf8')
const bridge = readFileSync('src/workspace/launcherHostSurfaceBridge.ts', 'utf8')
assert.match(frame, /SystemSettingsSurface/, 'system frame uses SystemSettingsSurface')
assert.match(frame, /system-plugins|system-settings/, 'system targets')
assert.match(hostActions, /system-settings|system-plugins|host:global/i, 'host actions expose system pages')
assert.match(bridge, /requestOpenLauncherHostSurface/, 'host surface bridge')
console.log('command palette system page shortcuts checks passed')
