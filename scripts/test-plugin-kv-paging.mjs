import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import vm from 'node:vm'

const calls = [], permissions = []
let native = true, denied = false
const exports = {}
const sandbox = {
  exports, console, URL, Date, Uint8Array,
  window: {}, localStorage: { length: 0 },
  require(name) {
    if (name === './pluginPermissions') return { requirePluginPermissions: (_, required) => { if (denied) throw new Error('denied'); permissions.push(...required) } }
    if (name === './pluginBlobExport') return { createPluginPngSaver: () => () => {} }
    if (name === '@tauri-apps/api/core') return { invoke: async (command, args) => {
      calls.push({ command, args })
      if (command === 'plugin_kv_page') return { entries: [{ key: 'records/1', valueJson: '{"text":"complete"}', updatedAt: 10 }], nextCursor: 'records/1' }
      if (command === 'plugin_kv_array_page') return { entries: [{ index: 2, valueJson: '{"id":"old"}' }], nextIndex: 2 }
      if (command === 'plugin_kv_batch') return { committed: false }
      throw new Error(command)
    } }
    throw new Error(`Unexpected import ${name}`)
  },
}
Object.defineProperty(sandbox.window, '__TAURI_INTERNALS__', { get: () => native ? {} : undefined })
const code = ts.transpileModule(readFileSync('src/workspace/pluginStorage.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
vm.runInNewContext(code, sandbox)
const kv = exports.createPluginPrivateStorage('builtin','fixture',{}).kv
const page = await kv.page({ prefix: 'records/', limit: 2, order: 'desc' })
assert.equal(page.entries[0].value.text,'complete')
assert.equal(page.nextCursor,'records/1')
const array = await kv.arrayPage({ key: 'legacy', path: '$.entries', afterIndex: 1, limit: 2 })
assert.equal(array.entries[0].value.id,'old')
assert.equal(array.nextIndex,2)
assert.equal((await kv.batch({ checks: [{ key: 'version', expected: undefined }, { key: 'nullable', expected: null }], operations: [{ type: 'set', key: 'version', value: 1 }, { type: 'delete', key: 'old' }] })).committed,false)
assert.equal(calls[2].args.input.checks[0].expectedJson,null)
assert.equal(calls[2].args.input.checks[1].expectedJson,'null')
assert.equal(calls[2].args.input.operations[0].valueJson,'1')
assert.ok(calls.every(call => call.args.source === 'builtin' && call.args.pluginId === 'fixture'))
assert.ok(permissions.every(permission => permission === 'storage.private'))
await assert.rejects(() => kv.batch({ operations: [{ type: 'set', key: 'invalid', value: undefined }] }), /serializable/)
const count = calls.length
denied = true
await assert.rejects(() => kv.page({ prefix: '' }), /denied/)
denied = false
native = false
await assert.rejects(() => kv.batch({ operations: [] }), /native/)
await assert.rejects(() => kv.page({ prefix: '' }), /native/)
await assert.rejects(() => kv.arrayPage({ key:'legacy',path:'$' }), /native/)
assert.equal(calls.length,count)
console.log('Bounded storage host behavior passed')
