import assert from 'node:assert/strict'

const {
  parsePluginDefinitionSource,
  runPluginDebugSource,
} = await import('../src/workspace/pluginDebugRunner.ts')

const scaffoldSource = `const { definePlugin, effects } = globalThis.FluxTextPlugin

export default definePlugin({
  id: 'demo-runner',
  title: 'Demo Runner',
  version: '1.0.0',
  commands: [{
    id: 'demo-runner.run',
    title: 'Run',
    params: [{ key: 'prefix', label: 'Prefix', type: 'text', default: '' }],
    run(ctx) {
      const input = ctx.inputs.input
      const text = input?.kind === 'text' ? input.text : ''
      return { effects: [effects.replaceActiveText(String(ctx.params.prefix ?? '') + text)] }
    },
  }],
})
`

const definition = parsePluginDefinitionSource(scaffoldSource)
assert.equal(definition?.id, 'demo-runner', 'debug parser should read injected-SDK plugin source')
assert.equal(definition?.commands?.[0]?.id, 'demo-runner.run', 'debug parser should expose the first command')

const run = await runPluginDebugSource(scaffoldSource, {
  inputText: 'hello fluxtext',
  params: { prefix: '>> ' },
})

assert.equal(run.output, '>> hello fluxtext', 'debug runner should execute the first plugin command and collect text output')
assert.deepEqual(run.logs.slice(0, 2), ['> run demo-runner.run', 'effects: 1'], 'debug runner should report command and effect count')
assert.match(run.logs.at(-1) ?? '', /^done in \d+ms$/, 'debug runner should report elapsed time')

console.log('plugin editor debug runner checks passed')
