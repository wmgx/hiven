#!/usr/bin/env node
// Actual persisted store and module behavior; no UI source or styling assertions.
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const values = new Map()
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
}
globalThis.localStorage = globalThis.sessionStorage = storage
const servers = []
const checks = []
async function windowStore(initial) {
  if (initial !== undefined) storage.setItem('hiven-settings', JSON.stringify({state: initial, version: 0}))
  const listeners = new Map()
  const window = {
    localStorage: storage, sessionStorage: storage, location: { search: '' },
    addEventListener: (name, callback) => {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(callback)
    },
    removeEventListener: (name, callback) => listeners.get(name)?.delete(callback),
    dispatchEvent: (event) => { for (const cb of listeners.get(event.type) ?? []) cb(event) },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  }
  globalThis.window = window
  const vite = await createServer({server: {middlewareMode: true}, appType: 'custom', logLevel: 'silent'})
  servers.push(vite)
  const exports = await vite.ssrLoadModule('/src/store.ts')
  return {...exports, window}
}
function check(name, fn) {
  try { fn(); checks.push({name, passed: true}); console.log(`PASS ${name}`) }
  catch (error) { checks.push({name, passed: false}); console.log(`FAIL ${name}: ${error.message}`) }
}
function event(window, key = 'hiven-settings') {window.dispatchEvent({type: 'storage', key, storageArea: storage})}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
try {
  const A = await windowStore()
  check('fresh setting disabled and signal aborted', () => {
    assert.equal(A.useAppStore.getState().settings.automaticLearningEnabled, false)
    assert.equal(A.getAutomaticLearningSignal().aborted, true)
  })
  A.useAppStore.getState().updateSetting('automaticLearningEnabled', true)
  const sigA = A.getAutomaticLearningSignal()
  const B = await windowStore()
  check('new window reads enabled opt-in', () => assert.equal(B.useAppStore.getState().settings.automaticLearningEnabled, true))
  B.useAppStore.getState().updateSetting('automaticLearningEnabled', false)
  A.useAppStore.getState().updateSetting('theme', 'light')
  check('stale window cannot persist opt-in over newer disable', () => assert.equal(JSON.parse(storage.getItem('hiven-settings')).state.settings.automaticLearningEnabled, false))
  event(A.window); await tick()
  check('disable storage event propagates and aborts old generation', () => {
    assert.equal(A.useAppStore.getState().settings.automaticLearningEnabled, false)
    assert.equal(sigA.aborted, true)
  })
  A.useAppStore.getState().updateSetting('automaticLearningEnabled', true)
  const sig2 = A.getAutomaticLearningSignal()
  check('re-enable uses fresh generation', () => {
    assert.notEqual(sig2, sigA); assert.equal(sig2.aborted, false); assert.equal(sigA.aborted, true)
  })
  storage.setItem('hiven-settings', JSON.stringify({state: {settings: {theme: 'dark'}}, version: 0}))
  event(A.window); await tick()
  check('legacy settings without opt-in disable live true', () => {
    assert.equal(A.useAppStore.getState().settings.automaticLearningEnabled, false)
    assert.equal(sig2.aborted, true)
  })
  A.useAppStore.getState().updateSetting('automaticLearningEnabled', true)
  const sig3 = A.getAutomaticLearningSignal()
  storage.removeItem('hiven-settings')
  event(A.window); await tick()
  check('removed settings disable live true', () => {
    assert.equal(A.useAppStore.getState().settings.automaticLearningEnabled, false)
    assert.equal(sig3.aborted, true)
  })
  A.useAppStore.getState().updateSetting('automaticLearningEnabled', true)
  const sig4 = A.getAutomaticLearningSignal()
  storage.removeItem('hiven-settings')
  event(A.window, null); await tick()
  check('storage clear disables live true', () => {
    assert.equal(A.useAppStore.getState().settings.automaticLearningEnabled, false)
    assert.equal(sig4.aborted, true)
  })
  A.useAppStore.getState().updateSetting('automaticLearningEnabled', true)
  const sig5 = A.getAutomaticLearningSignal()
  storage.removeItem('hiven-settings')
  A.useAppStore.getState().updateSetting('theme', 'dark')
  check('stale unrelated write cannot restore opt-in after another window deletes settings', () => {
    assert.equal(JSON.parse(storage.getItem('hiven-settings')).state.settings.automaticLearningEnabled, false)
  })
  event(A.window); await tick()
  check('removal then unrelated write still disables old generation', () => {
    assert.equal(A.useAppStore.getState().settings.automaticLearningEnabled, false)
    assert.equal(sig5.aborted, true)
  })
  const state = A.useAppStore.getState()
  state.toggleLauncherFavorite('manual-favorite')
  state.saveActionParams('manual-action', {separator: ', '})
  state.recordLauncherSelection('global-launcher', 'manual-action')
  state.recordPersistableLauncherSelection({persistKey: 'manual-recent', systemKey: 'manual-recent', kind: 'document', title: 'Saved document', url: 'https://example.com/saved'})
  const before = JSON.stringify({
    favorites: A.useAppStore.getState().launcherFavoriteKeys,
    params: A.useAppStore.getState().savedActionParams,
    usage: A.useAppStore.getState().launcherUsageBySurface,
    recents: A.useAppStore.getState().launcherPersistableRecents,
  })
  state.updateSetting('automaticLearningEnabled', true)
  state.updateSetting('automaticLearningEnabled', false)
  check('toggling preserves manual params, favorites, explicit usage and recents', () => {
    assert.equal(JSON.stringify({
      favorites: A.useAppStore.getState().launcherFavoriteKeys,
      params: A.useAppStore.getState().savedActionParams,
      usage: A.useAppStore.getState().launcherUsageBySurface,
      recents: A.useAppStore.getState().launcherPersistableRecents,
    }), before)
    assert.equal(A.useAppStore.getState().launcherUsageBySurface['global-launcher']['manual-action'].count, 1)
  })
  process.exitCode = checks.some(x => !x.passed) ? 1 : 0
} finally {
  await Promise.all(servers.map(server => server.close()))
}
