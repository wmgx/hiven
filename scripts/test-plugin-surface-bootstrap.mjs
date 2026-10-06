import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const calls = []
const exports = {}
const source = readFileSync('src/workspace/pluginRuntimeBootstrap.ts', 'utf8')
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, {
  exports,
  require: () => ({
    registerHostLauncherProviders: () => calls.push('host'),
    registerBundledPluginPackages: () => calls.push('builtin'),
    initConfigDir: async () => { calls.push('config') },
    loadInstalledPluginsFromStore: async () => { calls.push('installed') },
  }),
})

await exports.ensurePluginRuntimeReady('builtin')
assert.deepEqual(calls, ['host', 'builtin'])
await Promise.all([
  exports.ensurePluginRuntimeReady('installed'),
  exports.ensurePluginRuntimeReady('installed'),
])
assert.equal(calls.filter((call) => call === 'config').length, 1)
assert.equal(calls.filter((call) => call === 'installed').length, 1)
console.log('plugin surface bootstrap checks passed')
