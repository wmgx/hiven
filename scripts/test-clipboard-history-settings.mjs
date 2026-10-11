#!/usr/bin/env node
// Production settings migration and background lifecycle; synthetic private data only.
import assert from 'node:assert/strict'
import { setImmediate as tick } from 'node:timers/promises'
import { historyModule, syntheticHistoryStorage } from './lib/history-synthetic-storage.mjs'
const { DEFAULT_CLIPBOARD_HISTORY_SETTINGS: defaults, resolveClipboardHistoryRetentionMonths: resolve, migrateClipboardHistorySettings: migrate } = await import(historyModule('src/plugins/clipboard-history/settings/model.ts'))
const { createClipboardHistoryRepository: createRepo } = await import(historyModule('src/plugins/clipboard-history/storage/clipboardHistoryRepository.ts'))
const { createClipboardHistoryBackground: createBackground } = await import(historyModule('src/plugins/clipboard-history/background/clipboardHistoryBackground.ts'))
assert.equal(defaults.retentionMonths, 3)
assert.equal(defaults.enabled, false)
for (const retired of ['maxItems', 'retentionDays', 'maxTotalCacheBytes']) assert.equal(defaults[retired], undefined)
for (const valid of [1, 3, 12]) assert.equal(resolve(valid), valid)
for (const invalid of [0, 13, 1.5, '3', NaN, undefined]) assert.equal(resolve(invalid), 3)
const legacy = { enabled: true, maxItems: 1, retentionDays: 1, maxTotalCacheBytes: 1 }
const changed = migrate(legacy)
assert.equal(changed.retentionMonths, 3)
assert.equal(changed.enabled, true)
assert.equal(changed.maxItems, 1, 'old values remain inert migration evidence')
assert.equal(legacy.retentionMonths, undefined, 'migration must not mutate its source')

const original = { now: Date.now, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, window: globalThis.window }
let now = Date.parse('2026-01-01T12:00:00Z')
Date.now = () => now
const timers = new Map()
const listeners = new Map()
let timerId = 0
let watcherCalls = 0
let watcherStop = 0
let changeHandler
let watchOptions
const messages = []
globalThis.setInterval = (fn, milliseconds) => { assert.equal(milliseconds, 60_000); timers.set(++timerId, fn); return timerId }
globalThis.clearInterval = (id) => timers.delete(id)
globalThis.window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name) } }
const memory = syntheticHistoryStorage()
const repo = createRepo(memory.storage)
const context = (settings) => ({ settings, storage: memory.storage, t: (key) => key, showMessage: (...args) => messages.push(args), clipboard: { watch: async (options, callback) => { watcherCalls++; watchOptions = options; changeHandler = callback; return () => { watcherStop++ } } } })
async function until(check) {
  for (let tries = 0; tries < 100; tries++) { if (await check()) return; await tick() }
  assert.fail('background operation did not complete')
}
try {
  const old = await repo.addItem({ kind: 'text', text: 'synthetic startup cleanup', hash: 'startup', byteSize: 25 })
  now = Date.parse('2026-03-02T12:00:00Z')
  const stopDisabled = await createBackground().start(context({ ...defaults, enabled: false, retentionMonths: 1 }))
  assert.equal(typeof stopDisabled, 'function')
  assert.equal(watcherCalls, 0, 'recording disabled never starts clipboard watching')
  await until(async () => (await repo.getRetentionStatus()).trashCount === 1)
  assert.equal(await repo.getItem(old.id), undefined)
  assert.ok(await repo.getTrashItem(old.id), 'startup policy still runs while recording is disabled')
  now += 31 * 86400000
  for (const callback of timers.values()) callback()
  await until(async () => !await repo.getTrashItem(old.id))
  assert.equal((await repo.getRetentionStatus()).trashCount, 0, 'periodic retention permanently expires trash without new clipboard events')
  stopDisabled()
  assert.equal(timers.size, 0)
  assert.equal(listeners.size, 0)

  const stopEnabled = await createBackground().start(context({ ...defaults, enabled: true, recordText: true, recordImages: false, recordFiles: false }))
  assert.equal(watcherCalls, 1)
  assert.equal(watchOptions.images, false)
  assert.equal(watchOptions.files, false)
  await changeHandler({ kind: 'files', paths: ['/synthetic/ignored'], fileNames: ['ignored'], hash: 'ignored' })
  assert.equal((await repo.getPage()).items.length, 0)
  await changeHandler({ kind: 'text', text: 'synthetic accepted text', hash: 'accepted', byteSize: 23 })
  assert.equal((await repo.getPage()).items.length, 1)
  stopEnabled()
  assert.equal(watcherStop, 1)
  assert.equal(timers.size, 0)
  assert.equal(listeners.size, 0)
  assert.deepEqual(messages, [])
  console.log('History settings and production background: safe migration, disabled recording with retention, periodic expiry, watch filters, and lifecycle stop passed')
} finally {
  Date.now = original.now
  globalThis.setInterval = original.setInterval
  globalThis.clearInterval = original.clearInterval
  if (original.window === undefined) delete globalThis.window
  else globalThis.window = original.window
}
