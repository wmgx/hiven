#!/usr/bin/env node
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { plain, settingsKey, settingsWindow, sharedSettingsStorage, settle } from './helpers/plugin-settings-fixture.mjs'

const record = (value) => ({ version: 1, value })

test('independent surface enables and disables the actual launcher background without echo or unrelated restart', async () => {
  const storage = sharedSettingsStorage()
  const launcher = settingsWindow(storage, { backgrounds: true })
  const surface = settingsWindow(storage)
  const grants = launcher.permissions.getPluginPermissionSnapshot('builtin', 'clipboard-history', launcher.manifest.permissions)
  assert.equal(launcher.permissions.missingPluginPermissions(grants, launcher.manifest.permissions).length, 0)
  launcher.manager.initializePluginBackgrounds()
  const stopSettings = launcher.manager.setupBackgroundSettingsWatcher()
  await settle()
  assert.equal(launcher.counts.starts, 1)
  assert.equal(launcher.counts.watches, 0)
  for (let cycle = 0; cycle < 2; cycle++) {
    await surface.setEnabled(true)
    const writes = storage.writes
    launcher.event()
    await settle()
    assert.equal(launcher.enabled(), true)
    assert.equal(launcher.counts.watches, cycle + 1)
    assert.equal(storage.writes, writes)
    launcher.event()
    await settle()
    assert.equal(launcher.counts.watches, cycle + 1, 'duplicate event must not restart')
    await launcher.copySyntheticText(`captured ${cycle}`)
    await surface.setEnabled(false)
    launcher.event()
    await settle()
    assert.equal(launcher.enabled(), false)
    assert.equal(launcher.counts.stops, cycle + 1)
    await launcher.copySyntheticText('must not capture')
  }
  assert.deepEqual(launcher.counts.captures, ['captured 0', 'captured 1'])
  assert.equal(launcher.counts.otherStarts, 1)
  stopSettings()
  await launcher.manager.stopAllPluginBackgrounds()
})

test('deleting settings or clearing storage restores disabled defaults and stops capture', async () => {
  for (const clear of [false, true]) {
    const storage = sharedSettingsStorage()
    const surface = settingsWindow(storage)
    await surface.setEnabled(true)
    const launcher = settingsWindow(storage, { backgrounds: true })
    launcher.manager.initializePluginBackgrounds()
    const stopSettings = launcher.manager.setupBackgroundSettingsWatcher()
    await settle()
    assert.equal(launcher.counts.watches, 1)
    if (clear) storage.clear()
    else await surface.store.getState().removePluginSettings('builtin', 'clipboard-history')
    launcher.event(clear ? null : settingsKey)
    await settle()
    assert.equal(launcher.enabled(), false)
    assert.equal(launcher.counts.stops, 1)
    stopSettings()
    await launcher.manager.stopAllPluginBackgrounds()
  }
})

test('delayed events read current storage; unrelated keys and other profiles cannot change settings', async () => {
  const storage = sharedSettingsStorage()
  const A = settingsWindow(storage)
  const B = settingsWindow(storage)
  await B.setEnabled(true)
  const oldValue = storage.getItem(settingsKey)
  await B.setEnabled(false)
  A.event('other-key')
  A.event(settingsKey, { storageArea: sharedSettingsStorage() })
  assert.equal(A.store.getState().getPluginSettings('builtin', 'clipboard-history'), undefined)
  A.event(settingsKey, { newValue: oldValue })
  assert.equal(A.enabled(), false)
  assert.ok(A.store.getState().getPluginSettings('builtin', 'clipboard-history'))
})

test('stale windows preserve other plugins and sources through writes, deletion and dialog dismissal', async () => {
  const storage = sharedSettingsStorage()
  const A = settingsWindow(storage)
  const B = settingsWindow(storage)
  await A.setEnabled(true)
  await B.store.getState().setPluginSettings('installed', 'clipboard-history', { enabled: false }, 1)
  await A.store.getState().setPluginSettings('dev', 'other', { marker: 1 }, 1)
  await B.store.getState().setPluginSettings('builtin', 'other', { marker: 2 }, 1)
  await A.store.getState().removePluginSettings('dev', 'other')
  B.store.getState().openSettingsDialog({ source: 'builtin', pluginId: 'other' })
  await A.setEnabled(false)
  B.store.getState().closeSettingsDialog()
  assert.deepEqual(storage.persisted(), {
    builtin: { 'clipboard-history': record({ ...plain(A.defaults), enabled: false }), other: record({ marker: 2 }) },
    installed: { 'clipboard-history': record({ enabled: false }) }, dev: {},
  })
  A.event()
  assert.equal(A.store.getState().settingsDialogTarget, null, 'remote dialogs are not synchronized')
})

test('another window write during subscriber notification survives the outer persist', async () => {
  const storage = sharedSettingsStorage()
  const A = settingsWindow(storage)
  const B = settingsWindow(storage)
  let nested = false
  let nestedWrite
  A.store.subscribe(() => {
    if (nested) return
    nested = true
    nestedWrite = B.store.getState().setPluginSettings('installed', 'other', { newer: true }, 1)
  })
  await A.setEnabled(true)
  await nestedWrite
  assert.deepEqual(storage.persisted().installed.other, record({ newer: true }))
  assert.equal(storage.persisted().builtin['clipboard-history'].value.enabled, true)
})


const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const holdWrites = async storage => {
  const held = deferred(), release = deferred()
  const done = storage.locks.request('hiven:plugin-settings:write', async () => { held.resolve(); await release.promise })
  await held.promise
  return async () => { release.resolve(); await done }
}

test('parallel requests from independent windows preserve distinct records under one lock', async () => {
  const storage = sharedSettingsStorage(), A = settingsWindow(storage), B = settingsWindow(storage)
  const release = await holdWrites(storage)
  const first = A.store.getState().setPluginSettings('builtin', 'one', { value: 1 }, 1)
  const second = B.store.getState().setPluginSettings('builtin', 'two', { value: 2 }, 1)
  assert.equal(storage.writes, 0)
  await release(); await Promise.all([first, second])
  assert.deepEqual(storage.persisted().builtin, { one: record({ value: 1 }), two: record({ value: 2 }) })
})

test('parallel same-record changes reject stale confirmation without overwriting committed value', async () => {
  const storage = sharedSettingsStorage(), A = settingsWindow(storage), B = settingsWindow(storage)
  await A.store.getState().setPluginSettings('builtin', 'example', { retentionMonths: 12 }, 1)
  B.event()
  const release = await holdWrites(storage)
  const a = A.store.getState().setPluginSettings('builtin', 'example', { retentionMonths: 6 }, 1)
  const b = B.store.getState().setPluginSettings('builtin', 'example', { retentionMonths: 3 }, 1)
  const rejected = assert.rejects(b, error => error.code === 'conflict')
  await release(); await a; await rejected
  assert.equal(storage.persisted().builtin.example.value.retentionMonths, 6)
  assert.equal(B.store.getState().getPluginSettings('builtin', 'example').value.retentionMonths, 6)
})

test('cancelled queued change does not publish, persist, or revert another window', async () => {
  const storage = sharedSettingsStorage(), A = settingsWindow(storage), B = settingsWindow(storage)
  await A.setEnabled(false); B.event()
  const release = await holdWrites(storage)
  let current = true, notifications = 0
  A.store.subscribe(() => { notifications++ })
  const save = A.store.getState().setPluginSettings('builtin', 'clipboard-history', { ...A.defaults, retentionMonths: 1 }, 1, { isCurrent: () => current })
  const rejected = assert.rejects(save, error => error.code === 'cancelled')
  const remote = B.store.getState().setPluginSettings('builtin', 'clipboard-history', { ...B.defaults, retentionMonths: 12 }, 1)
  current = false
  await release(); await rejected; await remote
  assert.equal(notifications, 0)
  assert.equal(storage.persisted().builtin['clipboard-history'].value.retentionMonths, 12)
})

test('failed persistence never publishes candidate or restarts cleanup with shorter retention', async () => {
  const storage = sharedSettingsStorage(), A = settingsWindow(storage, { backgrounds: true })
  await A.store.getState().setPluginSettings('builtin', 'clipboard-history', { ...A.defaults, retentionMonths: 12 }, 1)
  A.manager.initializePluginBackgrounds(); const stop = A.manager.setupBackgroundSettingsWatcher(); await settle()
  assert.deepEqual(A.counts.retention, [12])
  const error = new Error('synthetic storage failure')
  storage.failWrite = () => error
  let notifications = 0; const unsubscribe = A.store.subscribe(() => { notifications++ })
  await assert.rejects(A.store.getState().setPluginSettings('builtin', 'clipboard-history', { ...A.defaults, retentionMonths: 1 }, 1), e => e === error)
  await settle()
  assert.equal(notifications, 0); assert.deepEqual(A.counts.retention, [12])
  assert.equal(A.store.getState().getPluginSettings('builtin', 'clipboard-history').value.retentionMonths, 12)
  unsubscribe(); stop(); await A.manager.stopAllPluginBackgrounds()
})

test('durable write happens before subscriber publication; nested save runs after lock release', async () => {
  const storage = sharedSettingsStorage(), A = settingsWindow(storage)
  let nested, observed = false
  const stop = A.store.subscribe(state => {
    if (observed) return
    observed = true
    assert.equal(storage.persisted().builtin.example.value.n, 1)
    nested = state.setPluginSettings('builtin', 'example', { n: 2 }, 1)
  })
  await A.store.getState().setPluginSettings('builtin', 'example', { n: 1 }, 1)
  await nested; stop()
  assert.equal(storage.persisted().builtin.example.value.n, 2)
})

test('read failure and unavailable locks reject without changing committed state', async () => {
  for (const unavailable of [false, true]) {
    const storage = sharedSettingsStorage(), A = settingsWindow(storage)
    await A.setEnabled(false)
    if (unavailable) storage.locks.request = undefined
    else storage.getItem = () => { throw new Error('synthetic read failure') }
    await assert.rejects(A.setEnabled(true))
    assert.equal(A.enabled(), false)
    assert.equal(storage.persisted().builtin['clipboard-history'].value.enabled, false)
  }
})

test('legacy read fallback and transient dialog changes do not write; explicit save migrates under lock', async () => {
  const storage = sharedSettingsStorage()
  storage.setItem('fluxtext-plugin-settings', JSON.stringify({ state: { pluginSettings: { builtin: { example: record({ n: 1 }) }, installed: {}, dev: {} } }, version: 0 }))
  const A = settingsWindow(storage), writes = storage.writes
  A.store.getState().openSettingsDialog({ pluginId: 'example', source: 'builtin' })
  A.store.getState().closeSettingsDialog()
  await A.store.persist.rehydrate()
  assert.equal(storage.writes, writes); assert.equal(storage.getItem(settingsKey), null)
  await A.store.getState().setPluginSettings('builtin', 'example', { n: 2 }, 1)
  assert.equal(storage.persisted().builtin.example.value.n, 2)
})

test('background migration waits for durable commit and restart launches only the committed generation', async () => {
  const storage = sharedSettingsStorage(), A = settingsWindow(storage, { backgrounds: true })
  await A.setEnabled(false)
  A.definition.settings.version = 2
  A.definition.settings.migrate = old => ({ ...old, retentionMonths: 6 })
  const release = await holdWrites(storage)
  const stop = A.manager.setupBackgroundSettingsWatcher()
  A.manager.initializePluginBackgrounds(); await settle()
  assert.equal(A.counts.starts, 0)
  await release(); await settle(); await settle()
  assert.equal(storage.persisted().builtin['clipboard-history'].version, 2)
  assert.equal(A.counts.starts, 1); assert.deepEqual(A.counts.retention, [6])
  stop(); await A.manager.stopAllPluginBackgrounds()
})

test('failed migration never starts background using projected or default policy', async () => {
  const storage = sharedSettingsStorage(), A = settingsWindow(storage, { backgrounds: true })
  await A.store.getState().setPluginSettings('builtin', 'clipboard-history', { ...A.defaults, retentionMonths: 12 }, 1)
  A.definition.settings.version = 2; A.definition.settings.migrate = old => ({ ...old, retentionMonths: 3 })
  storage.failWrite = () => new Error('synthetic migration failure')
  A.manager.initializePluginBackgrounds(); await settle(); await settle()
  assert.equal(A.counts.starts, 0); assert.deepEqual(A.counts.retention, [])
  assert.equal(storage.persisted().builtin['clipboard-history'].value.retentionMonths, 12)
  await A.manager.stopAllPluginBackgrounds()
})

test('stop while migration waits revokes candidate and prevents later background launch', async () => {
  const storage = sharedSettingsStorage(), A = settingsWindow(storage, { backgrounds: true })
  await A.setEnabled(false)
  A.definition.settings.version = 2; A.definition.settings.migrate = old => ({ ...old, retentionMonths: 1 })
  const release = await holdWrites(storage)
  A.manager.initializePluginBackgrounds(); await settle()
  await A.manager.stopAllPluginBackgrounds(); await release(); await settle()
  assert.equal(A.counts.starts, 0); assert.equal(storage.persisted().builtin['clipboard-history'].version, 1)
})

test('programmatic decrease is refused while increase persists and notifies once', async () => {
  const storage = sharedSettingsStorage(), A = settingsWindow(storage)
  await A.setEnabled(false)
  let notifications = 0
  A.definition.settings.confirmChange = (old, next) => next.retentionMonths < old.retentionMonths ? { title: 'confirm', message: 'synthetic' } : null
  A.definition.settings.onChange = () => { notifications++ }
  await A.updateOwn(old => ({ ...old, retentionMonths: 1 }))
  assert.equal(storage.persisted().builtin['clipboard-history'].value.retentionMonths, 3)
  assert.equal(notifications, 0)
  await A.updateOwn(old => ({ ...old, retentionMonths: 12 }))
  assert.equal(storage.persisted().builtin['clipboard-history'].value.retentionMonths, 12)
  assert.equal(notifications, 1)
})

test('programmatic queued update cannot outlive the plugin lifetime', async () => {
  const storage = sharedSettingsStorage(), A = settingsWindow(storage)
  await A.setEnabled(false)
  let notifications = 0
  A.definition.settings.onChange = () => { notifications++ }
  const release = await holdWrites(storage)
  const write = A.updateOwn(old => ({ ...old, retentionMonths: 12 }))
  A.lifetime.active = false
  await release(); await write
  assert.equal(storage.persisted().builtin['clipboard-history'].value.retentionMonths, 3)
  assert.equal(notifications, 0)
})

test('permission denial still prevents background capture after remote enable', async () => {
  const storage = sharedSettingsStorage(), A = settingsWindow(storage, { backgrounds: true }), B = settingsWindow(storage)
  A.permissions.usePluginPermissionStore.getState().revokePermissions('builtin', 'clipboard-history', ['clipboard.watch'])
  A.manager.initializePluginBackgrounds(); const stop = A.manager.setupBackgroundSettingsWatcher(); await settle()
  await B.setEnabled(true); A.event(); await settle()
  assert.equal(A.enabled(), true); assert.equal(A.counts.watches, 0)
  stop(); await A.manager.stopAllPluginBackgrounds()
})
