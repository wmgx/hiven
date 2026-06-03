import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { pluginRegistry } from '../src/workspace/pluginRegistry.ts'
import { createPluginScaffoldFiles } from '../src/workspace/pluginScaffold.ts'
import { parsePluginDefinitionSource, runPluginDebugSource } from '../src/workspace/pluginDebugRunner.ts'
import { runTextPluginCommand } from '../src/workspace/pluginCommandRunner.ts'

const pluginRuntimeSource = readFileSync('src/workspace/pluginRuntime.ts', 'utf8')

const scaffold = createPluginScaffoldFiles({
  pluginId: 'authoring-flow',
  title: 'Authoring Flow',
})

assert.equal(scaffold.manifest.pluginId, 'authoring-flow', 'scaffold manifest should use the requested plugin id')
assert.equal(scaffold.manifest.displayName, 'Authoring Flow', 'scaffold manifest should use the requested display name')
assert.equal(scaffold.manifest.entry, undefined, 'scaffold manifest must not configure an entry file')
assert.match(scaffold.indexSource, /globalThis\.FluxTextPlugin/, 'scaffold should use the injected FluxTextPlugin SDK')
assert.match(scaffold.indexSource, /\{\s*definePlugin,\s*effects,\s*ui\s*\}\s*=\s*globalThis\.FluxTextPlugin/, 'scaffold should expose injected UI helpers to plugin authors')
assert.match(scaffold.readmeSource, /ui\.(?:Button|TextInput|Select|Checkbox)/, 'scaffold README should document host-injected UI primitives')
assert.doesNotMatch(scaffold.indexSource, /\.\.\/workspace|@\/workspace/, 'scaffold must not import framework internals')

const definition = parsePluginDefinitionSource(scaffold.indexSource)
assert.equal(definition?.id, 'authoring-flow', 'scaffold source should parse as a plugin definition')
assert.equal(definition?.commands?.[0]?.id, 'authoring-flow.run', 'scaffold should expose a runnable command')

const debugRun = await runPluginDebugSource(scaffold.indexSource, {
  inputText: 'sample',
  params: { prefix: 'ok: ' },
})

assert.equal(debugRun.output, 'ok: sample', 'plugin editor debug runner should execute the scaffold command')

pluginRegistry.unregisterDevPlugin('authoring-flow')
pluginRegistry.registerDevPlugin('authoring-flow', definition.commands ?? [], [], [])

const resolved = pluginRegistry.resolveCommand('authoring-flow.run', 'dev')
assert.equal(resolved?.meta.source, 'dev', 'new plugin command should resolve from the dev registry')

const pinnedRun = await runTextPluginCommand(resolved.contribution, {
  inputText: 'pinned',
  params: { prefix: 'live: ' },
})

assert.deepEqual(
  pinnedRun,
  { text: 'live: pinned', kind: 'text' },
  'pinned runner command execution should share the same input and params behavior',
)

assert.match(
  pluginRuntimeSource,
  /loadDevPluginEntry\(/,
  'pluginRuntime should provide a dedicated dev entry loader',
)
assert.match(
  pluginRuntimeSource,
  /sideloadDevPlugin[\s\S]*loadDevPluginEntry\(/,
  'dev sideload should use dev entry parsing path instead of shared asset URL loader',
)
assert.match(
  pluginRuntimeSource,
  /reloadDevPlugin[\s\S]*loadDevPluginEntry\(/,
  'dev reload should use dev entry parsing path instead of shared asset URL loader',
)
assert.doesNotMatch(
  pluginRuntimeSource,
  /sideloadDevPlugin[\s\S]*loadPluginEntry\(/,
  'dev sideload should avoid calling URL-based shared loader directly',
)
assert.doesNotMatch(
  pluginRuntimeSource,
  /reloadDevPlugin[\s\S]*loadPluginEntry\(/,
  'dev reload should avoid calling URL-based shared loader directly',
)

const paneEffectSource = `const { definePlugin, effects } = globalThis.FluxTextPlugin

export default definePlugin({
  id: 'pane-output-flow',
  title: 'Pane Output Flow',
  version: '1.0.0',
  commands: [{
    id: 'pane-output-flow.run',
    title: 'Run',
    run() {
      return { effects: [effects.createPane('pane output', 'Generated')] }
    },
  }],
})
`

const paneDefinition = parsePluginDefinitionSource(paneEffectSource)
const paneOutput = await runTextPluginCommand(paneDefinition.commands[0], {
  inputText: '',
})

assert.deepEqual(
  paneOutput,
  { text: 'pane output', kind: 'text' },
  'pinned runner output mapping should handle plugin pane.create effects',
)

const injectedUiSource = `const { definePlugin, effects, ui } = globalThis.FluxTextPlugin

export default definePlugin({
  id: 'ui-authoring-flow',
  title: 'UI Authoring Flow',
  version: '1.0.0',
  panels: [{
    id: 'ui-authoring-flow.panel',
    title: 'Panel',
    component() {
      return ui.Text({ children: 'host injected ui' })
    },
  }],
  commands: [{
    id: 'ui-authoring-flow.run',
    title: 'Run',
    run() {
      return { effects: [effects.status('ui ok')] }
    },
  }],
})
`

const injectedUiDefinition = parsePluginDefinitionSource(injectedUiSource)
assert.equal(injectedUiDefinition?.panels?.[0]?.id, 'ui-authoring-flow.panel', 'debug parser should support injected UI helper destructuring')
const panelElement = injectedUiDefinition.panels[0].component({
  inputs: {},
  panelId: 'ui-authoring-flow.panel',
  host: {
    close() {},
    dispatch() {},
  },
})
assert.equal(panelElement?.type, 'span', 'injected ui.Text should create a host React text primitive')
assert.equal(typeof globalThis.FluxTextPlugin, 'undefined', 'debug parser should not leak FluxTextPlugin globals in Node')

pluginRegistry.unregisterDevPlugin('authoring-flow')

console.log('plugin authoring flow checks passed')
