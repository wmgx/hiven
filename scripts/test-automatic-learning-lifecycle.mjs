#!/usr/bin/env node
// Exercise real learning modules against controlled external IO and late completion.
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
import ts from 'typescript'

function load(path, deps = {}, globals = {}) {
  const source = fs.readFileSync(path, 'utf8')
  const code = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText
  const exports = {}
  const context = {
    exports, module: {exports}, require: (name) => {
      if (!(name in deps)) throw new Error(`${path}: unexpected dependency ${name}`)
      return deps[name]
    }, console, AbortController, Date, Map, Set, URL, setTimeout, clearTimeout, setInterval, clearInterval, ...globals,
  }
  vm.runInNewContext(code, context, {filename: path})
  return context.module.exports
}
const root = 'src/workspace/learning/'
const features = load(root + 'features.ts')
const urlTemplate = load(root + 'urlTemplate.ts')
const frecency = load(root + 'frecency.ts')
const telemetry = {TelemetryEvents: {}, trackPerf() {}, trackBehavior() {}, trackLatency() {}, telemetryNow: () => 0}
const flush = async () => {for (let i = 0; i < 12; i++) await Promise.resolve()}
const deferred = () => {let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}}
let passed = 0
async function check(name, body) {
  try {await body(); console.log('PASS ' + name); passed++}
  catch (error) {console.log('FAIL ' + name + ': ' + error.stack); process.exitCode = 1}
}
function navHarness(bridge) {
  const writes = [], cache = [], timers = new Map(); let id = 0
  const parent = new AbortController()
  const module = load(root + 'navigationSensor.ts', {
    '../../store': {getAutomaticLearningSignal: () => parent.signal},
    '../desktopControl/bridgeTargets': bridge,
    '../telemetry': telemetry,
    './observer': {getRecentClipboardTokensWithSource: () => [], setCurrentSourceHost: host => cache.push(host)},
    './store': {putNavigation: (value, signal) => writes.push({kind: 'nav', value, signal}), putPathObservation: (value, signal) => writes.push({kind: 'path', value, signal}), saltedHash: value => value},
    './urlTemplate': urlTemplate,
  }, {window: {__TAURI_INTERNALS__: {}, setInterval: (fn) => {timers.set(++id, fn); return id}, clearInterval: id => timers.delete(id)}})
  return {module, writes, parent, timers}
}
await check('navigation event and recall responses cannot repopulate after stop', async () => {
  const events = deferred(), history = deferred()
  const h = navHarness({listDesktopBridgeEvents: () => events.promise, listDesktopBridgeHistory: () => history.promise, listDesktopBridgeTargets: async () => []})
  const stop = h.module.startNavigationSensor()
  assert.equal(h.timers.size, 2)
  h.parent.abort(); stop()
  history.resolve([{url: 'https://example.com/id/abcdef123456', title: 'secret cached result'}])
  events.resolve([{type: 'tab.activated', ts: 1, url: 'https://example.com/id/abcdef123456'}])
  await flush()
  assert.equal(h.writes.length, 0)
  assert.equal(h.module.getRecentHistoryForRecall().length, 0)
  assert.equal(h.module.getCurrentActiveHost(), null)
  assert.equal(h.module.getRecentPathSample('example.com', 2), null)
  assert.equal(h.timers.size, 0)
})
await check('navigation history seed arriving after explicit cleanup produces no writes', async () => {
  const seed = deferred(); let historyCalls = 0
  const h = navHarness({listDesktopBridgeEvents: async () => [], listDesktopBridgeHistory: () => (++historyCalls === 1 ? Promise.resolve([]) : seed.promise), listDesktopBridgeTargets: async () => []})
  const stop = h.module.startNavigationSensor()
  await flush(); assert.equal(historyCalls, 2)
  stop()
  seed.resolve([{url: 'https://example.com/id/abcdef123456', title: 'late seed'}]); await flush()
  assert.equal(h.writes.length, 0)
  assert.equal(h.module.getRecentPathSample('example.com', 2), null)
})
await check('disabled navigation never starts bridge requests', async () => {
  let calls = 0
  const h = navHarness({listDesktopBridgeEvents: async () => {calls++; return []}, listDesktopBridgeHistory: async () => {calls++; return []}, listDesktopBridgeTargets: async () => {calls++; return []}})
  h.parent.abort(); h.module.startNavigationSensor(); await flush()
  assert.equal(calls, 0); assert.equal(h.timers.size, 0)
})
await check('observer old callback is inert and restarting has no prior text', async () => {
  const callbacks = [], writes = []; let unsubs = 0
  let parent = new AbortController()
  const observer = load(root + 'observer.ts', {
    '../../store': {getAutomaticLearningSignal: () => parent.signal},
    '../../launcher/clipboard/clipboardSnapshot': {detectClipboardType: () => 'text', subscribeClipboardChange: callback => {callbacks.push(callback); return () => unsubs++}},
    '../telemetry': telemetry, './features': features,
    './pairing': {verifyTransformPair: () => ({toolId: 'uppercase'}), verifyTransformChain: () => null},
    './store': {putEvent: (value, signal) => writes.push({kind:'event', value, signal}), putPair: (value, signal) => writes.push({kind:'pair', value, signal}), saltedHash: x => x},
  })
  observer.setPureTransformRunners([{id: 'uppercase'}])
  observer.startLearningObserver(); callbacks[0]('abcdef123456')
  assert.equal(writes.length, 1)
  parent.abort(); callbacks[0]('late-value'); assert.equal(writes.length, 1)
  assert.equal(observer.getRecentClipboardTokens().length, 0)
  assert.equal(unsubs, 1)
  parent = new AbortController(); const stop = observer.startLearningObserver()
  callbacks[1]('fedcba123456'); assert.equal(writes.length, 2)
  assert.equal(writes.filter(x => x.kind === 'pair').length, 0)
  stop()
})
function storeHarness() {
  const opening = {}, operations = [], transactions = []
  const db = { transaction(name, mode) {
    const listeners = new Map(), requests = []
    const tx = {
      aborted: false,
      addEventListener(type, fn) {listeners.set(type, fn)},
      abort() {this.aborted = true; listeners.get('abort')?.(); for (const req of requests) req.onerror?.()},
      objectStore() {
        const request = (kind, value) => {operations.push({name, mode, kind, value}); const req = {}; requests.push(req); return req}
        return {add: value => request('add', value), put: value => request('put', value), index: () => ({get: value => request('get', value)})}
      },
      requests,
    }
    transactions.push(tx); return tx
  }}
  const module = load(root + 'store.ts', {'./frecency': frecency}, {indexedDB: {open: () => opening}})
  return {module, opening, db, operations, transactions, open() {opening.result = db; opening.onsuccess()}}
}
await check('all learning writes waiting for database open are cancelled', async () => {
  const h = storeHarness(); const parent = new AbortController()
  const tasks = [h.module.putEvent({}, parent.signal), h.module.putPair({}, parent.signal), h.module.putRule({}, parent.signal), h.module.putNavigation({}, parent.signal), h.module.putPathObservation({}, parent.signal), h.module.bumpRuleStrength('key', 1, Date.now(), parent.signal)]
  parent.abort(); h.open(); await Promise.all(tasks)
  assert.equal(h.operations.length, 0)
})
await check('already-started learning transaction aborts when signal ends', async () => {
  const h = storeHarness(); const parent = new AbortController()
  const pending = h.module.putEvent({ts: 1}, parent.signal)
  h.open(); await flush(); assert.equal(h.operations.length, 1)
  parent.abort(); await pending
  assert.equal(h.transactions[0].aborted, true)
})
await check('manual rule writes work with experiment stopped', async () => {
  const h = storeHarness()
  const pending = h.module.putRule({clusterKey: 'manual'})
  h.open(); await flush(); assert.equal(h.operations[0].kind, 'put')
  h.transactions[0].requests[0].onsuccess(); await pending
  assert.equal(h.transactions[0].aborted, false)
})
const proposals = load(root + 'proposals.ts')
const recall = load(root + 'clipboardBrowserLink.ts')
function fireHarness() {
  let parent = new AbortController()
  const effects = [], feedback = [], deletes = [], persisted = [], queries = []
  const query = 'abcdef123456'
  const rule = (key, autoLearned, transform = {kind: 'url-template', template: `example.com/${key}/{hex}`, slotKind: 'hex'}) => ({
    id: persisted.length + 1, clusterKey: key,
    matcher: transform.kind === 'url-template' ? {kind: 'token', tokenKind: 'hex'} : {kind: 'feature-sig', sig: features.featureSignature(features.extractFeatures(query))},
    transform, strength: 10, createdAt: Date.now(), fireCount: 0, ...(autoLearned === undefined ? {} : {autoLearned}),
  })
  persisted.push(rule('auto-url', true), rule('manual-url', false), rule('legacy-url', undefined), rule('auto-tool', true, {kind: 'tool', toolId: 'upper'}), rule('manual-tool', false, {kind: 'tool', toolId: 'upper'}))
  const module = load(root + 'fire.ts', {
    '../../store': {getAutomaticLearningSignal: () => parent.signal},
    '../../i18n': {t: (_, key) => key},
    '../effectRunner': {openExternalUrl: async (url, signal) => effects.push({type: 'url', url, signal})},
    '../telemetry': telemetry, './clipboardBrowserLink': recall, './features': features, './frecency': frecency,
    './navigationSensor': {getCurrentActiveHost: () => null, getRecentHistoryForRecall: () => [{url: `https://history.example/${query}`, title: 'recall'}]},
    './observer': {getRecentClipboardTokensWithSource: () => []}, './proposals': proposals,
    './registryRunners': {runLearnedChain: (_, text) => text.toUpperCase()},
    './store': {queryAllRules: () => queries.length ? queries.shift() : Promise.resolve(persisted), bumpRuleStrength: async (...args) => feedback.push(args)},
    './urlTemplate': urlTemplate,
    '../nativeClipboard': {writeText: async (text, signal) => effects.push({type: 'copy', text, signal})},
    './learningController': {undoLearnedRule: async rule => deletes.push(rule)},
  })
  return {module, query, persisted, effects, feedback, deletes, queries,
    disable() {parent.abort()}, enable() {parent = new AbortController()},
    signal: () => parent.signal, items() {return module.learnedLauncherItems(query, 'en')}}
}
await check('disabled results retain manual and unmarked rules, hide automatic and recall, refresh deletes nothing', async () => {
  const h = fireHarness(); h.disable(); await h.module.refreshLearnedUrlRules()
  assert.deepEqual(Array.from(h.items(), x => x.systemKey).sort(), ['learned-tool:manual-tool', 'learned-url:legacy-url', 'learned-url:manual-url'])
  assert.equal(h.persisted.length, 5); assert.equal(h.deletes.length, 0)
  for (const item of h.items()) assert.equal((await item.execute({})).ok, true)
  assert.equal(h.effects.length, 3); assert.equal(h.feedback.length, 3)
})
await check('previously visible automatic open, copy, recall and undo never revive after disable/re-enable', async () => {
  const h = fireHarness(); await h.module.refreshLearnedUrlRules()
  const items = h.items().filter(x => x.automaticLearningSignal)
  assert.ok(items.some(x => x.systemKey === 'learned-url:auto-url'))
  assert.ok(items.some(x => x.systemKey === 'learned-tool:auto-tool'))
  assert.ok(items.some(x => x.systemKey.startsWith('learned-recall:')))
  assert.ok(items.some(x => x.systemKey === 'learned-undo:auto-url'))
  h.disable(); h.enable()
  for (const item of items) assert.equal((await item.execute({})).ok, false)
  assert.equal(h.effects.length, 0); assert.equal(h.feedback.length, 0); assert.equal(h.deletes.length, 0)
})
await check('copy disabled while dynamic import is pending has no side effects', async () => {
  const h = fireHarness(); await h.module.refreshLearnedUrlRules()
  const copy = h.items().find(x => x.systemKey === 'learned-tool:auto-tool')
  const pending = copy.execute({}); h.disable()
  assert.equal((await pending).ok, false)
  assert.equal(h.effects.length, 0); assert.equal(h.feedback.length, 0)
})
await check('out-of-order rule refresh cannot resurrect older automatic cache', async () => {
  const h = fireHarness(); const old = deferred(), recent = deferred()
  h.queries.push(old.promise, recent.promise)
  const oldRefresh = h.module.refreshLearnedUrlRules(), newRefresh = h.module.refreshLearnedUrlRules()
  recent.resolve(h.persisted.filter(x => x.clusterKey === 'manual-url')); await newRefresh
  old.resolve(h.persisted); await oldRefresh
  assert.deepEqual(Array.from(h.items().filter(x => !x.systemKey.startsWith('learned-recall:')), x => x.systemKey), ['learned-url:manual-url'])
})

function controllerHarness() {
  let enabled = false, parent = new AbortController(), nextTimer = 0
  parent.abort()
  const subscribers = new Set(), timers = new Map(), idle = new Set(), writes = [], refreshes = [], starts = []
  const pairs = [], ruleQueries = [], pathQueries = []
  const candidate = {clusterKey: 'tool:uppercase', matcher: {kind: 'feature-sig', sig: 'cs:mixed|len:m'}, transform: {kind: 'tool', toolId: 'uppercase'}, sampleCount: 10, distinctInputs: 5, firstTs: 1, lastTs: Date.now()}
  const setTimer = (run) => {timers.set(++nextTimer, run); return nextTimer}
  const child = (kind) => (signal) => {const entry = {kind, signal, stopped: false}; starts.push(entry); return () => {entry.stopped = true}}
  const module = load(root + 'learningController.ts', {
    '../../store': {
      getAutomaticLearningSignal: () => parent.signal,
      useAppStore: {getState: () => ({settings: {automaticLearningEnabled: enabled}}), subscribe: fn => {subscribers.add(fn); return () => subscribers.delete(fn)}},
    },
    '../telemetry': {...telemetry, measureLatency: async (_event, run) => run()},
    '../scheduleIdleWork': {scheduleIdleWork: fn => {idle.add(fn); return () => idle.delete(fn)}},
    './cluster': {selectProposableCandidates: () => [candidate]},
    './coverage': {isShapeCovered: () => false, representativeTokens: () => []},
    './features': features,
    './fire': {refreshLearnedUrlRules: async signal => refreshes.push(signal)},
    './registryRunners': {buildPureTransformRunners: () => [], runLearnedChain: () => null},
    './proposals': proposals,
    './store': {
      queryAllPairs: () => pairs.length ? pairs.shift() : Promise.resolve([]), countEventSigs: async () => ({}),
      queryAllRules: () => ruleQueries.length ? ruleQueries.shift() : Promise.resolve([]), queryAllSuppressions: async () => [],
      queryNavigations: async () => [], queryPathObservations: () => pathQueries.length ? pathQueries.shift() : Promise.resolve([]),
      putRule: async (rule, signal) => {writes.push({rule, signal})},
    },
    './urlTemplate': urlTemplate,
    './positionVariance': load(root + 'positionVariance.ts'),
    './navigationSensor': {getRecentPathSample: () => null, startNavigationSensor: child('navigation')},
    './observer': {startLearningObserver: child('observer')},
  }, {setTimeout: setTimer, setInterval: setTimer, clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id)})
  return {module, subscribers, timers, idle, writes, refreshes, starts, pairs, ruleQueries, pathQueries,
    enable(value) {enabled = value; parent.abort(); parent = new AbortController(); if (!value) parent.abort(); for (const fn of subscribers) fn()},
    runTimers() {for (const fn of [...timers.values()]) fn()},
    runIdle() {for (const fn of [...idle]) {idle.delete(fn); fn()}},
  }
}
await check('opt-in lifecycle starts once, cancels idle/timers/subscriptions, and creates fresh children', async () => {
  const h = controllerHarness(), stop = h.module.startAutomaticLearning()
  assert.equal(h.starts.length, 0); assert.equal(h.timers.size, 0)
  assert.equal(await h.module.autoLearnNow(), 0)
  h.enable(true); assert.equal(h.starts.length, 2); assert.equal(h.timers.size, 2)
  h.runTimers(); assert.equal(h.idle.size, 1)
  h.enable(false); assert.equal(h.idle.size, 0); assert.equal(h.timers.size, 0)
  assert.ok(h.starts.every(x => x.stopped && x.signal.aborted))
  h.enable(true); assert.equal(h.starts.length, 4); assert.notEqual(h.starts[0].signal, h.starts[2].signal)
  stop(); assert.equal(h.subscribers.size, 0); assert.equal(h.timers.size, 0)
  assert.ok(h.starts.every(x => x.stopped && x.signal.aborted))
})
await check('pending candidates from an old generation cannot create rules or refresh caches after re-enable', async () => {
  const h = controllerHarness(), pendingPairs = deferred()
  h.enable(true); h.pairs.push(pendingPairs.promise)
  const pending = h.module.autoLearnNow()
  h.enable(false); h.enable(true); pendingPairs.resolve([])
  assert.equal(await pending, 0); assert.equal(h.writes.length, 0); assert.equal(h.refreshes.length, 0)
  assert.equal(await h.module.autoLearnNow(), 1)
  assert.equal(h.writes[0].rule.autoLearned, true); assert.equal(h.writes[0].signal.aborted, false)
})
await check('late path evidence is ignored and stopping a running loop cancels its pending learning pass', async () => {
  const h = controllerHarness(), pendingPaths = deferred()
  h.enable(true); h.pathQueries.push(pendingPaths.promise)
  const stop = h.module.startAutoLearnLoop()
  h.runTimers(); h.runIdle(); await flush()
  stop(); pendingPaths.resolve([]); await flush()
  assert.equal(h.writes.length, 0); assert.equal(h.refreshes.length, 0)
  assert.equal(h.timers.size, 0); assert.equal(h.idle.size, 0)
})

await check('navigation snapshot arriving after stop cannot restore current host or path cache', async () => {
  const targets = deferred()
  const h = navHarness({listDesktopBridgeEvents: async () => [], listDesktopBridgeHistory: async () => [], listDesktopBridgeTargets: () => targets.promise})
  const stop = h.module.startNavigationSensor(); await flush(); stop()
  targets.resolve([{active: true, url: 'https://example.com/id/abcdef123456'}]); await flush()
  assert.equal(h.writes.length, 0); assert.equal(h.module.getCurrentActiveHost(), null)
  assert.equal(h.module.getRecentPathSample('example.com', 2), null)
})
await check('late feedback read does not write strength or fire count after abort', async () => {
  const h = storeHarness(), parent = new AbortController()
  const pending = h.module.bumpRuleStrength('auto-rule', 1, Date.now(), parent.signal)
  h.open(); await flush()
  const request = h.transactions[0].requests[0]
  parent.abort(); request.result = {strength: 1, fireCount: 0}; request.onsuccess(); await pending
  assert.deepEqual(h.operations.map(x => x.kind), ['get'])
})

function effectsHarness(shellOpen) {
  const invocations = [], fallback = []
  const module = load('src/workspace/effectRunner.ts', {
    './workspaceStore': {}, './runtimeRegistry': {}, './surfaceCoordinator': {}, './monacoBridge': {},
    './toast': {}, './pluginRegistry': {}, '../i18n': {}, '../store': {},
    './urlSchemeRegistry': {routeHostOpenUrl: () => 'shell-open', canHostOpenUrl: () => true, extractUrlScheme: () => 'https'},
    '@tauri-apps/plugin-shell': {open: shellOpen ?? (async url => invocations.push(['shell', url]))},
    '@tauri-apps/api/core': {invoke: async (...args) => invocations.push(args)},
  }, {window: {open: (...args) => fallback.push(args)}, console: {info() {}, warn() {}}})
  return {module, invocations, fallback}
}
await check('native clipboard late import cannot invoke after cancellation; normal writes still work', async () => {
  const invokes = []
  const module = load('src/workspace/nativeClipboard.ts', {'@tauri-apps/api/core': {invoke: async (...args) => invokes.push(args)}})
  const parent = new AbortController(), pending = module.writeText('automatic', parent.signal)
  parent.abort(); await pending; assert.equal(invokes.length, 0)
  await module.writeText('manual'); assert.equal(invokes[0][0], 'clipboard_write_text'); assert.equal(invokes[0][1].text, 'manual')
})
await check('late URL imports and rejected native open cannot invoke a fallback after cancellation', async () => {
  const h = effectsHarness(), parent = new AbortController()
  const pending = h.module.openExternalUrl('https://example.com', parent.signal)
  parent.abort(); await pending
  assert.equal(h.invocations.length, 0); assert.equal(h.fallback.length, 0)
  await h.module.openExternalUrl('https://manual.example.com'); assert.equal(h.invocations.length, 1)
  let reject, calls = 0
  const late = effectsHarness(() => {calls++; return new Promise((_resolve, fail) => {reject = fail})})
  const active = new AbortController(), opening = late.module.openExternalUrl('https://example.com', active.signal)
  await flush(); assert.equal(calls, 1)
  active.abort(); reject(new Error('cancelled native open')); await opening
  assert.equal(late.invocations.length, 0); assert.equal(late.fallback.length, 0)
})
console.log(`${passed} automatic learning lifecycle checks passed`)
