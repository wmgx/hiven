import assert from 'node:assert/strict'

import { pluginRegistry } from '../src/workspace/pluginRegistry.ts'
import { createPluginScaffoldFiles } from '../src/workspace/pluginScaffold.ts'
import { parsePluginDefinitionSource, runPluginDebugSource } from '../src/workspace/pluginDebugRunner.ts'
import { runTextPluginCommand } from '../src/workspace/pluginCommandRunner.ts'

const scaffold = createPluginScaffoldFiles({
  pluginId: 'authoring-flow',
  title: 'Authoring Flow',
})

assert.equal(scaffold.manifest.pluginId, 'authoring-flow', 'scaffold manifest should use the requested plugin id')
assert.equal(scaffold.manifest.displayName, 'Authoring Flow', 'scaffold manifest should use the requested display name')
assert.equal(scaffold.manifest.entry, undefined, 'scaffold manifest must not configure an entry file')
assert.match(scaffold.indexSource, /globalThis\.FluxTextPlugin/, 'scaffold should use the injected FluxTextPlugin SDK')
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

pluginRegistry.unregisterDevPlugin('authoring-flow')

console.log('plugin authoring flow checks passed')
