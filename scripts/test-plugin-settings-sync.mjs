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
    surface.setEnabled(true)
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
    surface.setEnabled(false)
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
    surface.setEnabled(true)
    const launcher = settingsWindow(storage, { backgrounds: true })
    launcher.manager.initializePluginBackgrounds()
    const stopSettings = launcher.manager.setupBackgroundSettingsWatcher()
    await settle()
    assert.equal(launcher.counts.watches, 1)
    if (clear) storage.clear()
    else surface.store.getState().removePluginSettings('builtin', 'clipboard-history')
    launcher.event(clear ? null : settingsKey)
    await settle()
    assert.equal(launcher.enabled(), false)
    assert.equal(launcher.counts.stops, 1)
    stopSettings()
    await launcher.manager.stopAllPluginBackgrounds()
  }
})

test('delayed events read current storage; unrelated keys and other profiles cannot change settings', () => {
  const storage = sharedSettingsStorage()
  const A = settingsWindow(storage)
  const B = settingsWindow(storage)
  B.setEnabled(true)
  const oldValue = storage.getItem(settingsKey)
  B.setEnabled(false)
  A.event('other-key')
  A.event(settingsKey, { storageArea: sharedSettingsStorage() })
  assert.equal(A.store.getState().getPluginSettings('builtin', 'clipboard-history'), undefined)
  A.event(settingsKey, { newValue: oldValue })
  assert.equal(A.enabled(), false)
  assert.ok(A.store.getState().getPluginSettings('builtin', 'clipboard-history'))
})

test('stale windows preserve other plugins and sources through writes, deletion and dialog dismissal', () => {
  const storage = sharedSettingsStorage()
  const A = settingsWindow(storage)
  const B = settingsWindow(storage)
  A.setEnabled(true)
  B.store.getState().setPluginSettings('installed', 'clipboard-history', { enabled: false }, 1)
  A.store.getState().setPluginSettings('dev', 'other', { marker: 1 }, 1)
  B.store.getState().setPluginSettings('builtin', 'other', { marker: 2 }, 1)
  A.store.getState().removePluginSettings('dev', 'other')
  B.store.getState().openSettingsDialog({ source: 'builtin', pluginId: 'other' })
  A.setEnabled(false)
  B.store.getState().closeSettingsDialog()
  assert.deepEqual(storage.persisted(), {
    builtin: { 'clipboard-history': record({ ...plain(A.defaults), enabled: false }), other: record({ marker: 2 }) },
    installed: { 'clipboard-history': record({ enabled: false }) }, dev: {},
  })
  A.event()
  assert.equal(A.store.getState().settingsDialogTarget, null, 'remote dialogs are not synchronized')
})

test('another window write during subscriber notification survives the outer persist', () => {
  const storage = sharedSettingsStorage()
  const A = settingsWindow(storage)
  const B = settingsWindow(storage)
  let nested = false
  A.store.subscribe(() => {
    if (nested) return
    nested = true
    B.store.getState().setPluginSettings('installed', 'other', { newer: true }, 1)
  })
  A.setEnabled(true)
  assert.deepEqual(storage.persisted().installed.other, record({ newer: true }))
  assert.equal(storage.persisted().builtin['clipboard-history'].value.enabled, true)
})

test('failed stale save rolls back to the latest durable same-plugin value and preserves other windows', () => {
  const storage = sharedSettingsStorage()
  const A = settingsWindow(storage)
  const B = settingsWindow(storage)
  A.setEnabled(false)
  B.setEnabled(true)
  B.store.getState().setPluginSettings('dev', 'other', { latest: true }, 1)
  const failure = new Error('Synthetic write failure')
  const attempt = storage.writes + 1
  storage.failWrite = (count) => count === attempt ? failure : undefined
  assert.throws(() => A.setEnabled(false), (error) => error === failure)
  assert.equal(A.enabled(), true)
  assert.equal(storage.persisted().builtin['clipboard-history'].value.enabled, true)
  assert.deepEqual(storage.persisted().dev.other, record({ latest: true }))
})

test('permission denial still prevents background capture after a remote enable', async () => {
  const storage = sharedSettingsStorage()
  const launcher = settingsWindow(storage, { backgrounds: true })
  const surface = settingsWindow(storage)
  launcher.permissions.usePluginPermissionStore.getState().revokePermissions('builtin', 'clipboard-history', ['clipboard.watch'])
  launcher.manager.initializePluginBackgrounds()
  const stopSettings = launcher.manager.setupBackgroundSettingsWatcher()
  await settle()
  surface.setEnabled(true)
  launcher.event()
  await settle()
  assert.equal(launcher.enabled(), true)
  assert.equal(launcher.counts.watches, 0)
  stopSettings()
  await launcher.manager.stopAllPluginBackgrounds()
})

test('a persist read failure still rolls back memory when subsequent reads also fail', () => {
  const storage = sharedSettingsStorage()
  const A = settingsWindow(storage)
  A.setEnabled(false)
  const getItem = storage.getItem
  const failure = new Error('Synthetic persistent read failure')
  let reads = 0
  storage.getItem = (key) => {
    if (++reads >= 2) throw failure
    return getItem(key)
  }
  assert.throws(() => A.setEnabled(true), (error) => error === failure)
  assert.equal(A.enabled(), false)
  assert.equal(storage.persisted().builtin['clipboard-history'].value.enabled, false)
})

test('failed outer saves preserve a newer same-plugin save from another window', () => {
  const storage = sharedSettingsStorage()
  const A = settingsWindow(storage)
  const B = settingsWindow(storage)
  A.store.getState().setPluginSettings('builtin', 'example', { marker: 'base' }, 1)
  let nested = false
  A.store.subscribe(() => {
    if (nested) return
    nested = true
    B.store.getState().setPluginSettings('builtin', 'example', { marker: 'remote-newer' }, 1)
  })
  const failure = new Error('Synthetic outer write failure')
  const attempt = storage.writes + 2
  storage.failWrite = (count) => count === attempt ? failure : undefined
  assert.throws(() => A.store.getState().setPluginSettings('builtin', 'example', { marker: 'attempted' }, 1),
    (error) => error === failure)
  assert.deepEqual(plain(A.store.getState().getPluginSettings('builtin', 'example')), record({ marker: 'remote-newer' }))
  assert.deepEqual(storage.persisted().builtin.example, record({ marker: 'remote-newer' }))
})
