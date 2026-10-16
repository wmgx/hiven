import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = readFileSync('src/workspace/quickEditor/quickEditorPaneWriteHandoff.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const listeners = new Map()
const timers = new Map()
const packets = []
let uuid = 0
let timerId = 0
let now = 1_000
let heldRequest
let holdRequest = false
let dropReceipt = false

function eventApi(label) {
  const deliver = (name, payload, target) => {
    packets.push({ name, payload, target })
    if (holdRequest && name === 'hiven://quick-editor-pane-write-request') {
      heldRequest = { name, payload, target }
      return Promise.resolve()
    }
    if (dropReceipt && name === 'hiven://quick-editor-pane-write-reply' && !payload.ready) return Promise.resolve()
    for (const entry of [...(listeners.get(name) ?? [])]) {
      if (!target || entry.label === target) entry.fn({ payload })
    }
    return Promise.resolve()
  }
  return {
    listen: async (name, fn) => {
      const entry = { label, fn }
      const set = listeners.get(name) ?? new Set()
      set.add(entry)
      listeners.set(name, set)
      return () => set.delete(entry)
    },
    emit: (name, payload) => deliver(name, payload),
    emitTo: (target, name, payload) => deliver(name, payload, target),
  }
}

function handoff(label) {
  const exports = {}
  const events = eventApi(label)
  vm.runInNewContext(compiled, {
    exports,
    require: (id) => {
      assert.equal(id, '@tauri-apps/api/event')
      return events
    },
    crypto: { randomUUID: () => `id-${++uuid}` },
    Date: { now: () => now },
    Number,
    Map,
    Promise,
    Error,
    AbortController,
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId },
    clearTimeout: (id) => timers.delete(id),
  })
  return exports
}

const flush = async () => { for (let index = 0; index < 40; index += 1) await Promise.resolve() }
const expireTimers = () => { for (const fn of [...timers.values()]) fn() }
const caller = handoff('plugin-surface:text-diff')
const receiver = handoff('quick-editor')
const sender = { paneText: 'stale sender', history: ['sender history'] }
const destination = { paneText: 'live detached draft', revision: 7, history: ['version A', 'version B'] }
let commits = 0
const destinationReceiver = () => ({
  getRevision: (paneId) => paneId === 'pane-1' ? destination.revision : undefined,
  commit: ({ paneId, text, expectedRevision }) => {
    if (paneId !== 'pane-1' || expectedRevision !== destination.revision) return undefined
    commits += 1
    destination.paneText = text
    destination.revision += 1
    return destination.revision
  },
})
let stop = await receiver.listenForQuickEditorPaneWrites(destinationReceiver())

const firstReceipt = await caller.requestQuickEditorPaneWrite({ paneId: 'pane-1', text: 'Text Diff writeback', expectedRevision: 7 }, 'quick-editor')
assert.equal(firstReceipt.updated, true)
assert.equal(firstReceipt.revision, 8)
assert.equal(commits, 1)
assert.equal(destination.paneText, 'Text Diff writeback')
assert.deepEqual(destination.history, ['version A', 'version B'], 'Owner write preserves destination history')
assert.equal(sender.paneText, 'stale sender', 'Sender store is never mutated before owner acknowledgement')
assert.deepEqual(sender.history, ['sender history'])

const delivered = packets.find((packet) => packet.name === 'hiven://quick-editor-pane-write-request')
await eventApi('plugin-surface:text-diff').emitTo('quick-editor', delivered.name, delivered.payload)
assert.equal(commits, 1, 'Duplicate delivery replays a receipt without applying twice')

{
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    caller.requestQuickEditorPaneWrite({ paneId: 'pane-1', text: 'cancelled', expectedRevision: destination.revision }, 'quick-editor', { signal: controller.signal }),
    /QuickEditorPaneWriteFailed/,
  )
  assert.equal(commits, 1, 'Cancellation before delivery leaves the owner unchanged')
}

{
  const controller = new AbortController()
  let commitPoints = 0
  const result = await caller.requestQuickEditorPaneWrite({ paneId: 'pane-1', text: 'commit boundary', expectedRevision: destination.revision }, 'quick-editor', {
    signal: controller.signal,
    onCommit: () => { commitPoints += 1; controller.abort() },
  })
  assert.equal(result.updated, true)
  assert.equal(commitPoints, 1)
  assert.equal(commits, 2, 'Cancellation after the delivery boundary cannot report a half-write')
}

assert.equal(
  (await caller.requestQuickEditorPaneWrite({ paneId: 'missing-pane', text: 'no target', expectedRevision: 0 }, 'quick-editor')).updated,
  false,
  'A receiver rejection is not reported as success',
)
assert.equal(commits, 2)

const beforeStaleRevision = destination.revision
destination.paneText = 'newer Quick Editor edit'
destination.revision += 1
assert.equal(
  (await caller.requestQuickEditorPaneWrite({ paneId: 'pane-1', text: 'older delayed Diff input', expectedRevision: beforeStaleRevision }, 'quick-editor')).updated,
  false,
  'A write captured before a Quick Editor edit cannot overwrite the newer revision',
)
assert.equal(destination.paneText, 'newer Quick Editor edit')
assert.equal(commits, 2)

holdRequest = true
const changedAfterReady = caller.requestQuickEditorPaneWrite({
  paneId: 'pane-1',
  text: 'write captured before restore',
  expectedRevision: destination.revision,
}, 'quick-editor')
await flush()
const beforeRestoreRequest = heldRequest
destination.paneText = 'restored while request was in flight'
destination.revision += 1
holdRequest = false
await eventApi('plugin-surface:text-diff').emitTo(beforeRestoreRequest.target, beforeRestoreRequest.name, beforeRestoreRequest.payload)
assert.equal((await changedAfterReady).updated, false, 'Receiver must recheck revision atomically at delivery')
assert.equal(destination.paneText, 'restored while request was in flight')
assert.equal(commits, 2)

for (let index = 0; index < 70; index += 1) {
  const receipt = await caller.requestQuickEditorPaneWrite({
    paneId: 'pane-1',
    text: `rapid input ${index}`,
    expectedRevision: destination.revision,
  }, 'quick-editor')
  assert.equal(receipt.updated, true, `settled receipt ${index} was incorrectly rejected`)
}
assert.equal(commits, 72, 'Settled receipts cannot exhaust the 64 in-flight safety bound')

holdRequest = true
const switched = caller.requestQuickEditorPaneWrite({ paneId: 'pane-1', text: 'stale owner write', expectedRevision: destination.revision }, 'quick-editor')
const switchedReject = assert.rejects(switched, /QuickEditorPaneWriteFailed/)
await flush()
assert.ok(heldRequest, 'The request reached the old owner delivery boundary')
stop()
stop = await receiver.listenForQuickEditorPaneWrites(destinationReceiver())
holdRequest = false
await eventApi('plugin-surface:text-diff').emitTo(heldRequest.target, heldRequest.name, heldRequest.payload)
now += 4_001
expireTimers()
await switchedReject
assert.equal(commits, 72, 'A request bound to an old receiver generation cannot reach its replacement')
assert.notEqual(destination.paneText, 'stale owner write')

dropReceipt = true
const lostAck = caller.requestQuickEditorPaneWrite({ paneId: 'pane-1', text: 'committed once, ack lost', expectedRevision: destination.revision }, 'quick-editor')
const lostAckReject = assert.rejects(lostAck, /QuickEditorPaneWriteFailed/)
await flush()
now += 4_001
expireTimers()
await lostAckReject
assert.equal(commits, 73, 'A lost acknowledgement does not trigger blind redelivery')
assert.equal(destination.paneText, 'committed once, ack lost')
dropReceipt = false
stop()

const requestSource = readFileSync('src/workspace/quickEditor/quickEditorRequests.ts', 'utf8')
const quickEditorPanelSource = readFileSync('src/components/quickEditor/QuickEditorPanel.tsx', 'utf8')
const paneWriteFunction = requestSource.slice(
  requestSource.indexOf('async function deliverNativePaneWrite'),
  requestSource.indexOf('/**\n * Overwrite active Quick Editor content'),
)
assert.doesNotMatch(paneWriteFunction, /QUICK_EDITOR_SET_PANE_TEXT_EVENT/, 'Legacy blind broadcast must stay removed')
assert.match(paneWriteFunction, /throwOnError:\s*true/, 'A failed detached probe must fail closed')
assert.match(paneWriteFunction, /paneWriteQueues/, 'Pane writes must be serialized per pane')
assert.match(paneWriteFunction, /readDurablePane/, 'Each queued write must carry its input-time durable revision')
assert.match(paneWriteFunction, /persist\.rehydrate\(\)/, 'The non-native inline writer must rehydrate before local mutation')
assert.match(paneWriteFunction, /LAUNCHER_WINDOW_LABEL/, 'A plugin surface must target the launcher owner')
assert.match(
  quickEditorPanelSource,
  /getRevision:[\s\S]*pane\.revision \?\? 0/,
  'The owner must normalize a legacy pane without a revision to revision zero',
)

const requestsCompiled = ts.transpileModule(requestSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function createRequestsHarness() {
  let durable = { revision: 20, text: 'durable base' }
  let probeFailure = false
  let localWrites = 0
  let activeRequests = 0
  let maxActiveRequests = 0
  const requests = []
  const storage = {
    getItem: (key) => key === 'hiven-quick-editor' ? JSON.stringify({
      state: { panes: { 'pane-1': { revision: durable.revision, text: durable.text } } },
    }) : null,
  }
  const quickStore = Object.assign(() => undefined, {
    getState: () => ({
      setPaneText: () => { localWrites += 1; return true },
    }),
    persist: { rehydrate: () => Promise.resolve() },
  })
  const requestPaneWrite = (input, target, lifecycle) => new Promise((resolve, reject) => {
    let settled = false
    let committed = false
    activeRequests += 1
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      activeRequests -= 1
      lifecycle?.signal?.removeEventListener('abort', abort)
      callback(value)
    }
    const abort = () => { if (!committed) finish(reject, new Error('QuickEditorPaneWriteFailed')) }
    lifecycle?.signal?.addEventListener('abort', abort, { once: true })
    requests.push({
      input,
      target,
      get settled() { return settled },
      markCommitted: () => { committed = true; lifecycle?.onCommit?.() },
      resolve: (receipt) => finish(resolve, receipt),
    })
  })
  const exports = {}
  vm.runInNewContext(requestsCompiled, {
    exports,
    require: (id) => {
      if (id === '../../store') return { useAppStore: { getState: () => ({ locale: 'en', openLauncherHostSurface: () => undefined }) } }
      if (id === '../../i18n') return { pickLocale: (_locale, _zh, en) => en, translate: () => 'failed' }
      if (id === '../toast') return { showToast: () => undefined }
      if (id === './quickEditorStore') return { useQuickEditorStore: quickStore }
      if (id === '../windowManager/quickEditorWindow') return {
        isQuickEditorDetachedWindow: () => false,
        isQuickEditorWindowOpen: async (options) => {
          assert.equal(options?.throwOnError, true)
          if (probeFailure) throw new Error('SyntheticProbeFailure')
          return true
        },
        QUICK_EDITOR_WINDOW_LABEL: 'quick-editor',
        showQuickEditorWindow: async () => undefined,
      }
      if (id === '../windowManager/windowLabels') return { LAUNCHER_WINDOW_LABEL: 'launcher' }
      if (id === '../launcherHostSurfaceBridge') return { requestOpenLauncherHostSurface: async () => undefined }
      if (id === '../webNativeBridge') return { isNativeDesktopRuntime: () => true }
      if (id === './quickEditorOverwriteHandoff') return { requestQuickEditorOverwrite: async () => ({ paneId: 'pane-1', historyCount: 0 }) }
      if (id === './quickEditorPaneWriteHandoff') return { requestQuickEditorPaneWrite: requestPaneWrite }
      throw new Error(`unexpected require: ${id}`)
    },
    localStorage: storage,
    window: { location: { search: '?window=plugin-surface' } },
    URLSearchParams,
    console,
    Map,
    Promise,
    Error,
    Number,
    JSON,
    setTimeout,
    clearTimeout,
  })
  return {
    api: exports,
    requests,
    active: () => requests.filter((request) => !request.settled),
    durable: () => durable,
    setDurable: (next) => { durable = next },
    setProbeFailure: (value) => { probeFailure = value },
    localWrites: () => localWrites,
    maxActive: () => maxActiveRequests,
  }
}

{
  const harness = createRequestsHarness()
  const firstController = new AbortController()
  const first = harness.api.setQuickEditorPaneText('pane-1', 'A', { signal: firstController.signal })
  await flush()
  assert.equal(harness.active().length, 1)
  firstController.abort()
  const latest = harness.api.setQuickEditorPaneText('pane-1', 'AB')
  assert.equal(await first, false, 'A superseded pre-commit write must not report success')
  await flush()
  assert.equal(harness.active().length, 1)
  assert.equal(harness.active()[0].input.text, 'AB')
  assert.equal(harness.active()[0].input.expectedRevision, 20)
  harness.setDurable({ revision: 21, text: 'AB' })
  harness.active()[0].resolve({ updated: true, revision: 21 })
  assert.equal(await latest, true)
  assert.equal(harness.maxActive(), 1, 'Per-pane delivery must remain serialized')
  assert.equal(harness.localWrites(), 0, 'A native sender must never mutate its own store')
}

{
  const harness = createRequestsHarness()
  const firstController = new AbortController()
  const first = harness.api.setQuickEditorPaneText('pane-1', 'committed A', { signal: firstController.signal })
  await flush()
  const firstRequest = harness.active()[0]
  firstRequest.markCommitted()
  firstController.abort()
  const latest = harness.api.setQuickEditorPaneText('pane-1', 'latest AB')
  await flush()
  assert.equal(harness.active().length, 1, 'A committed request must settle before the next starts')
  harness.setDurable({ revision: 21, text: 'committed A' })
  firstRequest.resolve({ updated: true, revision: 21 })
  assert.equal(await first, true)
  await flush()
  const latestRequest = harness.active()[0]
  assert.equal(latestRequest.input.expectedRevision, 21, 'Queued latest input must advance only from the acknowledged durable head')
  harness.setDurable({ revision: 22, text: 'latest AB' })
  latestRequest.resolve({ updated: true, revision: 22 })
  assert.equal(await latest, true)
  assert.equal(harness.maxActive(), 1)
}

{
  const harness = createRequestsHarness()
  harness.setDurable({ revision: undefined, text: 'legacy durable base' })
  const write = harness.api.setQuickEditorPaneText('pane-1', 'legacy updated')
  await flush()
  const request = harness.active()[0]
  assert.equal(request.input.expectedRevision, 0, 'A legacy durable pane without a revision must start at revision zero')
  harness.setDurable({ revision: 1, text: 'legacy updated' })
  request.resolve({ updated: true, revision: 1 })
  assert.equal(await write, true)
  assert.equal(harness.localWrites(), 0)
}

{
  const harness = createRequestsHarness()
  harness.setProbeFailure(true)
  assert.equal(await harness.api.setQuickEditorPaneText('pane-1', 'must fail closed'), false)
  assert.equal(harness.requests.length, 0)
  assert.equal(harness.localWrites(), 0, 'Probe failure must not fall back to sender-local mutation')
}

console.log('PASS Quick Editor pane-write owner: targeted revision ack, sender isolation, serialized/coalesced product calls, cancellation, stale rejection, 64+ settled writes, idempotence, owner rotation, lost ack, and fail-closed probing')
