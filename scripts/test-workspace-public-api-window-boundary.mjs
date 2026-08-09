#!/usr/bin/env node
/** Public plugin host API boundary. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

assert.equal(existsSync('src/workspace/pluginApi.ts'), false, 'legacy workspace/pluginApi deleted')
const hostSdk = readFileSync('src/pluginHostSdk.ts', 'utf8')
const launcherPluginApi = readFileSync('src/workspace/launcher/pluginApi.ts', 'utf8')
assert.match(hostSdk, /export function createPluginHostSdk|export type PluginHostSdk/, 'plugin host SDK')
assert.match(hostSdk, /getPluginHostSdk/, 'SDK singleton accessor')
assert.match(launcherPluginApi, /export|createPlugin|launcher/i, 'launcher plugin API module')
assert.doesNotMatch(hostSdk, /from ['"]\.\/plugins\//, 'host SDK must not import plugins')
console.log('workspace public API window boundary checks passed')
