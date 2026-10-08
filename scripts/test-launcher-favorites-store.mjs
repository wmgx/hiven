#!/usr/bin/env node
// Real AppStore/Zustand modules in separate JS windows; fake storage only.
import assert from 'node:assert/strict'
import { plain, sharedStorage, windowStore } from './helpers/app-store-fixture.mjs'

let passed = 0
function check(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { error.message = `${name}: ${error.message}`; throw error }
}
const keys = (store) => plain(store.state().launcherFavoriteKeys)
function fixture(initial) {
  const storage = sharedStorage(initial)
  return { storage, A: windowStore(storage), B: windowStore(storage) }
}
function assertSaved(storage, expected) {
  assert.deepEqual(plain(storage.persisted().launcherFavoriteKeys), expected, 'persisted favorites')
  assert.deepEqual(keys(windowStore(storage)), expected, 'fresh window sees persisted favorites')
}

check('fresh, legacy and malformed favorite lists normalize without an item cap', () => {
  assert.deepEqual(keys(windowStore(sharedStorage())), [])
  assert.deepEqual(keys(windowStore(sharedStorage({ settings: { theme: 'light' } }))), [])
  const many = Array.from({ length: 80 }, (_, index) => `pin:${index}`)
  const storage = sharedStorage({ launcherFavoriteKeys: [...many, ' pin:1 ', '', null, 42] })
  const A = windowStore(storage)
  assert.deepEqual(keys(A), many)
  A.state().toggleLauncherFavorite('new', true)
  assertSaved(storage, ['new', ...many])
})

for (const [name, write] of [
  ['locale', (state) => state.setLocale('zh')],
  ['theme', (state) => state.updateSetting('theme', 'light')],
  ['command bar', (state) => state.setEditorCommandBarOpen(true)],
]) {
  for (const delivered of [false, true]) {
    check(`stale ${name} write preserves a newer pin with storage event ${delivered ? 'delivered' : 'pending'}`, () => {
      const { storage, A, B } = fixture()
      A.state().toggleLauncherFavorite('a', true)
      if (delivered) B.event()
      write(B.state())
      assertSaved(storage, ['a'])
      B.event()
      assert.deepEqual(keys(B), ['a'])
    })
  }
}

for (const delivered of [false, true]) {
  check(`different pins merge before a storage event is ${delivered ? 'delivered' : 'pending'}`, () => {
    const { storage, A, B } = fixture()
    A.state().toggleLauncherFavorite('a', true)
    if (delivered) B.event()
    B.state().toggleLauncherFavorite('b', true)
    assertSaved(storage, ['b', 'a'])
    A.state().toggleLauncherFavorite('c', true)
    assertSaved(storage, ['c', 'b', 'a'])
    A.event()
    B.event()
    assert.deepEqual(keys(A), ['c', 'b', 'a'])
    assert.deepEqual(keys(B), ['c', 'b', 'a'])
  })
}

check('unpin cannot be revived by a stale unrelated write or another pin', () => {
  const { storage, A, B } = fixture({ launcherFavoriteKeys: ['a', 'b'] })
  A.state().toggleLauncherFavorite('a', false)
  B.state().setLocale('zh')
  assertSaved(storage, ['b'])
  B.state().toggleLauncherFavorite('c', true)
  assertSaved(storage, ['c', 'b'])
  A.event()
  A.state().toggleLauncherFavorite('b', false)
  B.event()
  B.state().setLocale('en')
  assertSaved(storage, ['c'])
})

check('two stale Add or Remove intents are idempotent and preserve order', () => {
  const { storage, A, B } = fixture({ launcherFavoriteKeys: ['old'] })
  const aWantsPin = !keys(A).includes('same')
  const bWantsPin = !keys(B).includes('same')
  A.state().toggleLauncherFavorite('same', aWantsPin)
  A.state().toggleLauncherFavorite('newer', true)
  B.state().toggleLauncherFavorite('same', bWantsPin)
  assertSaved(storage, ['newer', 'same', 'old'])
  A.event()
  const aWantsUnpin = !keys(A).includes('same')
  const bWantsUnpin = !keys(B).includes('same')
  A.state().toggleLauncherFavorite('same', aWantsUnpin)
  B.state().toggleLauncherFavorite('same', bWantsUnpin)
  assertSaved(storage, ['newer', 'old'])
})

check('the original one-argument API toggles the newest persisted list', () => {
  const { storage, A, B } = fixture()
  A.state().toggleLauncherFavorite('a')
  B.state().toggleLauncherFavorite('b')
  assertSaved(storage, ['b', 'a'])
  A.state().toggleLauncherFavorite('b')
  assertSaved(storage, ['a'])
})

check('favorite-only events hydrate once, without echo writes or unrelated-event hydration', () => {
  const { storage, A, B } = fixture()
  A.state().toggleLauncherFavorite('a', true)
  const writes = storage.writes
  B.event('unrelated-storage-key')
  assert.equal(B.hydrations, 0)
  assert.deepEqual(keys(B), [])
  B.event()
  B.event()
  B.event(null)
  assert.equal(B.hydrations, 1)
  assert.equal(storage.writes, writes)
  assert.deepEqual(keys(B), ['a'])
  storage.setItem('hiven-settings', JSON.stringify({ state: { launcherFavoriteKeys: [' a ', 'a', null] }, version: 0 }))
  B.event()
  assert.equal(B.hydrations, 1, 'equivalent normalized lists do not rehydrate')
})

for (const mode of ['clear', 'remove', 'legacy']) {
  check(`${mode} settings clear favorites and stale unrelated writes cannot resurrect them`, () => {
    const { storage, A, B } = fixture({ launcherFavoriteKeys: ['a'] })
    if (mode === 'clear') storage.clear()
    else if (mode === 'remove') storage.removeItem('hiven-settings')
    else storage.setItem('hiven-settings', JSON.stringify({ state: { settings: { theme: 'light' } }, version: 0 }))
    A.event(mode === 'clear' ? null : 'hiven-settings')
    assert.deepEqual(keys(A), [])
    B.state().setEditorCommandBarOpen(true)
    assertSaved(storage, [])
    B.state().toggleLauncherFavorite('new', true)
    assertSaved(storage, ['new'])
  })
}

check('failed pin and unpin writes restore memory, preserve disk, and can be retried', () => {
  const { storage, A } = fixture({ launcherFavoriteKeys: ['saved'] })
  const before = storage.getItem('hiven-settings')
  storage.failWrites = true
  for (const [key, pinned] of [['unsaved', true], ['saved', false]]) {
    assert.throws(() => A.state().toggleLauncherFavorite(key, pinned), /Synthetic storage write failure/)
    assert.deepEqual(keys(A), ['saved'])
    assert.equal(storage.getItem('hiven-settings'), before)
  }
  storage.failWrites = false
  A.state().toggleLauncherFavorite('retry', true)
  assertSaved(storage, ['retry', 'saved'])
})

check('unreadable, malformed or unavailable storage cannot report a successful favorite edit', () => {
  const { storage, A } = fixture({ launcherFavoriteKeys: ['saved'] })
  storage.failReads = true
  assert.throws(() => A.state().toggleLauncherFavorite('unsaved', true), /Synthetic storage read failure/)
  assert.deepEqual(keys(A), ['saved'])
  storage.failReads = false
  const malformed = '{invalid-json'
  storage.setItem('hiven-settings', malformed)
  assert.throws(() => A.state().toggleLauncherFavorite('unsaved', true), /JSON/)
  assert.deepEqual(keys(A), ['saved'])
  assert.equal(storage.getItem('hiven-settings'), malformed)
  const unavailable = windowStore(sharedStorage(), { unavailable: true })
  assert.throws(() => unavailable.state().toggleLauncherFavorite('unsaved', true), /storage is unavailable/)
  assert.deepEqual(keys(unavailable), [])
})

check('unrelated synchronous subscriber writes preserve the pending pin', () => {
  const { storage, A, B } = fixture()
  let nested = false
  A.useAppStore.subscribe((state) => {
    if (nested || !state.launcherFavoriteKeys.includes('outer')) return
    nested = true
    state.setLocale('zh')
    state.updateSetting('theme', 'light')
  })
  A.state().toggleLauncherFavorite('outer', true)
  assertSaved(storage, ['outer'])
  B.state().toggleLauncherFavorite('remote', true)
  A.state().setEditorCommandBarOpen(true)
  assertSaved(storage, ['remote', 'outer'])
})

check('nested pin and unpin build on the pending local list and restore the write marker', () => {
  const { storage, A, B } = fixture({ launcherFavoriteKeys: ['remove-me', 'keep'] })
  let nested = false
  A.useAppStore.subscribe((state) => {
    if (nested || !state.launcherFavoriteKeys.includes('outer')) return
    nested = true
    state.toggleLauncherFavorite('inner', true)
    state.toggleLauncherFavorite('remove-me', false)
    state.setLocale('zh')
  })
  A.state().toggleLauncherFavorite('outer', true)
  assertSaved(storage, ['inner', 'outer', 'keep'])
  assert.deepEqual(keys(A), ['inner', 'outer', 'keep'])
  B.state().toggleLauncherFavorite('remote', true)
  A.state().setLocale('en')
  assertSaved(storage, ['remote', 'inner', 'outer', 'keep'])
})

check('a later outer write failure does not roll back a newer successful nested edit', () => {
  const { storage, A, B } = fixture()
  let nested = false
  A.useAppStore.subscribe((state) => {
    if (nested || !state.launcherFavoriteKeys.includes('outer')) return
    nested = true
    state.toggleLauncherFavorite('inner', true)
    storage.failWrites = true
  })
  assert.throws(() => A.state().toggleLauncherFavorite('outer', true), /Synthetic storage write failure/)
  storage.failWrites = false
  assert.deepEqual(keys(A), ['inner', 'outer'])
  assertSaved(storage, ['inner', 'outer'])
  B.state().toggleLauncherFavorite('remote', true)
  A.state().setLocale('zh')
  assertSaved(storage, ['remote', 'inner', 'outer'])
})

check('a caught nested save failure restores the outer pending list and write marker', () => {
  const { storage, A } = fixture()
  let nested = false
  A.useAppStore.subscribe((state) => {
    if (nested || !state.launcherFavoriteKeys.includes('outer')) return
    nested = true
    storage.failWrites = true
    assert.throws(() => state.toggleLauncherFavorite('failed-inner', true), /Synthetic storage write failure/)
    storage.failWrites = false
    assert.deepEqual(keys(A), ['outer'])
  })
  A.state().toggleLauncherFavorite('outer', true)
  assert.deepEqual(keys(A), ['outer'])
  assertSaved(storage, ['outer'])
})

check('favorites preserve aliases, shortcuts, learning choice and per-window shortcut status', () => {
  const { storage, A, B } = fixture()
  A.state().setAppSearchAliases('app:a', ['工作'])
  A.state().updateSetting('automaticLearningEnabled', true)
  B.state().toggleLauncherFavorite('a', true)
  assert.deepEqual(plain(storage.persisted().settings.appSearchAliases), { 'app:a': ['工作'] })
  assert.equal(storage.persisted().settings.automaticLearningEnabled, true)
  B.event()
  B.state().updateSetting('globalPinnedLauncherShortcut', {
    kind: 'accelerator', accelerator: 'Shift+Cmd+Space', registrationStatus: 'registered',
  })
  A.state().toggleLauncherFavorite('b', true)
  B.event()
  assert.equal(B.state().settings.globalPinnedLauncherShortcut.registrationStatus, 'registered')
  assert.deepEqual(keys(B), ['b', 'a'])
  assert.equal(storage.persisted().settings.globalPinnedLauncherShortcut.registrationStatus, undefined)
})

check('a rollback subscriber preserves the still-pending outer pin when saving recovers', () => {
  const { storage, A } = fixture()
  let stage = 'start'
  A.useAppStore.subscribe((state) => {
    if (stage === 'start' && state.launcherFavoriteKeys.includes('outer')) {
      stage = 'inner'
      storage.failWrites = true
      assert.throws(() => state.toggleLauncherFavorite('failed-inner', true), /Synthetic storage write failure/)
    } else if (stage === 'inner' && !state.launcherFavoriteKeys.includes('failed-inner')) {
      stage = 'recovered'
      storage.failWrites = false
      state.toggleLauncherFavorite('recovery', true)
    }
  })
  A.state().toggleLauncherFavorite('outer', true)
  assert.equal(stage, 'recovered')
  assert.deepEqual(keys(A), ['recovery', 'outer'])
  assertSaved(storage, ['recovery', 'outer'])
})

console.log(`Launcher favorites: ${passed} store cases passed`)
