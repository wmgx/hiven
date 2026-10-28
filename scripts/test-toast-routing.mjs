import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Real toast/routing code, deterministic clock and simulated IPC only.
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function fixture() {
  let now = 1000, nextTimer = 0
  const timers = new Map(), listeners = new Map(), calls = [], events = []
  const h = { calls, events, timers, target: null, routeGate: null, emitGate: null }
  const modules = {
    '@tauri-apps/api/core': { invoke: async (command, payload) => {
      calls.push({ command, payload })
      if (command === 'route_toast') return h.routeGate ? h.routeGate.promise : h.target
    } },
    '@tauri-apps/api/window': { getCurrentWindow: () => ({ label: 'launcher' }) },
    '@tauri-apps/api/event': {
      emitTo: async (target, event, payload) => {
        events.push({ target, event, payload })
        if (event === 'hiven://toast-delivery' && h.emitGate) await h.emitGate.promise
      },
      listen: async (event, callback) => { listeners.set(event, callback); return () => listeners.delete(event) },
    },
    '../store': { useAppStore: { getState: () => ({ settings: { locale: 'en', theme: 'dark' } }) } },
    zustand: { create: (initialize) => {
      let state
      state = initialize((update) => { state = { ...state, ...update(state) } })
      return { getState: () => state }
    } },
  }
  function load(name) {
    const exports = {}
    const source = ts.transpileModule(readFileSync(`src/workspace/${name}.ts`, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    vm.runInNewContext(source, {
      exports, module: { exports }, console,
      Date: { now: () => now }, Math,
      window: { __TAURI_INTERNALS__: {} },
      setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: now + delay }); return id },
      clearTimeout: (id) => timers.delete(id),
      require: (id) => { assert.ok(Object.hasOwn(modules, id), `Unexpected dependency ${id}`); return modules[id] },
    })
    return exports
  }
  h.routing = modules['./toastRouting'] = load('toastRouting')
  h.toast = modules['./toast'] = load('toast')
  h.notify = load('notify')
  h.items = () => h.toast.useToastStore.getState().toasts
  h.tick = (delta) => {
    now += delta
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback() }
  }
  h.receive = (event, payload) => listeners.get(event)?.({ payload })
  h.listenerCount = () => listeners.size
  h.item = (id = 'synthetic') => ({ id, message: 'PRIVATE_BODY /synthetic/path secret-value', level: 'error', createdAt: now, expiresAt: now + 3500 })
  return h
}

{
  const h = fixture()
  h.toast.showToast('PRIVATE_BODY /synthetic/path secret-value', 'error')
  h.tick(100) // Store import yields; sequence must retain the issue-time epoch.
  await flush()
  const routed = h.calls.find(({ command }) => command === 'route_toast').payload
  assert.equal(routed.sequence, 1000 * 1000)
  assert.equal(routed.level, 'error')
  assert.equal(Object.hasOwn(routed, 'message'), false)
  assert.equal(Object.hasOwn(routed, 'action'), false)
  assert.equal(JSON.stringify(h.calls).includes('PRIVATE_BODY'), false, 'Native receives status metadata only')
  assert.equal(h.events.length, 0, 'HUD result never forwards original text to another webview')
  h.tick(4000)
  assert.equal(h.items().length, 0)
  h.tick(2000)
  assert.equal(h.timers.size, 0)
}
{
  const h = fixture(), gate = deferred()
  h.routeGate = gate
  const id = h.toast.showToast('synthetic', 'success')
  await flush()
  h.toast.dismissToast(id)
  gate.resolve('editor:1')
  await flush()
  assert.equal(h.items().length, 0)
  assert.equal(h.events.length, 0, 'Dismiss while native routing is pending prevents late delivery')
  assert.ok(h.calls.some(({ command, payload }) => command === 'dismiss_toast' && payload.id === id))
}
{
  const h = fixture(), gate = deferred()
  h.routeGate = gate
  h.toast.showToast('synthetic', 'success', 1000)
  await flush()
  h.tick(2000)
  gate.resolve('editor:1')
  await flush()
  assert.equal(h.events.length, 0, 'Expired native receipt cannot create a cross-window toast')
  assert.equal(h.items().length, 0)
}
for (const target of ['launcher', 'editor:1']) {
  const h = fixture()
  h.target = target
  h.toast.showToast('synthetic', 'info')
  await flush()
  assert.equal(h.events.length, 0, 'Feedback is never sent to another app window')
  assert.equal(h.items().length, 1, 'Inline feedback stays with its owner')

}
{
  const h = fixture(), gate = deferred()
  h.target = 'editor:1'; h.emitGate = gate
  const id = h.toast.showToast('synthetic')
  await flush()
  h.toast.dismissToast(id)
  gate.resolve()
  await flush()
  assert.equal(h.events.length, 0, 'Dismiss does not create cross-window UI')
  assert.equal(h.items().length, 0)
}
{
  const h = fixture()
  h.receive('hiven://toast-delivery', h.item('ignored'))
  assert.equal(h.items().length, 0)
  assert.equal(h.listenerCount(), 0, 'No in-window delivery listeners remain')
}

console.log('Toast routing passed: privacy, issue epoch, late dismissal, expiry, single destination and cleanup')

{
  const h = fixture()
  const hud = { operation: '00000000-0000-4000-8000-000000000000', revision: 1 }
  const first = h.toast.showToast('PRIVATE_BODY', 'error', { hud, durationMs: 6000 })
  h.tick(1000)
  h.toast.showToast('safe retry', 'success', { hud: { ...hud, revision: 2 } })
  h.toast.showToast('late failure', 'error', { hud })
  assert.equal(h.items().length, 1)
  assert.equal(h.items()[0].message, 'safe retry')
  h.toast.dismissToast(first)
  assert.equal(h.items().length, 1, 'Old dismissal cannot clear the replacement')
  await flush()
  const payloads = h.calls.filter(call => call.command === 'route_toast').map(call => call.payload)
  assert.equal(payloads.at(-1).receipt.revision, 2)
  assert.equal(JSON.stringify(payloads).includes('PRIVATE_BODY'), false)
  h.tick(3600)
  assert.equal(h.items().length, 0)
}

{
  // notify: localized status text reaches the HUD; a status updates in place by id.
  const h = fixture()
  h.notify.flash({ level: 'success', message: 'Copied' })
  h.notify.status({ id: 'queue', title: 'Paste queue ready', progress: { completed: 0, total: 2 } })
  h.notify.status({ id: 'queue', title: 'Queue item pasted', progress: { completed: 1, total: 2 } })
  await flush()
  const routed = h.calls.filter(({ command }) => command === 'route_toast').map(({ payload }) => payload)
  assert.deepEqual(routed.map(({ slot, message }) => [slot, message]), [['flash', 'Copied'], ['status', 'Paste queue ready'], ['status', 'Queue item pasted']])
  assert.equal(routed[1].id, routed[2].id, 'Same status id updates one notice')
  assert.equal(h.items().filter(({ notify }) => notify?.slot === 'status').length, 1)
  assert.ok(routed[1].expiresAt - routed[1].sequence / 1000 > 60_000, 'Status is not bounded by the flash lifetime')
  h.tick(2100)
  assert.deepEqual(Array.from(h.items(), ({ message }) => message), ['Queue item pasted'], 'Flash expires while the status stays')
  h.notify.end('queue')
  assert.equal(h.items().length, 0)
  assert.ok(h.calls.some(({ command, payload }) => command === 'dismiss_toast' && payload.id === routed[2].id))
  h.notify.status({ id: 'queue', title: 'Paste queue ready' })
  await flush()
  assert.notEqual(h.calls.filter(({ command }) => command === 'route_toast').at(-1).payload.id, routed[2].id, 'A restarted session is not hidden by the ended tombstone')
  h.notify.flash({ level: 'info', message: `${'x'.repeat(100)}\nnext line` })
  assert.ok(h.items().at(-1).message.length <= 80 && !h.items().at(-1).message.includes('\n'))
}
console.log('Notify passed: status text, same-id update, flash/status coexistence, end and restart')
