#!/usr/bin/env node
// Real Zustand persistence in isolated contexts; storage and all data are synthetic.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const compiled = new Map()
const storageKey = 'hiven-plugin-settings'
const plain = (value) => JSON.parse(JSON.stringify(value))
const savedValue = { glossary: 'old synthetic terms' }
const candidate = { glossary: 'unsaved synthetic terms' }
const initialSettings = () => ({
  builtin: { translate: { version: 1, value: savedValue } },
  installed: {},
  dev: {},
})

function fixture(initial = initialSettings()) {
  const values = new Map([[storageKey, JSON.stringify({ state: { pluginSettings: initial }, version: 0 })]])
  const storage = {
    attempts: 0,
    failWrite: () => undefined,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      const error = storage.failWrite(++storage.attempts)
      if (error) throw error
      values.set(key, String(value))
    },
    removeItem: (key) => values.delete(key),
    persisted: () => JSON.parse(values.get(storageKey)).state.pluginSettings,
  }
  const forbidden = () => { throw new Error('External I/O is forbidden in plugin settings tests') }
  const context = createContext({ window: { localStorage: storage }, localStorage: storage, fetch: forbidden, console })
  const modules = new Map()
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports
    const module = { exports: {} }
    modules.set(file, module)
    if (!compiled.has(file)) {
      const source = readFileSync(file, 'utf8')
      compiled.set(file, file.endsWith('.ts') ? ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        fileName: file,
      }).outputText : source)
    }
    const scopedRequire = (specifier) => {
      if (specifier === 'react') return require(specifier)
      if (specifier === 'zustand' || specifier.startsWith('zustand/')) return load(require.resolve(specifier))
      assert.equal(specifier, '../utils/persistMigration', `Unexpected module: ${specifier}`)
      const target = resolve(dirname(file), `${specifier}.ts`)
      assert.ok(existsSync(target), `Unresolved module: ${specifier}`)
      return load(target)
    }
    new Script(`(function(require,module,exports){${compiled.get(file)}\n})`, { filename: file })
      .runInContext(context)(scopedRequire, module, module.exports)
    return module.exports
  }
  const { usePluginSettingsStore: store } = load(resolve(root, 'src/workspace/pluginSettingsStore.ts'))
  return { store, storage }
}

test('successful save immediately updates memory and persisted value/version', () => {
  const { store, storage } = fixture()
  store.getState().setPluginSettings('builtin', 'translate', candidate, 2)
  assert.deepEqual(plain(store.getState().getPluginSettings('builtin', 'translate')), { version: 2, value: candidate })
  assert.deepEqual(storage.persisted().builtin.translate, { version: 2, value: candidate })
  assert.equal(storage.attempts, 1)
})

test('storage failure during transient dismissal clears the dialog without interrupting its owner', () => {
  const { store, storage } = fixture()
  const settings = store.getState().pluginSettings
  store.getState().openSettingsDialog({ pluginId: 'translate', source: 'builtin', presentation: 'dialog', context: { surfaceId: 'global-launcher' } })
  storage.failWrite = () => new Error('Synthetic dismissal storage failure')
  assert.doesNotThrow(() => store.getState().closeSettingsDialog())
  assert.equal(store.getState().settingsDialogTarget, null)
  assert.equal(store.getState().pluginSettings, settings)
  assert.deepEqual(storage.persisted(), initialSettings())
})

test('failed save restores the previous record and rethrows the original storage error', () => {
  const { store, storage } = fixture()
  const previous = store.getState().getPluginSettings('builtin', 'translate')
  const originalError = new Error('Synthetic save failure')
  storage.failWrite = (attempt) => attempt === 1 ? originalError : undefined
  assert.throws(() => store.getState().setPluginSettings('builtin', 'translate', candidate, 2), (error) => error === originalError)
  assert.equal(store.getState().getPluginSettings('builtin', 'translate'), previous)
  assert.deepEqual(storage.persisted(), initialSettings())
  assert.equal(storage.attempts, 2)
})

test('rollback storage failure still restores memory and preserves the first error', () => {
  const { store, storage } = fixture()
  const previous = store.getState().getPluginSettings('builtin', 'translate')
  const originalError = new Error('Synthetic initial save failure')
  const rollbackError = new Error('Synthetic rollback persistence failure')
  const observed = []
  store.subscribe((state) => observed.push(state.pluginSettings.builtin.translate))
  storage.failWrite = (attempt) => attempt === 1 ? originalError : rollbackError
  assert.throws(() => store.getState().setPluginSettings('builtin', 'translate', candidate, 2), (error) => error === originalError)
  assert.equal(store.getState().getPluginSettings('builtin', 'translate'), previous)
  assert.equal(observed.length, 2)
  assert.equal(observed[0].value, candidate)
  assert.equal(observed[1], previous)
  assert.deepEqual(storage.persisted(), initialSettings())
  assert.equal(storage.attempts, 2)
})

test('failed first save removes only the attempted key for each plugin source', () => {
  for (const source of ['builtin', 'installed', 'dev']) {
    const { store, storage } = fixture()
    const previous = store.getState().pluginSettings
    const originalError = new Error('Synthetic first save failure')
    storage.failWrite = () => originalError
    assert.throws(() => store.getState().setPluginSettings(source, 'new-plugin', candidate, 2), (error) => error === originalError)
    const current = store.getState().pluginSettings
    assert.equal(Object.hasOwn(current[source], 'new-plugin'), false)
    assert.equal(current.builtin.translate, previous.builtin.translate)
    for (const untouched of ['builtin', 'installed', 'dev'].filter((key) => key !== source)) {
      assert.equal(current[untouched], previous[untouched])
    }
    assert.deepEqual(plain(current), initialSettings())
    assert.deepEqual(storage.persisted(), initialSettings())
  }
})

test('rollback preserves other plugin and source saves made by a synchronous subscriber', () => {
  const { store, storage } = fixture()
  const previous = store.getState().getPluginSettings('builtin', 'translate')
  const originalError = new Error('Synthetic outer save failure')
  let nested = false
  let sameSourceRecord
  let otherSourceRecord
  store.subscribe((state) => {
    if (nested || state.pluginSettings.builtin.translate.value !== candidate) return
    nested = true
    state.setPluginSettings('builtin', 'other-plugin', { enabled: true }, 3)
    state.setPluginSettings('installed', 'translate', { glossary: 'installed synthetic terms' }, 4)
    sameSourceRecord = store.getState().pluginSettings.builtin['other-plugin']
    otherSourceRecord = store.getState().pluginSettings.installed.translate
  })
  storage.failWrite = (attempt) => attempt === 3 ? originalError : undefined
  assert.throws(() => store.getState().setPluginSettings('builtin', 'translate', candidate, 2), (error) => error === originalError)
  const current = store.getState().pluginSettings
  assert.equal(current.builtin.translate, previous)
  assert.equal(current.builtin['other-plugin'], sameSourceRecord)
  assert.equal(current.installed.translate, otherSourceRecord)
  assert.deepEqual(storage.persisted(), plain(current))
  assert.equal(storage.attempts, 4)
})

test('failed outer save cannot overwrite a newer same-plugin record from a synchronous subscriber', () => {
  const { store, storage } = fixture()
  const originalError = new Error('Synthetic superseded save failure')
  const newerValue = { glossary: 'newer synthetic terms' }
  let newerRecord
  store.subscribe((state) => {
    if (state.pluginSettings.builtin.translate.value !== candidate) return
    state.setPluginSettings('builtin', 'translate', newerValue, 3)
    newerRecord = store.getState().pluginSettings.builtin.translate
  })
  storage.failWrite = (attempt) => attempt === 2 ? originalError : undefined
  assert.throws(() => store.getState().setPluginSettings('builtin', 'translate', candidate, 2), (error) => error === originalError)
  assert.equal(store.getState().pluginSettings.builtin.translate, newerRecord)
  assert.deepEqual(storage.persisted().builtin.translate, { version: 3, value: newerValue })
  assert.equal(storage.attempts, 2, 'a superseded attempt must not trigger rollback persistence')
})

test('a new save during rollback notification survives a second persistence failure', () => {
  const { store, storage } = fixture()
  const previous = store.getState().getPluginSettings('builtin', 'translate')
  const originalError = new Error('Synthetic initial save failure')
  const rollbackError = new Error('Synthetic rollback persistence failure')
  const newerValue = { glossary: 'newer terms saved during rollback' }
  let newerRecord
  store.subscribe((state) => {
    if (state.pluginSettings.builtin.translate !== previous) return
    state.setPluginSettings('builtin', 'translate', newerValue, 3)
    newerRecord = store.getState().pluginSettings.builtin.translate
  })
  storage.failWrite = (attempt) => attempt === 1 ? originalError : attempt === 3 ? rollbackError : undefined
  assert.throws(() => store.getState().setPluginSettings('builtin', 'translate', candidate, 2), (error) => error === originalError)
  assert.equal(store.getState().pluginSettings.builtin.translate, newerRecord)
  assert.deepEqual(storage.persisted().builtin.translate, { version: 3, value: newerValue })
  assert.equal(storage.attempts, 3)
})
