import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const source = readFileSync('src/workspace/pluginSurfaceWindows.ts', 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function host(invoke) {
  const exports = {}
  vm.runInNewContext(code, { exports, setTimeout, Date, require(path) {
    if (path === '@tauri-apps/api/core') return { invoke }
    if (path === './pluginRegistry') return { pluginRegistry: { getPluginDefinition: () => null } }
    if (path === '../surfaces/registry') return { upsertSurfaceInstance() {} }
    if (path === './launcherBlurGuard') return { suppressStandaloneLauncherBlur() {} }
    if (path === './webNativeBridge') return { isNativeDesktopRuntime: () => true }
    throw Error(path)
  } })
  return exports.requestOpenPluginSurfaceWindow
}
const target = { source: 'builtin', pluginId: 'text-diff', surfaceId: 'main', initialText: '' }
let calls = [], status = 'pending', closed = false
const open = host(async (command, args) => {
  calls.push([command, args])
  if (command.endsWith('_begin')) return { id: 'generation-1' }
  if (command.endsWith('_status')) return status
  if (command.endsWith('_cancel')) return 'rejected'
})
const delivery = open(target).then(() => { closed = true })
await new Promise(r => setTimeout(r, 20))
assert.equal(closed, false, 'showing a window must not acknowledge receipt')
assert.equal(calls[0][1].initialText, '', 'empty text must also be transferred')
status = 'accepted'
await delivery
assert.equal(closed, true)
assert.ok(calls.filter(([c]) => c.endsWith('_status')).every(([,a]) => a.id === 'generation-1'))
status = 'rejected'
await assert.rejects(open(target))
assert.equal(calls.at(-1)[0], 'plugin_surface_handoff_cancel')
calls = []
await assert.rejects(open(target, { signal: AbortSignal.abort() }))
await assert.rejects(open(target, { isCurrent: () => false }))
assert.equal(calls.length, 0, 'expired owners must not begin or show a window')
let current = true
const stale = host(async command => {
  calls.push([command])
  if (command.endsWith('_begin')) { current = false; return { id: 'late' } }
  return 'rejected'
})
await assert.rejects(stale(target, { isCurrent: () => current }))
assert.deepEqual(calls.map(([c]) => c), ['plugin_surface_handoff_begin', 'plugin_surface_handoff_cancel'])
let cancel = new AbortController()
const interrupted = host(async command => {
  if (command.endsWith('_begin')) return { id: 'cancel' }
  if (command === 'show_plugin_surface_window') cancel.abort()
  return command.endsWith('_cancel') ? 'rejected' : 'pending'
})
await assert.rejects(interrupted(target, { signal: cancel.signal }))
console.log('plugin surface handoff receipt and interruption checks passed')
const recovered = host(async command => {
  if (command.endsWith('_begin')) return { id: 'accepted-but-reply-lost' }
  if (command.endsWith('_status')) throw Error('receipt transport interrupted')
  if (command.endsWith('_cancel')) return 'accepted'
})
await recovered(target)
