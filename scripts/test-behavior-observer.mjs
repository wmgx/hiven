import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const timers = new Map()
let timerId = 0
const fixedNow = new Date('2026-09-07T10:00:00+08:00').getTime()
let currentNow = fixedNow
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [currentNow])) } static now() { return currentNow } }
const compiled = ts.transpileModule(readFileSync('src/observation/observer.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const flush = () => new Promise(setImmediate)
function runtime(capture, legacy = {}, encode, keyboardPoll = async () => ({ status: 'recording', events: [] })) {
  const exports = {}
  const records = new Map()
  const blobs = new Map()
  const blobWrites = []
  const encoders = []
  const keyboardCommands = []
  let sequence = 0
  const encodeFrame = encode ?? (async (_pixels, keyFrame) => ({
    bytes: new Uint8Array([1, 2, 3]), codec: 'avc1.640033', width: 2, height: 2,
    type: keyFrame ? 'key' : 'delta', timestamp: sequence++ * 33333,
  }))
  const subscribers = new Set()
  let native = true
  let state = { settings: {}, locale: 'en', updateSetting: (key, value) => {
    const previous = state
    state = { ...state, settings: { ...state.settings, [key]: value } }
    subscribers.forEach((fn) => fn(state, previous))
  } }
  const storage = {
    kv: { get: async (key) => structuredClone(records.get(key)), set: async (key, value) => records.set(key, structuredClone(value)) },
    blob: {
      put: async ({ bytes, contentType, extension }) => {
        const blobId = `blob-${blobWrites.length + 1}`
        blobs.set(blobId, bytes)
        blobWrites.push({ blobId, contentType, extension, bytes })
        return { blobId }
      },
      delete: async (id) => blobs.delete(id),
    },
  }
  const modules = {
    '@tauri-apps/api/core': { invoke: async (command, { options } = {}) => {
      if (command === 'poll_keyboard_observation') { keyboardCommands.push(command); return keyboardPoll(options) }
      if (command === 'stop_keyboard_observation') { keyboardCommands.push(command); return }
      assert.equal(command, 'capture_desktop_snapshot'); return capture(options)
    } },
    '../workspace/pluginStorage': { createPluginPrivateStorage: (source, id) => { assert.equal(source, 'builtin'); assert.equal(id, 'behavior-observer'); return storage } },
    '../workspace/webNativeBridge': { isNativeDesktopRuntime: () => native },
    '../workspace/toast': { showToast: () => {} },
    './video': {
      MAX_VIDEO_FRAMES: 10,
      ObservationVideoEncoder: class {
        closed = false
        constructor() { encoders.push(this) }
        async encode(pixels, keyFrame) { return encodeFrame(pixels, keyFrame) }
        close() { this.closed = true }
      },
    },
    '../i18n': { translate: (_, ns, key) => `${ns}.${key}` },
    '../store': { useAppStore: { getState: () => state, subscribe: (fn) => { subscribers.add(fn); return () => subscribers.delete(fn) } } },
  }
  vm.runInNewContext(compiled, {
    exports, require: (name) => { assert.ok(modules[name], name); return modules[name] },
    localStorage: { getItem: (key) => legacy[key] ?? null }, Date: Clock, TextEncoder, Uint8Array,
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId }, clearTimeout: (id) => timers.delete(id),
  })
  return { ...exports, records, blobs, blobWrites, encoders, keyboardCommands, state: () => state, setNative: (value) => { native = value } }
}

// Main path: host defaults off, records locally when enabled, stops on setting change.
let calls = 0
const sample = { capturedAt: fixedNow, appName: 'Test', idleSeconds: 0, imageBytes: [1, 2, 3], text: 'synthetic' }
const key = { at: fixedNow, appName: 'Test', keyCode: 8, key: 'c', modifiers: ['Meta'], repeat: false }
let keyboardPolls = 0
const ctx = runtime(async () => { calls++; return { ...sample, capturedAt: currentNow } }, {}, undefined, async ({ endsAt, excludedApps }) => {
  assert.ok(endsAt > currentNow)
  assert.ok(excludedApps.includes('1Password'))
  return { status: 'recording', events: keyboardPolls++ === 0 ? [key] : [] }
})
assert.equal(ctx.defaults.enabled, false)
assert.equal(ctx.defaults.keyboardEnabled, false)
assert.equal(new Date(ctx.observationDeadline(fixedNow)).getDay(), 6)
const stop = ctx.startBehaviorObservation()
await flush()
assert.equal(calls, 0)
ctx.state().updateSetting('behaviorObservation', { ...ctx.defaults, enabled: true, keyboardEnabled: true })
await flush()
assert.equal(ctx.records.get('observation-state').count, 1)
assert.equal(ctx.records.get(`sample:${fixedNow}`).text, 'synthetic')
assert.equal(ctx.blobs.size, 1)
assert.deepEqual(ctx.records.get(`keys:${fixedNow}:${fixedNow}`).events, [key])
assert.equal(ctx.records.get('observation-state').keyboard.count, 1)
assert.deepEqual(JSON.parse(JSON.stringify(ctx.blobWrites)), [{
  blobId: 'blob-1', contentType: 'video/h264', extension: 'h264', bytes: { 0: 1, 1: 2, 2: 3 },
}])
assert.deepEqual(JSON.parse(JSON.stringify(ctx.records.get(`sample:${fixedNow}`).video)), {
  codec: 'avc1.640033', width: 2, height: 2,
  frames: [{ blobId: 'blob-1', type: 'key', timestamp: 0 }],
})
currentNow += 30_000
const nextTimerId = Math.max(...timers.keys())
const nextTimer = timers.get(nextTimerId)
timers.delete(nextTimerId)
nextTimer()
await flush()
assert.deepEqual(JSON.parse(JSON.stringify(ctx.records.get(`sample:${currentNow}`).video)), {
  codec: 'avc1.640033', width: 2, height: 2,
  frames: [
    { blobId: 'blob-1', type: 'key', timestamp: 0 },
    { blobId: 'blob-2', type: 'delta', timestamp: 33333 },
  ],
})
ctx.state().updateSetting('behaviorObservation', ctx.defaults)
await flush()
assert.equal(timers.size, 0)
assert.equal(calls, 4)
assert.ok(ctx.keyboardCommands.includes('stop_keyboard_observation'))
stop()
ctx.setNative(false)
ctx.state().updateSetting('behaviorObservation', { ...ctx.defaults, enabled: true })
ctx.startBehaviorObservation()()
await flush()
assert.equal(calls, 4, 'browser cannot start the host recorder')

// Critical failure: migrate an enabled prototype, then disable while compression is in-flight; retain old data only.
let finishEncode
const pending = runtime(async () => sample, {
  'hiven-plugin-settings': JSON.stringify({ state: { pluginSettings: { builtin: { 'behavior-observer': { value: { enabled: true, intervalSeconds: 60, excludedApps: 'Private App' } } } } } }),
  'hiven-plugin-permissions': JSON.stringify({ state: { permissions: { builtin: { 'behavior-observer': { 'screen.capture': { granted: true } } } } } }),
}, async () => new Promise((resolve) => { finishEncode = resolve }))
const existing = { count: 17, bytes: 700, startedAt: fixedNow - 60000, endsAt: fixedNow + 60000, recent: [], status: 'idle', updatedAt: fixedNow - 5000 }
pending.records.set('observation-state', existing)
const cancel = pending.startBehaviorObservation()
await flush()
assert.deepEqual(JSON.parse(JSON.stringify(pending.state().settings.behaviorObservation)), { enabled: true, intervalSeconds: 60, excludedApps: 'Private App' })
assert.ok(finishEncode)
pending.state().updateSetting('behaviorObservation', pending.defaults)
finishEncode({ bytes: new Uint8Array([9]), codec: 'avc1.640033', width: 2, height: 2, type: 'key', timestamp: 0 })
await flush()
cancel()
assert.equal(pending.blobs.size, 0)
assert.equal(pending.records.size, 1)
assert.deepEqual(pending.records.get('observation-state'), existing)
assert.equal(pending.encoders[0].closed, true)
assert.equal(timers.size, 0)

// New critical failure: a native poll finishing after disable cannot persist buffered keys.
let finishPoll
const late = runtime(async () => sample, {}, undefined, async () => new Promise(resolve => { finishPoll = resolve }))
late.records.set('observation-state', existing)
const stopLate = late.startObservation({ ...late.defaults, enabled: true, keyboardEnabled: true })
await flush()
assert.ok(finishPoll)
const stoppedLate = stopLate()
finishPoll({ status: 'recording', events: [key] })
await stoppedLate
assert.deepEqual(late.records.get('observation-state'), existing)
assert.equal(late.records.size, 1)
assert.equal(late.blobs.size, 0)
assert.equal(late.keyboardCommands.filter(command => command === 'stop_keyboard_observation').length, 2)
assert.equal(timers.size, 0)

const messages = {}
vm.runInNewContext(ts.transpileModule(readFileSync('src/i18n/locales/observation.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: messages })
const { zh, en } = messages.default
assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
console.log('host observation: video + local keyboard batches, browser guard, migration and in-flight stop OK')
