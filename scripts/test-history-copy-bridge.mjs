import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function fixture() {
  const calls = [], intervals = [], changes = []
  let native = true, failWrite = false, publicText = 'initial', historyText = 'initial'
  const permissions = []
  const cache = new Map()
  function load(name) {
    if (cache.has(name)) return cache.get(name)
    const exports = {}
    const code = ts.transpileModule(readFileSync(`src/workspace/${name}.ts`, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const scope = {
      exports, console, TextEncoder, Uint8Array, AbortSignal,
      setInterval: fn => (intervals.push(fn), intervals.length), clearInterval() {},
      navigator: { clipboard: { readText: async () => publicText, writeText: async () => { throw new Error('unexpected browser fallback') } } },
      require(specifier) {
        if (specifier === '@tauri-apps/api/core') return { invoke: async (command, args) => {
          calls.push({ command, args })
          if (command === 'clipboard_write_text') {
            if (failWrite) throw new Error('native write failed')
            publicText = args.text
            historyText = args.recordInHistory === false ? '' : args.text
            return
          }
          if (command === 'clipboard_read_history_text') return historyText
          if (command === 'clipboard_read_public_text') return publicText
          return null
        } }
        if (specifier === './nativeClipboard') return load('nativeClipboard')
        if (specifier === './pluginPermissions') return { requirePluginPermissions: (_, required) => permissions.push(...required) }
        if (specifier === './nativeImageHandle') return {}
        if (specifier === './pluginClipboardImageRead') return { createPluginClipboardImageReader() {}, createPluginClipboardReadGuard() {} }
        throw new Error(`Unexpected import ${specifier}`)
      },
    }
    Object.defineProperty(scope, '__TAURI_INTERNALS__', { get: () => native ? {} : undefined })
    vm.runInNewContext(code, scope)
    cache.set(name, exports)
    return exports
  }
  const create = id => load('pluginClipboard').createPluginClipboard(id, {})
  return { create, calls, intervals, changes, permissions, setNative: value => { native = value }, fail: value => { failWrite = value }, external: text => { publicText = historyText = text } }
}

const f = fixture()
const history = f.create('clipboard-history')
await history.watch({ text: true }, change => f.changes.push(change))
await history.writeText('full\ntext\n末尾', { recordInHistory: false })
assert.equal(await history.readText(), 'full\ntext\n末尾')
assert.ok(f.calls.some(c => c.command === 'clipboard_write_text' && c.args.recordInHistory === false))
await f.intervals[0]()
await Promise.resolve()
assert.equal(f.changes.length, 0)
f.external('external copy')
await f.intervals[0]()
await Promise.resolve()
assert.equal(f.changes[0].text, 'external copy')
assert.ok(f.permissions.includes('clipboard.write'))
await f.create('curl-inspector').writeText('synthetic-header', { recordInHistory: false })
const count = f.calls.length
await assert.rejects(() => f.create('unrelated-plugin').writeText('blocked', { recordInHistory: false }), /restricted/)
await assert.rejects(() => history.writeText('blocked', { recordInHistory: false, sensitive: true }), /restricted/)
assert.equal(f.calls.length, count)
f.fail(true)
await assert.rejects(() => history.writeText('failed', { recordInHistory: false }), /native write failed/)
f.fail(false)
f.setNative(false)
await assert.rejects(() => history.writeText('browser', { recordInHistory: false }), /native clipboard/)

const ordinary = fixture()
await ordinary.create('unrelated-plugin').watch({ text: true }, () => {})
assert.equal(ordinary.calls[0].command, 'clipboard_read_public_text')
console.log('History copy bridge behavior passed')
