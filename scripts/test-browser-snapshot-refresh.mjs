import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const settle = async () => { for (let i = 0; i < 16; i++) await Promise.resolve() }
function fixture() {
  const timers = new Map(), modules = new Map(), mocks = new Map()
  let timerId = 0
  const globals = { console, URL, AbortController, DOMException,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId },
    clearTimeout: id => timers.delete(id), window: { __TAURI_INTERNALS__: {} },
  }
  function load(path) {
    path = resolve(path)
    if (mocks.has(path)) return mocks.get(path)
    if (modules.has(path)) return modules.get(path).exports
    const module = { exports: {} }; modules.set(path, module)
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const require = spec => {
      if (mocks.has(spec)) return mocks.get(spec)
      assert.ok(spec.startsWith('.'), `Unexpected external import: ${spec}`)
      const base = resolve(dirname(path), spec)
      return load(existsSync(base) ? base : base + '.ts')
    }
    vm.runInNewContext(code, { ...globals, require, module, exports: module.exports }, { filename: path })
    return module.exports
  }
  return { load, mocks, async tick() { const batch = [...timers.values()]; timers.clear(); batch.forEach(fn => fn()); await settle() }, timers }
}

// Source notifications during a read invalidate its receipt and schedule one trailing read.
{
  const f = fixture(), commits = [], reads = []
  const { createBrowserIndexRefresh } = f.load('src/plugins/web-open/browserIndexRefresh.ts')
  const owner = createBrowserIndexRefresh(() => { const d = deferred(); reads.push(d); return d.promise }, x => commits.push(x))
  owner.request(); owner.request(); owner.request()
  assert.equal(f.timers.size, 1)
  await f.tick(); assert.equal(reads.length, 1)
  owner.request(); owner.request(); reads[0].resolve('old'); await settle()
  assert.deepEqual(commits, []); assert.equal(f.timers.size, 1)
  await f.tick(); reads[1].resolve('new'); await settle()
  assert.deepEqual(commits, ['new'])
  owner.request(); await f.tick(); owner.stop(); reads[2].resolve('after stop'); await settle()
  assert.deepEqual(commits, ['new']); assert.equal(f.timers.size, 0)
}

// Real provider + real registry: notifications, empty deletion, unchanged heartbeat,
// replacement owner and late native reads. No browser or network access.
{
  const f = fixture(), reads = []
  const registry = f.load('src/workspace/desktopTargets/registry.ts')
  const sdk = { desktopTargets: {
    registerProvider: registry.registerDesktopTargetProvider,
    unregisterProvider: registry.unregisterDesktopTargetProvider,
    bridge: {
      invalidateCache() {}, status: async () => ({ running: true, sources: [{ sourceId: 'browser.chromium', fresh: true }] }),
      listTargets: () => { const d = deferred(); reads.push(d); return d.promise }, listHistory: async () => [],
    },
  } }
  f.mocks.set('@hiven/plugin', { getPluginHostSdk: () => sdk, searchableFieldsMatch: (fields, q) => [fields.title, ...fields.aliases].some(x => x?.toLowerCase().includes(q)) })
  const { registerChromiumTabsProvider } = f.load('src/plugins/web-open/browserProvider.ts')
  const ctx = { surfaceId: 'global-launcher', query: 'probe', locale: 'en' }
  const target = { id: '1', sourceId: 'browser.chromium', kind: 'tab', title: 'probe', subtitle: 'https://example.test/old', url: 'https://example.test/old' }
  const a = registerChromiumTabsProvider(); a.refresh(); await f.tick()
  const providerA = registry.listDesktopTargetProviders()[0]
  reads[0].resolve([target]); await settle()
  assert.equal((await providerA.list(ctx))[0].meta.url, target.url)
  const version = registry.getDesktopTargetsVersion()
  a.refresh(); await f.tick(); reads[1].resolve([target]); await settle()
  assert.equal(registry.getDesktopTargetsVersion(), version, 'identical heartbeat does not rerank')
  a.refresh(); await f.tick()
  const b = registerChromiumTabsProvider(); b.refresh(); await f.tick()
  const providerB = registry.listDesktopTargetProviders()[0]
  reads[3].resolve([{ ...target, url: 'https://example.test/new' }]); await settle()
  reads[2].resolve([target]); a.stop(); await settle()
  assert.equal(registry.listDesktopTargetProviders()[0], providerB)
  assert.equal((await providerB.list(ctx))[0].meta.url, 'https://example.test/new')
  assert.equal((await providerA.list(ctx)).length, 0)
  b.refresh(); await f.tick(); reads[4].resolve([]); await settle()
  assert.equal((await providerB.list(ctx)).length, 0, 'empty snapshot clears cached rows')
  b.stop(); assert.equal(registry.listDesktopTargetProviders().length, 0)
}

// An invalidated in-flight IPC receipt cannot repopulate the shared host TTL cache.
{
  const f = fixture(), replies = []
  f.mocks.set('@tauri-apps/api/core', { invoke: () => { const d = deferred(); replies.push(d); return d.promise } })
  f.mocks.set(resolve('src/workspace/searchRanking.ts'), { searchableFieldsMatch() {} })
  const bridge = f.load('src/workspace/desktopControl/bridgeTargets.ts')
  const first = bridge.listDesktopBridgeTargets('browser.chromium')
  bridge.invalidateDesktopBridgeListCache()
  const second = bridge.listDesktopBridgeTargets('browser.chromium')
  replies[1].resolve(['new']); await second; replies[0].resolve(['old']); await first
  assert.equal((await bridge.listDesktopBridgeTargets('browser.chromium'))[0], 'new')
  assert.equal(replies.length, 2)
}
console.log('Browser snapshot owner, coalescing, deletion and stale receipt behavior passed.')

// The actual manager aborts an owner synchronously, even before start returns cleanup.
{
  const f = fixture(), contexts = [], pending = [], cleanup = []
  const definition = { background: { start(ctx) { contexts.push(ctx); const d = deferred(); pending.push(d); return d.promise } } }
  const mock = (path, value) => f.mocks.set(resolve('src/' + path + '.ts'), value)
  mock('workspace/pluginRegistry', { pluginRegistry: { getAllPluginDefinitions: () => [{ pluginId: 'synthetic', source: 'production', definition, permissions: [] }] } })
  mock('workspace/pluginSettingsStore', { resolvePluginSettings: () => ({ value: {} }), usePluginSettingsStore: {} })
  mock('workspace/pluginPermissions', { getPluginPermissionSnapshot: () => ({}), missingPluginPermissions: () => [], usePluginPermissionStore: {} })
  mock('workspace/launcher/pluginSource', { resolvePluginSettingsSource: () => 'builtin' })
  mock('store', { useAppStore: { getState: () => ({ locale: 'en' }) } })
  mock('i18n/pluginI18nRegistry', { makePluginT: () => key => key })
  mock('workspace/toast', { showToast() {} })
  for (const [file, name] of [['pluginStorage', 'createPluginPrivateStorage'], ['pluginClipboard','createPluginClipboard'], ['pluginPaste','createPluginPaste'], ['pluginNetwork','createPluginNetwork'], ['pluginShell','createPluginShell'], ['ai/runtime','createPluginAi']]) mock('workspace/' + file, { [name]: () => ({}) })
  const manager = f.load('src/workspace/pluginBackgroundManager.ts')
  manager.initializePluginBackgrounds(); await settle()
  assert.equal(contexts.length, 1)
  const replacement = manager.restartPluginBackground('synthetic'); await settle()
  assert.equal(contexts[0].signal.aborted, true)
  assert.equal(contexts[1].signal.aborted, false)
  pending[0].resolve(() => cleanup.push('old')); await settle()
  assert.deepEqual(cleanup, ['old'])
  await manager.stopAllPluginBackgrounds()
  assert.equal(contexts[1].signal.aborted, true)
  pending[1].resolve(() => cleanup.push('new')); await replacement; await settle()
  assert.deepEqual(cleanup, ['old','new'])
}

// Run the actual plugin background contribution with delayed subscription delivery.
{
  const source = readFileSync('src/plugins/web-open/index.tsx', 'utf8')
  const start = source.indexOf('  background: {') + '  background: '.length
  const end = source.indexOf('\n  hooks: {', start)
  const backgroundSource = source.slice(start, end).replace(/,\s*$/, '')
  const replies = [], handlers = [], removed = [], indexes = []
  const globals = {
    pushChromiumBridgeConfig() {}, normalizeBrowserTabsSettings: value => value,
    CHROMIUM_SOURCE_ID: 'browser.chromium',
    importBrowserQueryHistory() { throw Error('Unexpected history import') },
    registerChromiumTabsProvider() { const index = { refreshes: 0, stopped: false, refresh() { this.refreshes++ }, stop() { this.stopped = true } }; indexes.push(index); return index },
    getPluginHostSdk: () => ({ events: { subscribe(type, handler) { handlers.push(handler); const d = deferred(); replies.push(d); return d.promise } } }),
  }
  const code = ts.transpileModule('module.exports = ' + backgroundSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }; vm.runInNewContext(code, { ...globals, module })
  const controller = new AbortController()
  const result = module.exports.start({ signal: controller.signal, settings: { enabled: true, browser: { enabled: true } } })
  controller.abort()
  assert.equal(indexes[0].stopped, true)
  handlers[0]({ source: { channel: 'browser.chromium' } })
  assert.equal(indexes[0].refreshes, 0)
  replies[0].resolve(() => removed.push(0)); await result
  assert.deepEqual(removed, [0]); assert.equal(replies.length, 1)
}
console.log('Background replacement and pending subscription cancellation passed.')

// Invalidation is data-free; partial native listener setup is cleaned up and retryable.
{
  const f = fixture(), native = new Map(), calls = []
  let failEvents = true
  f.mocks.set('@tauri-apps/api/event', { async listen(name, handler) {
    if (name.endsWith('-events') && failEvents) throw Error('synthetic subscription failure')
    native.set(name, handler); return () => native.delete(name)
  } })
  const { hivenEventBus: events } = f.load('src/workspace/hostEventBus.ts')
  await assert.rejects(events.subscribe('browser.snapshot', () => calls.push('failed subscriber')))
  assert.equal(native.size, 0)
  failEvents = false
  const stop = await events.subscribe('browser.snapshot', event => calls.push(event))
  native.get('hiven://browser-bridge-snapshot')({ payload: { sourceId: 'browser.chromium', url: 'must-not-be-forwarded' } })
  assert.equal(calls.length, 1); assert.equal(calls[0].source.channel, 'browser.chromium')
  assert.equal(Object.keys(calls[0].payload).length, 0)
  stop(); native.get('hiven://browser-bridge-snapshot')({ payload: { sourceId: 'browser.chromium' } })
  assert.equal(calls.length, 1)
}

// An already queued host partial cannot commit after the collector was aborted.
{
  const source = readFileSync('src/workspace/launcher/useLauncherSession.ts', 'utf8')
  const start = source.indexOf('function useFrameBatchedLauncherItems()')
  const end = source.indexOf('\nexport function useLauncherSession', start)
  const module = { exports: {} }, frames = new Map(), commits = []
  let state = { inputIdentity: null, items: [] }, id = 0
  const code = ts.transpileModule(source.slice(start, end) + '\nmodule.exports = useFrameBatchedLauncherItems', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module,
    useState: () => [state, next => { state = next(state); commits.push(state) }],
    useRef: value => ({ current: value }), useCallback: cb => cb, useEffect() {},
    requestAnimationFrame: cb => { frames.set(++id, cb); return id }, cancelAnimationFrame: n => frames.delete(n),
  })
  const [, , , queue] = module.exports()
  const old = new AbortController()
  queue(['old'], 'same-query', () => !old.signal.aborted)
  old.abort(); frames.get(1)(); assert.equal(commits.length, 0)
  queue(['new'], 'same-query', () => true); frames.get(2)()
  assert.equal(commits[0].items[0], 'new')
}
console.log('Host event setup and queued partial cancellation passed.')
