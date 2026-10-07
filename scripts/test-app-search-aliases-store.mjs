#!/usr/bin/env node
// Actual store + Zustand in isolated JS windows. No browser, server, network or user storage.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const compiled = new Map()
const plain = (value) => JSON.parse(JSON.stringify(value))
const appId = 'macos:bundle:com.example.Notes'
const secondId = 'macos:bundle:com.example.Chat'
let passed = 0
function check(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { error.message = `${name}: ${error.message}`; throw error }
}

function sharedStorage(initial) {
  const values = new Map()
  if (initial !== undefined) values.set('hiven-settings', JSON.stringify({ state: initial, version: 0 }))
  const storage = {
    writes: 0, failReads: false, failWrites: false,
    getItem(key) { if (storage.failReads) throw new Error('Synthetic storage read failure'); return values.get(key) ?? null },
    setItem(key, value) {
      if (storage.failWrites) throw new Error('Synthetic storage write failure')
      storage.writes++; values.set(key, String(value))
    },
    removeItem(key) { values.delete(key) },
    clear() { values.clear() },
    persisted() { return JSON.parse(storage.getItem('hiven-settings'))?.state },
  }
  return storage
}

function windowStore(storage, { unavailable = false } = {}) {
  const listeners = new Map()
  const window = {
    get localStorage() { if (unavailable) throw new Error('Synthetic unavailable storage'); return storage },
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(callback)
    },
  }
  const context = createContext({ window, localStorage: storage, AbortController, console })
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
      // Unused I/O boundaries throw if accidentally reached; tested store/helpers are real.
      if (specifier === '@tauri-apps/api/core') return { invoke() { throw new Error('Native calls forbidden in pure tests') } }
      if (specifier === '../effectRunner') return { openExternalUrl() { throw new Error('URL opening forbidden in pure tests') } }
      if (specifier === '../../i18n') return { pickLocale() { throw new Error('Unrelated localized UI is outside this test') } }
      if (specifier === 'react') return require(specifier)
      if (specifier.startsWith('zustand')) return load(require.resolve(specifier))
      assert.ok(specifier.startsWith('.'), `Unexpected module: ${specifier}`)
      const base = resolve(dirname(file), specifier)
      const target = [base, `${base}.ts`, `${base}.js`, resolve(base, 'index.ts')].find(existsSync)
      assert.ok(target, `Unresolved module: ${specifier}`)
      return load(target)
    }
    new Script(`(function(require,module,exports){${compiled.get(file)}\n})`, { filename: file })
      .runInContext(context)(scopedRequire, module, module.exports)
    return module.exports
  }
  const exported = load(resolve(root, 'src/store.ts'))
  const helpers = load(resolve(root, 'src/workspace/appLauncher/appSearchAliases.ts'))
  let hydrations = 0
  exported.useAppStore.persist?.onHydrate(() => hydrations++)
  return {
    ...exported, ...helpers,
    state: () => exported.useAppStore.getState(),
    get hydrations() { return hydrations },
    event(key = 'hiven-settings') {
      for (const callback of listeners.get('storage') ?? []) callback({ key, storageArea: storage })
    },
  }
}

const storage = sharedStorage()
const A = windowStore(storage)
const { parseAppSearchAliasInput: parse, normalizeAppSearchAliases: normalize, getAppSearchAliases: names } = A

check('fresh and legacy settings have no user aliases', () => {
  assert.deepEqual(plain(A.state().settings.appSearchAliases), {})
  const legacy = windowStore(sharedStorage({ settings: { theme: 'light' } }))
  assert.deepEqual(plain(legacy.state().settings.appSearchAliases), {})
  assert.equal(legacy.state().settings.theme, 'light')
})

check('parse accepts human multilingual names, trims and deduplicates case', () => {
  assert.deepEqual(plain(parse('  写作\nNOTES\r\nnotes\n 工作 📝 \n')), { ok: true, aliases: ['写作', 'NOTES', '工作 📝'] })
  assert.deepEqual(plain(parse(' \n\r\n ')), { ok: true, aliases: [] })
  assert.equal(parse('📝'.repeat(80)).ok, true)
  assert.deepEqual(plain(parse('a'.repeat(81))), { ok: false, reason: 'too-long' })
  assert.deepEqual(plain(parse(Array.from({ length: 11 }, (_, i) => `alias ${i}`).join('\n'))), { ok: false, reason: 'too-many' })
  assert.equal(parse(Array(15).fill('same').join('\n')).ok, true)
})

check('explicit aliases reject paths, URLs, internal ids and controls', () => {
  for (const value of ['macos:bundle:com.apple.Notes', 'linux:firefox.desktop', 'host:app-launcher:app:x',
    '/Applications/Notes.app', '~/Applications/Notes.app', './Notes', 'folder/Notes', 'C:\\Apps\\Notes.exe',
    'https://example.com', 'mailto:a@example.com', 'file:///tmp/x', 'com.apple.Notes', 'Notes.app',
    'Notes.exe', 'firefox.desktop', 'bad\0name', 'bad\tname', 'name\u007f', 'name\u0085']) {
    assert.deepEqual(plain(parse(value)), { ok: false, reason: 'invalid' }, JSON.stringify(value))
  }
  assert.equal(parse('Research & writing').ok, true, 'search metadata does not use a shell parser')
})

check('normalization rejects malformed rows and prototype keys without invoking getters', () => {
  for (const value of [null, undefined, [], 'wrong', 7]) assert.deepEqual(plain(normalize(value)), {})
  const raw = JSON.parse('{"__proto__":["bad"],"constructor":["bad"],"prototype":["bad"],"empty":[],"invalid":false}')
  raw[appId] = [' 写作 ', 'WRITING', 'writing', null, 7, '/tmp/file', 'too long '.repeat(20)]
  raw[secondId] = ['写作']
  raw.tooMany = Array.from({ length: 12 }, (_, i) => `alias ${i}`)
  Object.defineProperty(raw, 'getter', { enumerable: true, get() { throw new Error('Must not execute getters') } })
  const result = normalize(raw)
  assert.deepEqual(plain(result[appId]), ['写作', 'WRITING'])
  assert.deepEqual(plain(result[secondId]), ['写作'])
  assert.equal(result.tooMany.length, 10)
  for (const key of ['__proto__', 'constructor', 'prototype', 'empty', 'invalid', 'getter']) assert.equal(Object.hasOwn(result, key), false)
  assert.equal(Object.hasOwn({}, 'polluted'), false)
})

check('human search names merge aliases without changing app identity or discovery data', () => {
  const app = Object.freeze({ appId, name: 'Notes', nameI18n: Object.freeze({ zh: '备忘录' }),
    aliases: Object.freeze(['notes', 'Apple Notes', '/Applications/Notes.app', 'macos:bundle:x']),
    platform: 'macos', source: 'applications', displayPath: '/Applications/Notes.app' })
  const before = JSON.stringify(app)
  assert.deepEqual(plain(names(app, { [appId]: ['写作', 'Apple Notes'], missing: ['ghost'] })), ['Notes', '备忘录', 'Apple Notes', '写作'])
  assert.equal(JSON.stringify(app), before)
  assert.deepEqual(plain(names(app, {})), ['Notes', '备忘录', 'Apple Notes'])
})

check('explicit save survives a new isolated window', () => {
  A.state().setAppSearchAliases(appId, [' 写作 ', 'NOTES', 'notes'])
  assert.deepEqual(plain(storage.persisted().settings.appSearchAliases), { [appId]: ['写作', 'NOTES'] })
})
const B = windowStore(storage)
check('separate store instances share only persisted aliases', () => {
  assert.notEqual(A.useAppStore, B.useAppStore)
  assert.deepEqual(plain(B.state().settings.appSearchAliases), { [appId]: ['写作', 'NOTES'] })
  B.state().setAppSearchAliases(appId, ['新名字'])
  assert.deepEqual(plain(A.state().settings.appSearchAliases[appId]), ['写作', 'NOTES'])
  A.state().updateSetting('fontSize', 17)
  assert.deepEqual(plain(storage.persisted().settings.appSearchAliases), { [appId]: ['新名字'] })
})

check('alias changes sync once without storage echo or unrelated-event hydration', () => {
  const writes = storage.writes
  A.event('unrelated-key')
  assert.equal(A.hydrations, 0)
  A.event()
  assert.equal(A.hydrations, 1)
  assert.deepEqual(plain(A.state().settings.appSearchAliases[appId]), ['新名字'])
  A.event()
  assert.equal(A.hydrations, 1)
  assert.equal(storage.writes, writes)
})

check('stale per-app edits preserve the latest edits for other apps', () => {
  B.state().setAppSearchAliases(secondId, ['沟通'])
  A.state().setAppSearchAliases(appId, ['沟通'])
  assert.deepEqual(plain(storage.persisted().settings.appSearchAliases), { [appId]: ['沟通'], [secondId]: ['沟通'] })
  B.event()
  assert.deepEqual(plain(B.state().settings.appSearchAliases), { [appId]: ['沟通'], [secondId]: ['沟通'] })
})

check('clearing deletes one key and stale unrelated writes cannot revive it', () => {
  B.state().setAppSearchAliases(appId, [])
  A.state().updateSetting('theme', 'light')
  assert.deepEqual(plain(storage.persisted().settings.appSearchAliases), { [secondId]: ['沟通'] })
  A.event()
  assert.deepEqual(plain(A.state().settings.appSearchAliases), { [secondId]: ['沟通'] })
})

check('removing all settings or legacy settings cannot revive stale aliases', () => {
  for (const operation of ['remove', 'clear', 'legacy']) {
    A.state().setAppSearchAliases(appId, ['写作'])
    if (operation === 'clear') storage.clear()
    else if (operation === 'remove') storage.removeItem('hiven-settings')
    else storage.setItem('hiven-settings', JSON.stringify({ state: { settings: { theme: 'dark' } }, version: 0 }))
    A.state().updateSetting('fontSize', 15)
    assert.deepEqual(plain(storage.persisted().settings.appSearchAliases), {})
    A.event(operation === 'clear' ? null : 'hiven-settings')
    assert.deepEqual(plain(A.state().settings.appSearchAliases), {})
  }
})

check('save and clear failures throw and roll back memory without reporting success', () => {
  A.state().setAppSearchAliases(appId, ['保存过的名字'])
  const before = storage.getItem('hiven-settings')
  storage.failWrites = true
  for (const aliases of [['未保存名字'], []]) {
    assert.throws(() => A.state().setAppSearchAliases(appId, aliases), /Synthetic storage write failure/)
    assert.deepEqual(plain(A.state().settings.appSearchAliases), { [appId]: ['保存过的名字'] })
    assert.equal(storage.getItem('hiven-settings'), before)
  }
  storage.failWrites = false
  storage.failReads = true
  assert.throws(() => A.state().setAppSearchAliases(appId, ['不能读取']), /Synthetic storage read failure/)
  assert.deepEqual(plain(A.state().settings.appSearchAliases), { [appId]: ['保存过的名字'] })
  storage.failReads = false
  A.state().setAppSearchAliases(appId, ['重试成功'])
  assert.deepEqual(plain(storage.persisted().settings.appSearchAliases[appId]), ['重试成功'])
})

check('invalid explicit saves leave memory and persistence untouched', () => {
  const before = storage.getItem('hiven-settings')
  const inMemory = A.state().settings.appSearchAliases
  for (const [key, aliases] of [['__proto__', ['x']], ['constructor', []], ['', ['x']], [appId, ['/tmp/name']],
    [appId, ['first\nsecond']], [appId, [null]], [appId, ['x'.repeat(81)]]]) {
    assert.throws(() => A.state().setAppSearchAliases(key, aliases), /Invalid application search aliases/)
  }
  assert.throws(() => A.state().updateSetting('appSearchAliases', {}), /setAppSearchAliases/)
  assert.equal(A.state().settings.appSearchAliases, inMemory)
  assert.equal(storage.getItem('hiven-settings'), before)
})

check('unavailable storage does not silently accept a save', () => {
  const unavailable = windowStore(sharedStorage(), { unavailable: true })
  assert.throws(() => unavailable.state().setAppSearchAliases(appId, ['名字']), /storage is unavailable/)
  assert.deepEqual(plain(unavailable.state().settings.appSearchAliases), {})
})

check('manual shortcuts, favorites and learning preference survive alias edits', () => {
  A.state().setAppHotkey({ appId, name: 'Notes', accelerator: 'Cmd+Shift+N' })
  A.state().toggleLauncherFavorite('manual:favorite')
  A.state().saveActionParams('manual:action', { separator: ', ' })
  A.state().updateSetting('automaticLearningEnabled', true)
  const before = plain({ hotkeys: A.state().settings.appHotkeys, favorites: A.state().launcherFavoriteKeys,
    params: A.state().savedActionParams, learning: A.state().settings.automaticLearningEnabled })
  A.state().setAppSearchAliases(appId, ['新的名字'])
  A.state().setAppSearchAliases(appId, [])
  assert.deepEqual(plain({ hotkeys: A.state().settings.appHotkeys, favorites: A.state().launcherFavoriteKeys,
    params: A.state().savedActionParams, learning: A.state().settings.automaticLearningEnabled }), before)
})

check('alias sync preserves local runtime status for unchanged shortcut definitions', () => {
  A.state().updateSetting('globalPinnedLauncherShortcut', {
    kind: 'accelerator', accelerator: 'Cmd+Shift+Space', registrationStatus: 'registered',
  })
  A.state().updateSetting('quickEditorShortcut', {
    kind: 'double-modifier', modifier: 'Option', registrationStatus: 'error', registrationError: 'Synthetic conflict',
  })
  const launcherShortcut = A.state().settings.globalPinnedLauncherShortcut
  const editorShortcut = A.state().settings.quickEditorShortcut
  const C = windowStore(storage)
  assert.equal(C.state().settings.globalPinnedLauncherShortcut.registrationStatus, undefined)
  C.state().setAppSearchAliases(appId, ['从另一窗口保存'])
  const writes = storage.writes
  A.event()
  assert.equal(A.state().settings.globalPinnedLauncherShortcut, launcherShortcut)
  assert.equal(A.state().settings.quickEditorShortcut, editorShortcut)
  assert.equal(storage.writes, writes)
  assert.equal(storage.persisted().settings.globalPinnedLauncherShortcut.registrationStatus, undefined)
  assert.equal(storage.persisted().settings.quickEditorShortcut.registrationError, undefined)
})

check('changed shortcut definitions cannot inherit an old runtime success or error', () => {
  const C = windowStore(storage)
  C.state().updateSetting('globalPinnedLauncherShortcut', { kind: 'accelerator', accelerator: 'Cmd+Option+Space' })
  C.state().updateSetting('quickEditorShortcut', { kind: 'double-modifier', modifier: 'Command' })
  C.state().setAppSearchAliases(appId, ['让别名触发同步'])
  A.event()
  assert.deepEqual(plain(A.state().settings.globalPinnedLauncherShortcut), { kind: 'accelerator', accelerator: 'Cmd+Option+Space' })
  assert.deepEqual(plain(A.state().settings.quickEditorShortcut), { kind: 'double-modifier', modifier: 'Command' })
})

console.log(`App search aliases: ${passed} pure/store cases passed`)
