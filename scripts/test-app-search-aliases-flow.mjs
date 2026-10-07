#!/usr/bin/env node
// Real store/Zustand persistence, catalog, app provider, search and ranker.
// In-memory storage and synthetic native IPC only: no browser, server or app launch.
// Persistence races/failure modes are covered separately by the store regression.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { persist, createJSONStorage } = require('zustand/middleware')
const plain = (value) => JSON.parse(JSON.stringify(value))
const indexKey = 'hiven:host-app-launcher:index:v2'
const settingsKey = 'hiven-settings'
const catalog = [
  { appId: 'macos:bundle:org.example.SyntheticCalendar', name: 'Synthetic Calendar', nameI18n: { zh: '合成日历' }, aliases: ['Synthetic Cal'], platform: 'macos', source: 'applications', displayPath: '/Applications/Synthetic Calendar.app' },
  { appId: 'windows:start-menu:synthetic-notes', name: 'Synthetic Notes', platform: 'windows', source: 'start-menu', displayPath: 'C:\\Synthetic\\Notes.lnk' },
  { appId: 'linux:desktop-entry:synthetic-terminal.desktop', name: 'Synthetic Terminal', platform: 'linux', source: 'desktop-entry', displayPath: '/synthetic/terminal.desktop' },
]
const values = new Map([[indexKey, JSON.stringify({ version: 1, refreshedAt: Date.now(), apps: catalog })]])
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
}
let currentCatalog = catalog
const calls = []
const native = {
  async invoke(command, payload) {
    calls.push({ command, payload: payload && plain(payload) })
    if (command === 'discover_installed_apps') return plain(currentCatalog)
    assert.equal(command, 'launch_installed_app', 'unexpected native command')
    assert.deepEqual(Object.keys(payload), ['appId'], 'launch payload contains only the original app identity')
    assert.ok(catalog.some((app) => app.appId === payload.appId), 'only a synthetic catalog app can be launched')
  },
}

function fixture() {
  const modules = new Map()
  const listeners = new Map()
  const window = {
    localStorage: storage, __TAURI_INTERNALS__: {},
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(callback)
    },
    dispatchEvent(event) { for (const callback of listeners.get(event.type) ?? []) callback(event) },
  }
  function load(path) {
    path = resolve(path)
    if (modules.has(path)) return modules.get(path)
    const exports = {}
    modules.set(path, exports)
    const output = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText
    vm.runInNewContext(output, {
      exports, module: { exports }, console, Error, Date, Set, Map, WeakMap, Promise,
      AbortController, setTimeout, clearTimeout, window, localStorage: storage,
      require(id) {
        if (id === 'zustand' || id === 'pinyin-pro') return require(id)
        if (id === 'zustand/middleware') return {
          persist: (initializer, options) => persist(initializer, { ...options, storage: createJSONStorage(() => storage) }),
        }
        if (id === '@tauri-apps/api/core') return native
        if (path.endsWith('/launcher/persistableRecents.ts') && id === '../../i18n') return { pickLocale: (locale) => locale }
        if (path.endsWith('/launcher/persistableRecents.ts') && id === '../effectRunner') return { openExternalUrl() { assert.fail('No external navigation in this test') } }
        if (path.endsWith('/appLauncher/hostAppLauncher.ts') && id === '../launcher/perf') return { launcherPerfNow: () => 0, logLauncherPerfDuration() {} }
        if (path.endsWith('/appLauncher/hostAppLauncher.ts') && id === './appLaunchError') return { rethrowAppLaunchError(error) { throw error } }
        assert.ok(id.startsWith('.'), `Unexpected external module ${id} from ${path}`)
        const base = resolve(dirname(path), id)
        const target = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((candidate) => /\.[mc]?[jt]sx?$/.test(candidate) && existsSync(candidate))
        assert.ok(target, `Missing source ${id} from ${path}`)
        return load(target)
      },
    }, { filename: path })
    return exports
  }
  const store = load('src/store.ts').useAppStore
  const host = load('src/workspace/appLauncher/hostAppLauncher.ts')
  const ranker = load('src/workspace/launcher/ranking.ts')
  const search = load('src/workspace/searchRanking.ts')
  const aliasHelpers = load('src/workspace/appLauncher/appSearchAliases.ts')
  return { store, host, ranker, search, aliasHelpers, window }
}

const A = fixture()
const keyFor = (app) => `host:app-launcher:app:${app.appId}`
const appIds = (items) => plain(items.map((item) => item.systemKey.slice('host:app-launcher:app:'.length))).sort()
async function results(f, query, locale = 'zh') {
  const provider = await f.host.getHostAppLauncherDynamicItems({ query, locale, surfaceId: 'global-launcher' })
  const state = f.store.getState()
  const ranked = f.ranker.rankLauncherItems({ query, locale, surfaceId: 'global-launcher', usage: state.launcherUsageBySurface, favoriteKeys: state.launcherFavoriteKeys, now: Date.now() }, provider)
  const objects = f.host.getHostAppWorkObjects(query, locale)
  // The settings picker uses these same real helper/search modules without appId/path fields.
  const picker = currentCatalog.filter((app) => f.search.searchableFieldsMatch({
    id: '', title: app.name, titleI18n: app.nameI18n,
    aliases: f.aliasHelpers.getAppSearchAliases(app, state.settings.appSearchAliases),
  }, query, locale))
  return { provider, ranked, objects, picker }
}
async function expectMatches(query, expected, f = A) {
  for (const locale of ['en', 'zh']) {
    const actual = await results(f, query, locale)
    const ids = [...expected].sort()
    assert.deepEqual(appIds(actual.provider), ids, `provider: ${query} (${locale})`)
    assert.deepEqual(appIds(actual.ranked), ids, `ranker: ${query} (${locale})`)
    assert.deepEqual(plain(actual.objects.map((object) => object.bundleId)).sort(), ids, `objects: ${query} (${locale})`)
    assert.deepEqual(actual.picker.map((app) => app.appId).sort(), ids, `picker fields: ${query} (${locale})`)
  }
}
const setAliases = (app, aliases) => A.store.getState().setAppSearchAliases(app.appId, aliases)
const preserved = () => JSON.stringify({
  favorites: A.store.getState().launcherFavoriteKeys,
  usage: A.store.getState().launcherUsageBySurface,
  hotkeys: A.store.getState().settings.appHotkeys,
})

A.store.getState().toggleLauncherFavorite(keyFor(catalog[0]))
for (let i = 0; i < 100; i++) A.store.getState().recordLauncherSelection('global-launcher', keyFor(catalog[0]))
A.store.getState().setAppHotkey({ appId: catalog[0].appId, name: catalog[0].name, accelerator: 'Ctrl+Shift+C', enabled: false })
const originalState = preserved()
const originalCatalog = storage.getItem(indexKey)
await expectMatches('我的日程', [])
await expectMatches('合成日历', [catalog[0].appId])
await expectMatches('hcrl', [catalog[0].appId])
setAliases(catalog[0], ['我的日程', 'Work Board'])
await expectMatches('我的日程', [catalog[0].appId])
await expectMatches('wode richeng', [catalog[0].appId])
await expectMatches('  WORK BOARD  ', [catalog[0].appId])
assert.deepEqual(JSON.parse(storage.getItem(settingsKey)).state.settings.appSearchAliases[catalog[0].appId], ['我的日程', 'Work Board'])
const B = fixture()
await expectMatches('我的日程', [catalog[0].appId], B)
setAliases(catalog[0], ['新的日程'])
await expectMatches('我的日程', [])
await expectMatches('新的日程', [catalog[0].appId])
B.window.dispatchEvent({ type: 'storage', key: settingsKey })
await expectMatches('我的日程', [], B)
await expectMatches('新的日程', [catalog[0].appId], B)
setAliases(catalog[0], [])
await expectMatches('新的日程', [])
assert.equal(Object.hasOwn(A.store.getState().settings.appSearchAliases, catalog[0].appId), false)
await expectMatches('合成日历', [catalog[0].appId])
console.log('PASS saved aliases: add, case/whitespace/pinyin, reload, rename, cross-window current query, clear, original name')

setAliases(catalog[0], ['工作台'])
setAliases(catalog[1], ['工作台'])
await expectMatches('工作台', [catalog[0].appId, catalog[1].appId])
assert.equal((await results(A, '')).provider.length, catalog.length)
assert.equal(storage.getItem(indexKey), originalCatalog, 'user aliases never rewrite the discovery cache or merge catalog identities')
assert.equal(A.host.resolveInstalledAppIdByName('工作台'), undefined, 'a user search name cannot identify an OS process owner')
assert.equal(A.host.resolveInstalledAppIdByName('Synthetic Cal'), catalog[0].appId)
assert.equal(preserved(), originalState, 'alias edits preserve usage, pins and disabled hotkeys')
console.log('PASS collision: two apps sharing one alias stay distinct; catalog, OS owner resolution, usage, pins and disabled hotkeys unchanged')

for (const query of [catalog[0].appId, keyFor(catalog[0]), catalog[0].displayPath, catalog[1].displayPath, catalog[2].displayPath]) {
  await expectMatches(query, [])
  assert.throws(() => setAliases(catalog[0], [query]), 'internal ids and paths cannot be saved as aliases')
}
for (const surfaceId of ['command-palette', 'editor-command-bar', 'quick-editor-command']) {
  assert.equal((await A.host.getHostAppLauncherDynamicItems({ query: '工作台', locale: 'zh', surfaceId })).length, 0)
}
assert.equal(calls.length, 0, 'search, settings and hydration make no native calls')
for (const [i, app] of catalog.entries()) {
  const alias = `echo synthetic ${i}`
  setAliases(app, [alias])
  const [item] = (await results(A, alias)).ranked
  assert.equal(item.systemKey, keyFor(app))
  assert.deepEqual(plain(item.requiredCapabilities), ['app-search'])
  assert.deepEqual(plain(item.surfaces), ['global-launcher'])
  assert.equal((await item.execute()).ok, true)
  assert.deepEqual(calls.at(-1), { command: 'launch_installed_app', payload: { appId: app.appId } }, 'command-like alias remains inert human text')
}
assert.equal(preserved(), originalState, 'provider execution itself cannot change selection bookkeeping')
console.log('PASS boundaries: path/internal id rejection, surface/capability contract, inert command-like aliases, original macOS/Windows/Linux appId launch payloads')

currentCatalog = catalog.slice(1)
const refresh = A.host.getHostAppLauncherStaticItems().find((item) => item.systemKey === 'host:app-launcher:refresh')
assert.equal((await refresh.execute()).ok, true)
assert.equal(calls.at(-1).command, 'discover_installed_apps', 'refresh uses only the synthetic native discovery stub')
await expectMatches('echo synthetic 0', [])
await expectMatches('合成日历', [])
assert.ok(Object.hasOwn(A.store.getState().settings.appSearchAliases, catalog[0].appId), 'retained orphan metadata does not create an app')
assert.equal((await results(A, '')).provider.length, currentCatalog.length)
await expectMatches('echo synthetic 1', [catalog[1].appId])
console.log('PASS catalog refresh: removed app stays absent despite saved alias; surviving apps remain searchable')
console.log('app search alias flow passed; all storage/catalog data synthetic, all native calls intercepted')
