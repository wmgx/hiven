#!/usr/bin/env node
/** Actual session memo chain, registry, recents and ranking; no DOM or native I/O. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createServer } from 'vite'

const values = new Map()
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
}
globalThis.window = {
  localStorage: storage, sessionStorage: storage, location: { search: '' },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.localStorage = storage
globalThis.sessionStorage = storage
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const pluginId = 'test-candidate-stability'
const sessionPath = 'src/workspace/launcher/useLauncherSession.ts'
const code = ts.transpileModule(readFileSync(sessionPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
let pluginRegistry, settingsStore, permissionStore
let passed = 0

try {
  const registryModule = await vite.ssrLoadModule('/src/workspace/pluginRegistry.ts')
  ;({ pluginRegistry } = registryModule)
  const settingsModule = await vite.ssrLoadModule('/src/workspace/pluginSettingsStore.ts')
  const permissionsModule = await vite.ssrLoadModule('/src/workspace/pluginPermissions.ts')
  settingsStore = settingsModule.usePluginSettingsStore
  permissionStore = permissionsModule.usePluginPermissionStore
  const registry = await vite.ssrLoadModule('/src/workspace/launcher/registry.ts')
  const ranking = await vite.ssrLoadModule('/src/workspace/launcher/ranking.ts')
  const recents = await vite.ssrLoadModule('/src/workspace/launcher/persistableRecents.ts')
  const types = await vite.ssrLoadModule('/src/workspace/launcher/types.ts')
  const content = await vite.ssrLoadModule('/src/kits/content/index.ts')
  pluginRegistry.registerDevPlugin(pluginId, [], [], [], [], {
    settings: { version: 1, defaultValue: { label: 'Initial action' } },
    launcher: {
      itemsFor: (settings) => settings.hidden ? [] : [{
        id: 'action', display: { title: settings.label }, behavior: { type: 'perform' },
        execute: () => ({ ok: true, message: settings.label }),
      }],
    },
  }, ['clipboard.read'])

  // Only React's storage/memo scheduling is synthetic. Effects are deliberately
  // not run: tests deliver settled provider state directly and exercise the real
  // candidate merge, dependency lists and downstream computations on every render.
  function fixture() {
    const slots = [], lanes = [], rankCalls = []
    let cursor = 0
    const app = {
      locale: 'en', settings: { automaticLearningEnabled: true, appSearchAliases: {}, jevCommandSuggestion: {} },
      launcherUsageBySurface: {}, launcherFavoriteKeys: [], launcherPersistableRecents: [],
      recordLauncherSelection() {}, recordPersistableLauncherSelection() {},
    }
    const useMemo = (compute, deps) => {
      const index = cursor++
      const previous = slots[index]
      if (!previous || deps.length !== previous.deps.length || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        slots[index] = { deps, value: compute() }
      }
      return slots[index].value
    }
    const react = {
      useMemo, useCallback: (callback, deps) => useMemo(() => callback, deps), useEffect() {},
      useRef(value) { const index = cursor++; return slots[index] ??= { current: value } },
      useState(initial) {
        const index = cursor++
        if (!slots[index]) {
          const slot = { value: typeof initial === 'function' ? initial() : initial }
          slot.set = (update) => { slot.value = typeof update === 'function' ? update(slot.value) : update }
          slots[index] = slot
          if (slot.value && Object.hasOwn(slot.value, 'inputIdentity')) lanes.push(slot)
        }
        return [slots[index].value, slots[index].set]
      },
    }
    const modules = {
      react,
      '../../store': { useAppStore: (select) => select(app) },
      '../pluginRegistry': { ...registryModule, usePluginRegistryVersion: () => pluginRegistry.getVersion() },
      '../pluginSettingsStore': { ...settingsModule, usePluginSettingsStore: (select) => select(settingsStore.getState()) },
      '../pluginPermissions': { ...permissionsModule, usePluginPermissionStore: (select) => select(permissionStore.getState()) },
      '../desktopControl/windows': { isExplicitWindowSearch: () => false },
      './registry': registry, './persistableRecents': recents, './types': types,
      '../../kits/content': content,
      './ranking': { rankLauncherItems(context, items) {
        const result = ranking.rankLauncherItems(context, items)
        rankCalls.push({ context, items, result })
        return result
      } },
      './perf': { measureLauncherPerfSync: (_label, run) => run() },
    }
    const exports = {}
    vm.runInNewContext(code, {
      exports, module: { exports }, console, Date, AbortController,
      require(name) {
        return modules[name] ?? new Proxy({}, { get: (_target, method) => () => {
          throw new Error(`Unexpected side effect: ${name}.${String(method)}`)
        } })
      },
    }, { filename: sessionPath })
    const options = {
      hostId: 'global-launcher', open: false, requestClose() {},
      staticItemFilter: (items) => items.filter((item) => item.pluginId === pluginId),
    }
    const h = {
      app, options, rankCalls,
      render() { cursor = 0; h.session = exports.useLauncherSession(options); return h.session },
      publish(lane, items, inputIdentity) { lanes[lane].set({ items, inputIdentity }); return h.render() },
      query(text) { h.session.setQuery(text); return h.render() },
      identity(lane) { return lane === 2 ? h.session.query.trim() : JSON.stringify([h.session.query.trim(), options.objectBlockText?.trim() ?? '']) },
      get candidates() { return rankCalls.at(-1).items },
    }
    h.render()
    assert.equal(lanes.length, 3, 'all three actual dynamic state slots are exercised')
    return h
  }

  const item = (key, extra = {}) => ({
    systemKey: `host:test:${key}`, kind: 'host', display: { title: key },
    behavior: { type: 'perform' }, execute: () => ({ ok: true }), ...extra,
  })
  const recent = (key) => ({
    persistKey: key, systemKey: `host:test:${key}`, kind: 'document', title: `Recent ${key}`,
    url: 'https://example.com/test', count: 1, lastSelectedAt: Date.now(),
  })
  function check(name, run) {
    try { run(); passed++ } catch (error) { error.message = `${name}: ${error.message}`; throw error }
  }

  for (const [lane, name] of ['plugin', 'host', 'document'].entries()) {
    check(`${name}: empty deliveries and stale generations preserve candidates and ranking`, () => {
      const h = fixture()
      const candidates = h.candidates, ranked = h.session.rankedItems, available = h.session.availableItems
      for (const identity of [h.identity(lane), null, 'older input', h.identity(lane)]) {
        h.publish(lane, [], identity)
        assert.equal(h.candidates, candidates)
        assert.equal(h.session.rankedItems, ranked)
        assert.equal(h.session.availableItems, available)
        assert.equal(h.rankCalls.length, 1, 'an empty new generation must not rerank')
      }
      h.publish(lane, [item('late old result')], 'older input')
      assert.equal(h.candidates, candidates, 'late stale nonempty rows remain invisible')
      assert.equal(h.rankCalls.length, 1)
    })

    check(`${name}: live results replace recents; nonempty to empty restores them`, () => {
      const h = fixture()
      h.app.launcherPersistableRecents = [recent('shared')]
      h.render()
      const snapshot = h.candidates.find((row) => row.systemKey === 'host:test:shared')
      const live = item('shared')
      h.publish(lane, [live], h.identity(lane))
      assert.equal(h.candidates.filter((row) => row.systemKey === live.systemKey).length, 1)
      assert.ok(h.candidates.includes(live))
      assert.ok(!h.candidates.includes(snapshot))
      const count = h.rankCalls.length
      h.publish(lane, [], h.identity(lane))
      assert.equal(h.rankCalls.length, count + 1, 'removing visible results must rerank')
      assert.ok(h.candidates.includes(snapshot))
      assert.ok(!h.candidates.includes(live))
      h.publish(lane, [], null)
      assert.equal(h.rankCalls.length, count + 1, 'further empty generation changes are invisible')
    })

    check(`${name}: same key with a new object preserves its new execute callback`, () => {
      const h = fixture()
      const old = item('replaceable', { execute: () => 'old' })
      const fresh = { ...old, execute: () => 'fresh' }
      h.publish(lane, [old], h.identity(lane))
      const count = h.rankCalls.length
      h.publish(lane, [fresh], h.identity(lane))
      assert.equal(h.rankCalls.length, count + 1)
      assert.ok(h.candidates.includes(fresh))
      assert.ok(!h.candidates.includes(old))
      assert.equal(h.session.rankedItems.find((row) => row.systemKey === fresh.systemKey)?.execute(), 'fresh')
    })

    check(`${name}: query changes hide current rows before older deliveries arrive`, () => {
      const h = fixture(), old = item('old result')
      const oldIdentity = h.identity(lane)
      h.publish(lane, [old], oldIdentity)
      h.query('new query')
      assert.ok(!h.candidates.includes(old))
      const candidates = h.candidates, count = h.rankCalls.length
      h.publish(lane, [item('late old result')], oldIdentity)
      assert.equal(h.candidates, candidates)
      assert.equal(h.rankCalls.length, count)
    })
  }

  check('query edits rerank once before the three empty providers settle', () => {
    const h = fixture()
    for (const query of ['typed query', ' typed query ', '']) {
      const count = h.rankCalls.length
      h.query(query)
      assert.equal(h.rankCalls.length, count + 1, 'raw query remains a ranking dependency')
      assert.equal(h.rankCalls.at(-1).context.query, query.trim())
      const candidates = h.candidates
      for (let lane = 0; lane < 3; lane++) h.publish(lane, [], h.identity(lane))
      assert.equal(h.candidates, candidates)
      assert.equal(h.rankCalls.length, count + 1, 'empty provider settlements add no rerank')
    }
  })

  check('object material invalidates plugin/host rows while document query identity is retained', () => {
    const h = fixture(), rows = [item('plugin'), item('host'), item('document')]
    rows.forEach((row, lane) => h.publish(lane, [row], h.identity(lane)))
    h.options.objectBlockText = 'new material'
    h.render()
    assert.ok(!h.candidates.includes(rows[0]) && !h.candidates.includes(rows[1]))
    assert.ok(h.candidates.includes(rows[2]))
    assert.equal(h.rankCalls.at(-1).context.contentText, 'new material')
    const count = h.rankCalls.length
    h.options.objectBlockText = 'different material'
    h.render()
    assert.equal(h.rankCalls.length, count + 1, 'material remains a ranking dependency with empty visible lanes')
  })

  check('automatic learning disable and aborted rows still filter candidates', () => {
    const h = fixture(), signal = new AbortController()
    const learned = item('learned', { automaticLearningSignal: signal.signal })
    h.publish(0, [learned], h.identity(0))
    assert.ok(h.candidates.includes(learned))
    h.app.settings.automaticLearningEnabled = false
    h.render()
    assert.ok(!h.candidates.includes(learned))
    signal.abort()
    h.app.settings.automaticLearningEnabled = true
    h.render()
    assert.ok(!h.candidates.includes(learned), 'aborted automatic results never reappear')
  })

  check('settings recollect static rows and permissions refresh actual discovery availability', () => {
    const h = fixture()
    const initial = h.candidates.find((row) => row.pluginId === pluginId && row.kind === 'plugin')
    assert.ok(initial, 'real static plugin action exists')
    assert.equal(h.session.availableItems.some((row) => row.systemKey === initial.systemKey), false)
    settingsStore.getState().setPluginSettings('dev', pluginId, { label: 'Updated action' }, 1)
    const count = h.rankCalls.length
    h.render()
    const updated = h.candidates.find((row) => row.systemKey === initial.systemKey)
    assert.equal(h.rankCalls.length, count + 1)
    assert.notEqual(updated, initial)
    assert.equal(updated.display.title, 'Updated action')
    assert.equal(updated.execute({}).message, 'Updated action')
    const candidates = h.candidates
    permissionStore.getState().grantPermissions('dev', pluginId, ['clipboard.read'])
    h.render()
    assert.equal(h.candidates, candidates)
    assert.ok(h.session.availableItems.includes(updated), 'grant makes the current candidate discoverable')
    permissionStore.getState().revokePermissions('dev', pluginId, ['clipboard.read'])
    h.render()
    assert.ok(!h.session.availableItems.includes(updated), 'revoke immediately removes discovery eligibility')
    settingsStore.getState().setPluginSettings('dev', pluginId, { label: 'Updated action', hidden: true }, 1)
    h.render()
    assert.ok(!h.candidates.some((row) => row.systemKey === initial.systemKey), 'settings can remove static candidates')
    settingsStore.getState().setPluginSettings('dev', pluginId, { label: 'Restored action' }, 1)
    h.render()
    assert.equal(h.candidates.find((row) => row.systemKey === initial.systemKey)?.display.title, 'Restored action')
  })

  console.log(`launcher candidate stability: ${passed} behavioral checks passed`)
} finally {
  pluginRegistry?.unregisterDevPlugin(pluginId)
  settingsStore?.getState().removePluginSettings('dev', pluginId)
  permissionStore?.getState().clearPluginPermissions('dev', pluginId)
  await vite.close()
}
