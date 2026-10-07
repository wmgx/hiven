#!/usr/bin/env node
/** Real registry, localization, settings store, ranking and controller. No UI,
 * browser, listening server, user storage, network or external URL opening. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const values = new Map()
const storage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, String(value)) },
  removeItem: key => { values.delete(key) },
}
globalThis.window = {
  localStorage: storage, sessionStorage: storage, location: { search: '' },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.localStorage = storage
globalThis.sessionStorage = storage
const originalFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('Unexpected network access in rule consistency test') }
const originalInfo = console.info
console.info = (...args) => { if (args[0] !== '[hiven:launcher-perf]') originalInfo(...args) }
// Used only as the repository's TS/import.meta module loader. Never listen().
const vite = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'silent' })
const controllers = new Set()
let passed = 0
try {
  const { default: definition } = await vite.ssrLoadModule('/src/plugins/web-open/index.tsx')
  const { DEFAULT_WEB_QUICK_OPEN_SETTINGS: defaults } = await vite.ssrLoadModule('/src/plugins/web-open/settings/model.ts')
  const { pluginRegistry } = await vite.ssrLoadModule('/src/workspace/pluginRegistry.ts')
  const { usePluginSettingsStore, resolvePluginSettings } = await vite.ssrLoadModule('/src/workspace/pluginSettingsStore.ts')
  const { collectStaticCandidates, filterAvailableLauncherItems, resolvePluginLauncherItems } = await vite.ssrLoadModule('/src/workspace/launcher/registry.ts')
  const { registerPluginMessages, localizeContributions, makePluginT } = await vite.ssrLoadModule('/src/i18n/pluginI18nRegistry.ts')
  const { resolveDisplayTitle, localizedDisplay } = await vite.ssrLoadModule('/src/workspace/launcher/display.ts')
  const { selectLauncherVisibleItems } = await vite.ssrLoadModule('/src/workspace/launcher/visibleItems.ts')
  const { rankLauncherItems } = await vite.ssrLoadModule('/src/workspace/launcher/ranking.ts')
  const { LauncherController } = await vite.ssrLoadModule('/src/workspace/launcher/controller.ts')
  const { normalizeContribution } = await vite.ssrLoadModule('/src/workspace/launcher/normalizeContribution.ts')
  const { projectSavedAction } = await vite.ssrLoadModule('/src/workspace/savedActions/provider.ts')
  const messages = Object.fromEntries(['en', 'zh'].map(locale => [locale, JSON.parse(readFileSync(`src/plugins/web-open/locales/${locale}.json`, 'utf8'))]))
  registerPluginMessages('web-open', messages)
  const localized = localizeContributions('web-open', definition)
  pluginRegistry.registerProductionPlugin('web-open', [], [], [], [], localized.definition)
  const state = () => usePluginSettingsStore.getState()
  const save = value => state().setPluginSettings('builtin', 'web-open', structuredClone(value), definition.settings.version)
  const currentSettings = () => resolvePluginSettings('builtin', 'web-open', definition.settings).value
  const collect = () => collectStaticCandidates('global-launcher').filter(item => item.pluginId === 'web-open')
  const key = id => `plugin:web-open:launcher:${id}`
  const byId = id => collect().find(item => item.systemKey === key(id))
  const rank = (query, items = collect(), favorites = []) => rankLauncherItems({
    query, locale: 'zh', surfaceId: 'global-launcher', usage: {}, now: Date.now(), favoriteKeys: favorites,
  }, items)
  const renamed = {
    ...defaults,
    entries: defaults.entries.map(entry => entry.id === 'google' ? {
      ...entry, title: '公司文档', aliases: ['companydocs'], placeholder: '输入文档关键词',
      urlTemplate: 'https://docs.example.test/search?q={query}', recordQueryHistory: true,
    } : entry),
  }
  const deleted = { ...defaults, entries: defaults.entries.filter(entry => entry.id !== 'google') }
  const historySettings = { ...defaults, entries: defaults.entries.map(entry => ({ ...entry, recordQueryHistory: true })) }
  const ruleChanges = [
    ['removed', deleted, 'ruleChangedMessage'],
    ['disabled', { ...historySettings, enabled: false }, 'disabledMessage'],
    ['retargeted', renamed, 'ruleChangedMessage'],
    ['encoding changed', { ...historySettings, entries: historySettings.entries.map(entry => ({ ...entry, encodeQuery: false })) }, 'ruleChangedMessage'],
  ]
  async function check(name, test) {
    try { await test(); passed++ } catch (error) { error.message = `${name}: ${error.message}`; throw error }
    finally { for (const controller of controllers) controller.reset(); controllers.clear() }
  }
  function harness(locale = 'en') {
    const opened = [], selected = [], privateValues = new Map([
      ['query-history/google', { queries: [{ text: 'synthetic status', lastUsedAt: Date.now(), useCount: 1 }] }],
    ])
    const privateStorage = { kv: {
      get: async name => privateValues.get(name),
      set: async (name, value) => { privateValues.set(name, value) },
      delete: async name => { privateValues.delete(name) },
    } }
    const api = { openUrl: async url => { opened.push(url) }, showMessage() {}, getSelectionText: () => '', getActiveText: () => '' }
    const controller = new LauncherController({
      surfaceId: 'global-launcher', api, locale, makeT: () => makePluginT('web-open', locale),
      getSettings: item => resolvePluginSettings(item.source, item.pluginId, pluginRegistry.getPluginDefinition(item.pluginId, item.source).settings).value, getStorage: () => privateStorage,
      recordSelection: (_surface, item) => selected.push(item.systemKey), requestClose() {}, onChange() {}, appendExperienceEvent() {},
    })
    controllers.add(controller)
    return { controller, opened, selected, privateValues, privateStorage, api,
      top: () => controller.getState().frames.at(-1),
      context: () => ({ get settings() { return currentSettings() }, input: { text: 'synthetic status' }, t: makePluginT('web-open', locale), api, storage: privateStorage }),
    }
  }
  async function dynamic(query) {
    // No network API is passed, so favicon fallback cannot warm over the network.
    return definition.launcher.dynamicItems({ query, settings: currentSettings(), locale: 'en', t: makePluginT('web-open', 'en'), source: 'builtin', pluginId: 'web-open' })
  }

  await check('unconfigured defaults and localized ordinary discovery', () => {
    assert.equal(collect().length, 3)
    const item = byId('google')
    assert.equal(resolveDisplayTitle(item.display, 'en'), 'Google Search')
    assert.equal(resolveDisplayTitle(item.display, 'zh'), 'Google 搜索')
    assert.equal(localizedDisplay(item.behavior.input.placeholder, item.behavior.input.placeholderI18n, 'en'), 'Enter search keywords')
    assert.equal(filterAvailableLauncherItems(collect(), 'global-launcher').length, 3)
  })
  await check('delete removes old keyword, discovery and favorite row', () => {
    save(deleted)
    assert.equal(rank('google').length, 0)
    assert.equal(byId('google'), undefined)
    assert.ok(!rank('', collect(), [key('google')]).some(item => item.systemKey === key('google')))
  })
  await check('rename replaces display, aliases and target under the same key', async () => {
    save(renamed)
    const rows = rank('companydocs')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].systemKey, key('google'))
    assert.equal(rank('google').length, 0)
    for (const locale of ['en', 'zh']) assert.equal(resolveDisplayTitle(rows[0].display, locale), '公司文档')
    assert.equal(rows[0].behavior.input.placeholder, '输入文档关键词')
    assert.ok(filterAvailableLauncherItems(collect(), 'global-launcher').some(item => item.systemKey === rows[0].systemKey))
    assert.equal(rank('', collect(), [key('google')])[0].systemKey, key('google'))
    const h = harness()
    await h.controller.selectItem(rows[0], { objectBlockText: 'daily status', recordUsage: false })
    await new Promise(setImmediate)
    assert.deepEqual(h.opened, ['https://docs.example.test/search?q=daily%20status'])
    assert.equal((await dynamic('companydocs')).length, 0, 'ordinary custom rules have no duplicate dynamic identity')
  })
  await check('custom titles and placeholders that equal locale keys stay literal in both languages', () => {
    for (const [title, placeholder] of [['title', 'emptyInputMessage'], ['emptyInputMessage', 'title']]) {
      save({ ...defaults, entries: [{ ...defaults.entries[0], title, placeholder }] })
      const item = byId('google')
      for (const locale of ['en', 'zh']) {
        assert.equal(resolveDisplayTitle(item.display, locale), title)
        assert.equal(localizedDisplay(item.behavior.input.placeholder, item.behavior.input.placeholderI18n, locale), placeholder)
      }
    }
  })
  await check('manual rules are available in browse and favorites without a query or dynamic cap', async () => {
    const entries = Array.from({ length: 24 }, (_, index) => ({
      ...defaults.entries[0], id: `manual-${index}`, title: `Company portal ${index}`,
      aliases: [`portal${index}`], urlTemplate: `https://portal.example.test/${index}?q={query}`,
    }))
    save({ ...defaults, entries })
    const availableItems = filterAvailableLauncherItems(collect(), 'global-launcher')
    const options = { availableItems, rankedItems: [], query: '', favoriteKeys: [key('manual-23')], keyOf: item => item.systemKey }
    assert.equal(selectLauncherVisibleItems({ ...options, browse: true }).length, 24)
    assert.equal(selectLauncherVisibleItems(options)[0].systemKey, key('manual-23'))
    assert.equal((await dynamic('portal23')).length, 0)
    save({ ...defaults, entries: [] })
    assert.equal(selectLauncherVisibleItems({ ...options, availableItems: collect() }).length, 0)
  })
  await check('empty and disabled settings never resurrect defaults', () => {
    save({ ...defaults, entries: [] })
    assert.equal(collect().length, 0)
    assert.equal(definition.settings.migrate({ entries: [] }).entries.length, 0)
    save({ ...defaults, enabled: false })
    assert.equal(collect().length, 0)
  })
  await check('current-version automatic legacy rules do not reappear as ordinary candidates', () => {
    const manual = { ...defaults.entries[0], id: 'manual', title: 'Manual portal' }
    const automatic = [
      { ...manual, id: 'learned', learnedFrom: 'synthetic-cluster' },
      { ...manual, id: 'auto-tagged', tags: ['auto'] },
    ]
    // Same version bypasses migration, so ordinary collection must retain the
    // existing automatic-rule exclusion independently of migration timing.
    save({ ...defaults, entries: [manual, ...automatic] })
    assert.equal(currentSettings().entries.length, 3)
    assert.deepEqual(collect().map(item => item.systemKey), [key('manual')])
    assert.equal(definition.settings.migrate({ entries: [manual, ...automatic] }, 8).entries.length, 1)
  })
  await check('failed or invalid itemsFor is diagnosed and cannot fall back to stale items', () => {
    const warnings = [], warn = console.warn
    console.warn = (...args) => warnings.push(args)
    try {
      for (const itemsFor of [() => { throw new Error('synthetic failure') }, () => null]) {
        assert.equal(resolvePluginLauncherItems({ launcher: { items: definition.launcher.itemsFor(defaults), itemsFor } }, defaults, 'synthetic-plugin').length, 0)
      }
    } finally { console.warn = warn }
    assert.equal(warnings.length, 2)
    assert.ok(warnings.every(args => args[0].includes('synthetic-plugin')))
  })
  for (const [change, changed, messageKey] of ruleChanges) {
    await check(`retained collect-input button rejects ${change} rule`, async () => {
      save(historySettings)
      const h = harness('zh'), selected = byId('google')
      await h.controller.selectItem(selected, { recordUsage: false })
      await new Promise(setImmediate)
      await h.controller.refreshSuggestions()
      h.controller.setInputText('new synthetic query')
      await h.controller.refreshSuggestions()
      save(changed)
      await h.controller.submitInput()
      assert.deepEqual(h.opened, [])
      assert.equal(h.controller.getState().error, messages.zh[messageKey])
      assert.deepEqual(h.selected, [])
    })
    await check(`retained history choice rejects ${change} rule with current settings`, async () => {
      save(historySettings)
      const h = harness(), selected = byId('google')
      await h.controller.selectItem(selected, { recordUsage: false })
      await new Promise(setImmediate)
      await h.controller.refreshSuggestions()
      const choice = h.top().previewOutput.choices[0]
      assert.equal(choice.title, 'synthetic status')
      save(changed)
      await h.controller.activateChoice(choice)
      assert.deepEqual(h.opened, [])
      assert.equal(h.controller.getState().error, messages.en[messageKey])
      assert.equal(h.privateValues.get('query-history/google').queries[0].useCount, 1)
      assert.equal(await selected.suggest({ ...h.context(), inputText: '' }), null)
    })
  }
  await check('fresh current history choice opens its displayed URL', async () => {
    save(renamed)
    const h = harness()
    await h.controller.selectItem(byId('google'), { recordUsage: false })
    await new Promise(setImmediate)
    await h.controller.refreshSuggestions()
    const choice = h.top().previewOutput.choices[0]
    await h.controller.activateChoice(choice)
    assert.deepEqual(h.opened, [choice.subtitle])
    assert.equal(h.controller.getState().error, null)
  })
  await check('history read completing after a target edit cannot emit stale choices', async () => {
    save(historySettings)
    const h = harness(), item = byId('google')
    let completeRead
    h.privateStorage.kv.get = () => new Promise(resolve => { completeRead = resolve })
    const pending = item.suggest({ ...h.context(), get settings() { return currentSettings() }, inputText: '' })
    save(renamed)
    completeRead({ queries: [{ text: 'synthetic status', lastUsedAt: 1, useCount: 1 }] })
    assert.equal(await pending, null)
  })
  await check('pattern candidates stay dynamic and revalidate target and current match', async () => {
    const configured = { ...defaults, entries: [{ ...defaults.entries[0], matchPattern: '^TICKET-\\d+$' }] }
    save(configured)
    const h = harness(), [quick] = await dynamic('TICKET-42')
    assert.equal(quick.id, 'google-quick')
    assert.equal(quick.display.title, 'Google Search')
    const normalized = normalizeContribution(quick, { systemKey: 'plugin:web-open:dynamic:google-quick', kind: 'dynamic', pluginId: 'web-open', source: 'builtin' })
    await h.controller.selectItem(normalized, { recordUsage: false })
    await new Promise(setImmediate)
    assert.deepEqual(h.opened, ['https://www.google.com/search?q=TICKET-42'])
    h.opened.length = 0
    for (const changed of [deleted, renamed, { ...configured, enabled: false }, { ...configured, entries: [{ ...configured.entries[0], matchPattern: '^OTHER$' }] }]) {
      save(changed)
      assert.equal((await quick.execute(h.context())).ok, false)
      assert.deepEqual(h.opened, [])
    }
  })
  await check('direct URL row is blocked after disabling, but not by an empty rule list', async () => {
    save({ ...defaults, entries: [] })
    const h = harness(), [direct] = await dynamic('https://synthetic.example.test/path')
    assert.equal(direct.id, 'direct-url-open')
    assert.equal((await direct.execute(h.context())).ok, true)
    h.opened.length = 0
    save({ ...defaults, enabled: false })
    assert.equal((await direct.execute(h.context())).ok, false)
    assert.deepEqual(h.opened, [])
  })
  await check('Saved Action references keep ordinary keys and report missing deleted rules', () => {
    save(defaults)
    const base = byId('google')
    const artifact = { id: 'synthetic', name: 'Synthetic reference', aliases: [], baseActionKey: base.systemKey, inputBinding: 'prompt', savedParams: {}, actionPolicy: { effect: 'external', learnable: false }, outputIntent: 'copy' }
    save(deleted)
    const projection = projectSavedAction(artifact, byId('google') ?? null)
    assert.equal(projection.disabledReason.code, 'missing-action')
    save(renamed)
    assert.equal(byId('google').systemKey, artifact.baseActionKey)
  })
  console.log(`Web rule consistency passed: ${passed} behavior cases`)
} finally {
  for (const controller of controllers) controller.reset()
  await vite.close()
  console.info = originalInfo
  globalThis.fetch = originalFetch
}
