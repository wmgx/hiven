import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Actual composition and queue state machine; no native clipboard or API calls.
const flush = async () => { for (let i = 0; i < 35; i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }
function fixture(recordingEnabled = true) {
  const listeners = new Map(), requests = new Map(), timers = new Map(), calls = [], notices = [], subscriptions = []
  let uuid = 0, timerId = 0, allowed = true, handler, releaseCount = 0
  const h = { calls, notices, beginGate: null, pasteGate: null, failPaste: false }
  const subscribe = (fn) => { subscriptions.push(fn); return () => {} }
  const emit = (name, payload) => { for (const fn of [...(listeners.get(name) ?? [])]) fn({ payload }) }
  let definition = { settings: {} }
  const modules = {
    './hotkeys/pluginSurfaceShortcuts': { acquireSurfaceShortcutInterceptor: async (_target, accelerator, handle) => {
      assert.equal(accelerator, 'Control+Shift+V'); handler = handle
      return async () => { releaseCount++; handler = undefined }
    } },
    './hotkeys/pageReload': { registerHotkeyReloadParticipant: () => () => {} },
    './workspace/pluginRegistry': { pluginRegistry: {
      getAllPluginDefinitions: () => [{ pluginId: 'clipboard-history', source: 'production', definition }],
      getPluginDefinition: () => definition,
      getPluginPermissions: () => ['clipboard.write', 'accessibility.paste', 'globalShortcut.register'], subscribe,
    } },
    './workspace/pluginPermissions': {
      getPluginPermissionSnapshot: () => ({}), missingPluginPermissions: () => allowed ? [] : ['clipboard.write'],
      usePluginPermissionStore: { subscribe },
    },
    './workspace/pluginSurfaceShortcuts': { usePluginSurfaceShortcutStore: { subscribe: () => () => {} } },
    './workspace/pluginSettingsStore': { resolvePluginSettings: () => ({ value: { enabled: recordingEnabled } }), usePluginSettingsStore: { subscribe } },
    './workspace/bundledPluginIdentity': { isCurrentBundledDefinition: () => true },
    '@tauri-apps/api/event': { listen: async (name, fn) => {
      const set = listeners.get(name) ?? new Set(); set.add(fn); listeners.set(name, set)
      return () => set.delete(fn)
    } },
    '@tauri-apps/api/core': { invoke: async (command, args) => {
      calls.push({ command, args })
      if (command === 'history_queue_request') { requests.set(args.id, { ...args, items: args.items ?? [] }); emit('hiven://history-queue-request', args.id) }
      else if (command === 'history_queue_take') { const request = requests.get(args.id); requests.delete(args.id); return request }
      else if (command === 'history_queue_reply') { if (h.replyGate) await h.replyGate.promise; emit('hiven://history-queue-reply', args) }
      else if (command === 'history_queue_publish') emit('hiven://history-queue-status', args.status)
      else if (command === 'get_history_queue_availability') return h.availabilityGate ? h.availabilityGate.promise : (h.availability ?? 'can-attempt')
      else if (command === 'begin_history_queue_paste') return h.beginGate ? h.beginGate.promise : 'attempt'
      else if (command === 'paste_history_queue_text') { if (h.pasteGate) await h.pasteGate.promise; if (h.failPaste) throw new Error('synthetic failure') }
      else if (command !== 'cancel_paste_attempt') throw new Error(`Unexpected command ${command}`)
    } },
  }
  function load(file) {
    const exports = {}
    const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    vm.runInNewContext(code, {
      exports, module: { exports }, console, TextEncoder, AbortController, URLSearchParams, Error,
      window: { __TAURI_INTERNALS__: {}, location: { search: '?window=launcher' } },
      crypto: { randomUUID: () => `request-${++uuid}` },
      setTimeout: (fn) => { timers.set(++timerId, fn); return timerId }, clearTimeout: (id) => timers.delete(id),
      require: (id) => { assert.ok(Object.hasOwn(modules, id), `Unexpected dependency ${id}`); return modules[id] },
    })
    return exports
  }
  modules['./plugins/clipboard-history/queue/clipboardPasteQueue'] = load('src/plugins/clipboard-history/queue/clipboardPasteQueue.ts')
  const api = load('src/historyPasteQueueHandoff.ts')
  h.stop = api.installHistoryPasteQueueHost({ notify: (status, outcome) => notices.push({ status, outcome }) })
  h.createBridge = (owner = { isCurrent: () => true }) => api.createHistoryPasteQueueBridge({ source: 'builtin', pluginId: 'clipboard-history', ...owner })
  h.bridge = h.createBridge()
  h.next = () => handler?.()
  h.setRecording = (value) => { recordingEnabled = value; subscriptions.forEach((fn) => fn()) }
  h.revoke = () => { allowed = false; subscriptions.forEach((fn) => fn()) }
  // Even a newly trusted bundled definition cannot inherit an old queue.
  h.replaceDefinition = () => { definition = { settings: {} }; subscriptions.forEach((fn) => fn()) }
  h.expire = () => { for (const fn of [...timers.values()]) fn() }
  h.releaseCount = () => releaseCount
  return h
}
const original = [{ id: 'a', text: '完整\r\n  synthetic A\n' }, { id: 'b', text: 'synthetic B' }]
{
  const h = fixture(false); await flush()
  assert.equal((await h.bridge.getStatus()).phase, 'idle', 'Paused recording must not reject queue status')
  await h.bridge.start(original)
  assert.equal((await h.bridge.getStatus()).remaining, 2, 'Explicit existing-history queue is usable while capture is paused')
  h.setRecording(true); h.setRecording(false); await flush()
  assert.equal((await h.bridge.getStatus()).phase, 'ready', 'Recording toggles do not cancel explicitly queued snapshots')
  await h.bridge.cancel()
  assert.equal((await h.bridge.getStatus()).phase, 'cancelled')
  assert.equal(h.calls.some(({ command }) => command === 'paste_history_queue_text'), false, 'Status/start/cancel do not paste')
  h.revoke(); await flush()
  await assert.rejects(h.bridge.getStatus(), /QueueUnavailableError/, 'Paused recording does not bypass permission revocation')
  h.stop()
}
{
  const h = fixture(); await flush()
  await h.bridge.start(original)
  assert.equal(h.calls.filter(({ command }) => command === 'paste_history_queue_text').length, 0, 'Start cannot paste')
  h.failPaste = true
  await h.next()
  assert.equal((await h.bridge.getStatus()).completed, 0, 'Failure retains current snapshot')
  h.failPaste = false
  await h.next(); await h.next(); await flush()
  assert.deepEqual(h.calls.filter(({ command }) => command === 'paste_history_queue_text').map(({ args }) => args.text), [original[0].text, original[0].text, original[1].text])
  assert.equal((await h.bridge.getStatus()).phase, 'completed')
  assert.equal(h.releaseCount(), 1)
  assert.equal(JSON.stringify(h.calls.filter(({ command }) => command === 'history_queue_publish')).includes('synthetic'), false, 'Published status never carries bodies')
  h.stop()
}
{
  const h = fixture(); await flush(); await h.bridge.start(original)
  const gate = deferred(); h.beginGate = gate
  const old = h.next(); await flush()
  await h.bridge.cancel()
  gate.resolve('late-attempt'); await old; await flush()
  assert.equal(h.calls.some(({ command }) => command === 'paste_history_queue_text'), false, 'Cancellation while acquiring lease prevents write')
  assert.ok(h.calls.some(({ command, args }) => command === 'cancel_paste_attempt' && args.attemptId === 'late-attempt'))
  assert.equal(h.notices.some(({ outcome }) => outcome === 'delivered'), false)
  h.stop()
}
{
  const h = fixture(); await flush(); await h.bridge.start(original)
  const gate = deferred(); h.pasteGate = gate
  const old = h.next(); await flush()
  await h.bridge.start([{ id: 'new', text: 'replacement' }])
  await h.next()
  assert.equal(h.calls.filter(({ command }) => command === 'paste_history_queue_text').length, 1, 'Replacement cannot overlap unsettled old native write')
  gate.resolve(); await old; h.pasteGate = null
  await h.next()
  assert.equal((await h.bridge.getStatus()).completed, 1)
  assert.equal(h.calls.filter(({ command }) => command === 'paste_history_queue_text').at(-1).args.text, 'replacement')
  assert.equal(h.notices.filter(({ outcome }) => outcome === 'delivered').length, 1, 'Old success cannot advance or notify replacement')
  h.stop()
}
{
  const h = fixture(); await flush(); await h.bridge.start(original)
  h.revoke(); await flush()
  await h.next()
  assert.equal(h.calls.some(({ command }) => command === 'begin_history_queue_paste'), false, 'Permission revocation retires hidden shortcut delivery')
  assert.equal(h.releaseCount(), 1)
  h.stop()
}
{
  const h = fixture(); await flush(); await h.bridge.start(original)
  const gate = deferred(); h.beginGate = gate
  const old = h.next(); await flush()
  h.replaceDefinition(); await flush()
  gate.resolve('replaced-definition-attempt'); await old; await flush()
  assert.equal(h.calls.some(({ command }) => command === 'paste_history_queue_text'), false, 'Definition replacement invalidates an acquired late lease before any write')
  assert.ok(h.calls.some(({ command, args }) => command === 'cancel_paste_attempt' && args.attemptId === 'replaced-definition-attempt'))
  assert.equal((await h.bridge.getStatus()).phase, 'cancelled')
  assert.equal(h.releaseCount(), 1)
  assert.equal(h.notices.some(({ outcome }) => outcome === 'delivered'), false)
  h.stop()
}
{
  const h = fixture(); await flush()
  let current = true
  let invalidate = () => {}
  const old = h.createBridge({ isCurrent: () => current, subscribeInvalidation: (fn) => { invalidate = fn; return () => {} } })
  const gate = deferred(); h.replyGate = gate
  const pending = old.getStatus()
  const rejected = assert.rejects(pending, /QueueCancelledError/)
  await flush(); current = false; invalidate()
  await rejected
  h.replyGate = null
  assert.equal((await h.bridge.getStatus()).phase, 'idle', 'A replacement owner can read actual idle status')
  gate.resolve(); await flush()
  assert.equal((await h.bridge.getStatus()).phase, 'idle', 'Late old receipt cannot corrupt the replacement')
  h.stop()
}
{
  const h = fixture(); await flush()
  const gate = deferred(); h.replyGate = gate
  const read = h.bridge.getStatus()
  const rejected = assert.rejects(read, /QueueCancelledError/, 'A current owner timeout still rejects rather than reporting ready')
  await flush(); h.expire(); await rejected
  gate.resolve(); await flush(); h.stop()
}
{
  const h = fixture(); await flush(); h.revoke()
  await assert.rejects(h.bridge.getStatus(), /QueueUnavailableError/, 'A rejected status request must not masquerade as a successful idle read')
  h.stop()
}
{
  const h = fixture(); await flush()
  assert.equal(await h.bridge.getAvailability(), 'can-attempt')
  h.availability = 'unsupported'
  assert.equal(await h.bridge.getAvailability(), 'unsupported')
  await assert.rejects(h.bridge.start(original), /QueuePlatformUnavailableError/)
  assert.equal((await h.bridge.getStatus()).remaining, 0)
  assert.equal(h.calls.some(({ command }) => command === 'begin_history_queue_paste'), false)
  h.availability = 'unexpected-native-value'
  assert.equal(await h.bridge.getAvailability(), 'unknown')
  const foreign = h.createBridge({ source: 'installed' })
  await assert.rejects(foreign.getAvailability(), /QueueUnavailableError/)
  let current = true, invalidate = () => {}
  const old = h.createBridge({ isCurrent: () => current, subscribeInvalidation: (fn) => { invalidate = fn; return () => {} } })
  const gate = deferred(); h.availabilityGate = gate
  const pending = old.getAvailability()
  const rejected = assert.rejects(pending, /QueueCancelledError/)
  await flush(); current = false; invalidate(); await rejected
  gate.resolve('can-attempt'); await flush()
  h.availabilityGate = deferred()
  const timed = h.bridge.getAvailability(); await flush(); h.expire()
  assert.equal(await timed, 'unknown', 'Timeout must never authorize queue start')
  h.availabilityGate.resolve('can-attempt'); await flush()
  h.stop()
}
{
  const h = fixture(); await flush()
  const gate = deferred(); h.availabilityGate = gate
  const pending = h.bridge.start(original)
  const rejected = assert.rejects(pending, /QueueCancelledError|QueuePlatformUnavailableError/)
  await flush(); h.expire(); await rejected; await flush()
  h.availabilityGate = null
  await h.bridge.start(original)
  assert.equal((await h.bridge.getStatus()).remaining, 2, 'A timed-out preflight cannot block the next start lane')
  gate.resolve('can-attempt'); await flush()
  assert.equal((await h.bridge.getStatus()).remaining, 2)
  h.stop()
}
console.log('History queue handoff passed: explicit delivery, full snapshots, failure retry, cancellation, replacement fence and revocation')
