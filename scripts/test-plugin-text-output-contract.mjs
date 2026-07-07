#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

const pluginTypes = read('src/workspace/pluginTypes.ts')
const pluginHostCore = read('src/pluginHostCore.ts')
const pluginHostSdk = read('src/pluginHostSdk.ts')
const pluginSdk = read('src/plugin-sdk.ts')
const toolAdapter = read('src/workspace/launcher/toolAdapter.ts')
const launcherSession = read('src/workspace/launcher/useLauncherSession.ts')
const packageJson = read('package.json')

assert.match(packageJson, /test:plugin-text-output-contract/, 'package.json should expose the text output contract verifier')
assert.match(pluginTypes, /type\s+PluginCommandOutput\b|export\s+type\s+PluginCommandOutput\b/, 'pluginTypes should define PluginCommandOutput')
assert.match(pluginTypes, /output\??:\s*PluginCommandOutput/, 'PluginCommandResult should support host-neutral output')
assert.match(pluginTypes, /effects\??:\s*FluxEffect\[\]/, 'PluginCommandResult should keep optional effects compatibility')
assert.match(pluginTypes, /type\s+TextCommandSurfaces\b|export\s+type\s+TextCommandSurfaces\b/, 'pluginTypes should define text command surface overrides')
assert.match(pluginTypes, /surfaces\??:\s*TextCommandSurfaces/, 'CommandContribution should support optional text command surface overrides')
assert.match(pluginHostCore, /textOutput\s*[:=]/, 'plugin host SDK should expose textOutput')
assert.match(pluginHostCore, /textError\s*[:=]/, 'plugin host SDK should expose textError')
assert.match(pluginHostCore, /defineTextCommand\s*[:=]|function\s+defineTextCommand/, 'plugin host SDK should expose defineTextCommand for simple text transforms')
assert.match(pluginHostCore, /PluginHostCoreSdk[\s\S]*textOutput[\s\S]*textError[\s\S]*defineTextCommand/, 'PluginHostCoreSdk type should include the new helpers')
assert.match(pluginHostSdk, /PluginHostSdk[\s\S]*textOutput[\s\S]*textError[\s\S]*defineTextCommand/, 'runtime PluginHostSdk type should include the new helpers')
assert.match(pluginSdk, /export\s+\{[\s\S]*textOutput[\s\S]*textError[\s\S]*defineTextCommand/, '@hiven/plugin barrel should re-export the new helpers')
assert.match(pluginSdk, /PluginCommandOutput|TextCommandSurfaces/, '@hiven/plugin barrel should re-export new contract types')
assert.match(toolAdapter, /tool\.run/, 'launcher tool adapter should execute explicit tool contributions')
assert.match(toolAdapter, /ctx\.params|params,/, 'launcher tool adapter should pass customized params to tools')
assert.doesNotMatch(toolAdapter, /runTextPluginCommand|CommandContribution/, 'launcher tool adapter must not wrap command contributions')
assert.match(launcherSession, /LauncherController/, 'shared launcher session should delegate launcher text output to LauncherController')
assert.match(launcherSession, /createPluginLauncherApi/, 'shared launcher session should use the shared launcher API for host-neutral text output actions')

console.log('plugin text output contract checks passed')
