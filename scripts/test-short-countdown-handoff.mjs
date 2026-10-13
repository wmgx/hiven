import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const source = ts.transpileModule(readFileSync('src/shortCountdownHandoff.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const state = { globalLauncherOpen: true, globalLauncherSessionId: 1 }
const item = { source: 'builtin', pluginId: 'date-time-assistant', systemKey: 'plugin:date-time-assistant:dynamic:countdown-start', pluginLifetime: { active: true } }
let bundled = true, invokeEffect = () => ({ supported: true, record: { id: 'new' } }), calls = []
const modules = {
  '@tauri-apps/api/core': { invoke: async (command, args) => { calls.push({ command, args }); return invokeEffect() } },
  './store': { useAppStore: { getState: () => state } },
  './workspace/bundledPluginIdentity': { isCurrentBundledDefinition: () => bundled },
  './workspace/pluginRegistry': { pluginRegistry: { getPluginDefinition: () => ({}) } },
  './workspace/toastRouting': { nativeToastRoutingAvailable: () => true },
}
const module = { exports: {} }
vm.runInNewContext(source, { module, exports: module.exports, crypto: { randomUUID: () => 'new' }, require: key => { assert(key in modules); return modules[key] } })
const bind = overrides => module.exports.withShortCountdown({}, { ...item, ...overrides })
for (const overrides of [{ source: 'installed' }, { pluginId: 'other' }, { systemKey: 'plugin:date-time-assistant:launcher:open-date' }]) assert.equal(bind(overrides).shortCountdown, undefined)
bundled = false; assert.equal(bind().shortCountdown, undefined); bundled = true
const api = bind()
assert.equal((await api.shortCountdown({ action: 'start', seconds: 10 })).started, true)
const statusOnly = bind({ systemKey: 'plugin:date-time-assistant:launcher:countdown-status' })
await assert.rejects(statusOnly.shortCountdown({ action: 'start', seconds: 10 }))
await statusOnly.shortCountdown({ action: 'cancel', id: 'old' })
assert.equal(calls.at(-1).args.id, 'old')
const before = calls.length
state.globalLauncherSessionId++
await assert.rejects(api.shortCountdown({ action: 'start', seconds: 10 })); assert.equal(calls.length, before)
const retained = bind(); invokeEffect = () => { state.globalLauncherSessionId++; return { record: { id: 'new' } } }
await assert.rejects(retained.shortCountdown({ action: 'start', seconds: 10 }), 'late result cannot enter replacement session')
console.log('Short countdown handoff provenance, action scope, old owner and late response passed')
