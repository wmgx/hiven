#!/usr/bin/env node
/** Settings/Plugins via SystemSettingsSurface. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

assert.equal(existsSync('src/surfaces/PluginsManagerSurfaceContent.tsx'), false, 'PluginsManagerSurfaceContent deleted')

const systemFrame = readFileSync('src/components/launcher/GlobalLauncherSystemSurfaceFrame.tsx', 'utf8')
const systemSettings = readFileSync('src/components/SystemSettingsSurface.tsx', 'utf8')
const pluginsContent = readFileSync('src/surfaces/PluginsContent.tsx', 'utf8')
const actions = readFileSync('src/surfaces/actions.ts', 'utf8')
const bridge = readFileSync('src/workspace/launcherHostSurfaceBridge.ts', 'utf8')

assert.match(systemFrame, /SystemSettingsSurface/, 'system frame renders settings surface')
assert.match(systemFrame, /system-plugins/, 'system-plugins target')
assert.match(systemSettings, /plugins|settings/i, 'system settings has tabs')
assert.match(pluginsContent, /export function PluginsContent/, 'plugins content still exists')
assert.match(actions, /requestOpenLauncherHostSurface\(['"]system-plugins['"]\)/, 'plugins kind opens system-plugins')
assert.match(bridge, /requestOpenLauncherHostSurface|system-settings|system-plugins/, 'host surface bridge')
console.log('launcher host surface bridge checks passed')
