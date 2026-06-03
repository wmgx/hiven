#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { runPluginAuthoringHarness } from '../src/workspace/pluginAuthoringHarness.ts'

const root = process.cwd()
const packageJson = readFileSync(join(root, 'package.json'), 'utf8')

assert.match(packageJson, /test:plugin-authoring-e2e-harness/, 'package.json should expose the plugin authoring e2e harness')

const result = await runPluginAuthoringHarness({
  pluginId: 'authoring-e2e',
  title: 'Authoring E2E',
  debugInput: 'debug input',
  pinnedInput: 'pinned input',
  params: { prefix: 'ok: ' },
})

assert.equal(result.scaffold.manifestEntry, undefined, 'manifest should not configure entry')
assert.equal(result.scaffold.fixedEntry, 'index.js', 'new plugin package should use fixed index.js entry')
assert.equal(result.scaffold.usesInjectedSdk, true, 'scaffold should use globalThis.FluxTextPlugin')
assert.equal(result.scaffold.usesWorkspaceImport, false, 'scaffold should not import workspace internals')

assert.equal(result.debug.output, 'ok: debug input', 'PluginEditor debug run should execute scaffold source')
assert.equal(result.devRegistry.commandSource, 'dev', 'created plugin command should resolve from dev registry')
assert.equal(result.pinStore.pinnedAction.kind, 'plugin-command', 'pin flow should create a plugin-command pinned action')
assert.equal(result.pinStore.pinnedAction.actionId, 'authoring-e2e.run', 'pin flow should keep the command id')
assert.equal(result.pinStore.pinnedAction.pluginId, 'authoring-e2e', 'pin flow should keep the owner plugin id')
assert.equal(result.pinStore.pinnedAction.isDev, true, 'pin flow should keep dev source')
assert.deepEqual(result.pinStore.pinnedAction.params, { prefix: 'ok: ' }, 'pin flow should keep command params')
assert.equal(result.pinIdentity.sameParamsFocusExisting, true, 'same plugin command params should focus existing pinned action')
assert.equal(result.pinIdentity.differentParamsCreateNew, true, 'different params should create another pinned action')
assert.deepEqual(result.pinnedRun.output, { text: 'ok: pinned input', kind: 'text' }, 'PinnedRunner command execution should match debug input/params behavior')
assert.equal(result.pinnedRun.devEffectsKeepContext, true, 'dev pinned command effects should preserve dev renderer/panel context')

console.log('plugin authoring e2e harness checks passed')
