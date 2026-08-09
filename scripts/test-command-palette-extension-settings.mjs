#!/usr/bin/env node
/** Plugin settings open path static contract. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const bridge = readFileSync('src/workspace/launcherHostSurfaceBridge.ts', 'utf8')
const settingsStore = readFileSync('src/workspace/pluginSettingsStore.ts', 'utf8')
assert.match(bridge, /requestOpenLauncherPluginSettingsSurface/, 'settings open bridge')
assert.match(settingsStore, /resolvePluginSettings|pluginSettings|PluginSettings/i, 'settings store')
console.log('command palette extension settings checks passed')
