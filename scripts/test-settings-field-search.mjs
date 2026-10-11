#!/usr/bin/env node
/** Real registry/ranker/bridge contracts; only storage and external I/O are synthetic. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const values = new Map()
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
}
globalThis.window = {
  localStorage: storage, sessionStorage: storage,
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.localStorage = storage
globalThis.sessionStorage = storage
const forbidden = () => { throw new Error('Settings search must not read values or execute plugin callbacks') }
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const search = await vite.ssrLoadModule('/src/workspace/launcher/settingsFieldSearch.ts')
  const registry = await vite.ssrLoadModule('/src/workspace/launcher/registry.ts')
  const { pluginRegistry } = await vite.ssrLoadModule('/src/workspace/pluginRegistry.ts')
  const { rankLauncherItems } = await vite.ssrLoadModule('/src/workspace/launcher/ranking.ts')
  const { usePluginPermissionStore } = await vite.ssrLoadModule('/src/workspace/pluginPermissions.ts')
  const { usePluginSettingsStore } = await vite.ssrLoadModule('/src/workspace/pluginSettingsStore.ts')
  const { usePluginStore } = await vite.ssrLoadModule('/src/workspace/pluginStore.ts')
  const { registerBundledPluginPackages } = await vite.ssrLoadModule('/src/workspace/bundledPluginLoader.ts')
  const { registerPluginMessages } = await vite.ssrLoadModule('/src/i18n/pluginI18nRegistry.ts')
  const collect = (query, locale = 'en', extra = {}) => registry.collectDynamicItems(query, 'global-launcher', locale, forbidden, undefined, {
    includePlugins: false, ...extra,
  })
  const rank = (items, query, locale) => rankLauncherItems({ query, locale, surfaceId: 'global-launcher', usage: {}, now: Date.now() }, items)
  const fieldRows = (items) => items.filter((item) => item.systemKey.startsWith('settings-field:'))

  for (const query of ['', ' ', 'settings', 'settings ', '设置', '图片', 'image', 'settingsimage', '设置图片', 'reset settings image']) {
    assert.equal(search.parseSettingsFieldSearchQuery(query), null, `must not activate on ${JSON.stringify(query)}`)
  }
  assert.equal(search.parseSettingsFieldSearchQuery('  SeTTings   IMAGE  '), 'image')
  assert.equal(search.parseSettingsFieldSearchQuery('设置 图片 大小'), '图片 大小')

  // Actual bundled schema reaches the actual shared ranker in either UI language.
  registerBundledPluginPackages()
  for (const [query, locale] of [['设置 图片', 'zh'], ['settings image', 'en'], ['Settings 图片', 'en'], ['设置 image', 'zh']]) {
    const items = await collect(query, locale)
    const ranked = rank(items, query, locale)
    const recordImages = ranked.find((item) => item.systemKey === 'settings-field:builtin:clipboard-history:recording:recordImages')
    assert.ok(recordImages, `${query} must survive the production ranker in ${locale}`)
    assert.equal(recordImages.display.title, 'Record images')
    assert.equal(recordImages.display.titleI18n.zh, '记录图片')
    assert.equal(recordImages.display.subtitleI18n.zh, '剪贴板历史 · 记录设置')
  }
  const existingStatic = registry.collectStaticCandidates('global-launcher')
  for (const query of ['', 'settings', '设置', '图片', 'image']) {
    const items = await collect(query)
    assert.deepEqual(fieldRows(items), [], `ordinary query ${query} must not receive field rows`)
    assert.deepEqual(rank([...existingStatic, ...items], query, 'en').map((item) => item.systemKey),
      rank(existingStatic, query, 'en').map((item) => item.systemKey), 'ordinary ranking must remain unchanged')
  }
  assert.deepEqual(search.collectSettingsFieldSearchItems('settings image', 'quick-editor-command'), [])
  assert.deepEqual(await collect('settings image', 'en', { signal: AbortSignal.abort() }), [])
  assert.deepEqual(await collect('settings image', 'en', { includeHost: false }), [])

  // The real bridge carries identity only and opening it does not alter settings.
  const selected = (await collect('设置 图片', 'zh')).find((item) => item.systemKey.endsWith(':recordImages'))
  const before = JSON.stringify(usePluginSettingsStore.getState().pluginSettings)
  assert.deepEqual(await selected.execute({ surfaceId: 'global-launcher', locale: 'zh' }), { ok: true, keepOpen: true })
  const target = usePluginSettingsStore.getState().settingsDialogTarget
  assert.equal(target.pluginId, 'clipboard-history')
  assert.equal(target.source, 'builtin')
  assert.deepEqual(target.target, { sectionId: 'recording', fieldKey: 'recordImages' })
  assert.equal(JSON.stringify(usePluginSettingsStore.getState().pluginSettings), before)

  // A guarded synthetic schema makes all unwanted reads/callbacks fail loudly.
  const protectedFields = [
    { kind: 'text', key: 'endpoint', label: 'settings.endpoint', description: 'Connect to the service', descriptionI18n: { zh: '连接服务' }, validate: forbidden },
    { kind: 'object-list', key: 'profiles', label: 'Account profiles', fields: [{ key: 'secret', label: 'HIDDEN_CHILD_SENTINEL' }], get itemDefaults() { return forbidden() } },
    { kind: 'select', key: 'provider', label: 'Provider picker', options: [{ label: 'OPTION_SENTINEL', value: 'PRIVATE_OPTION_SENTINEL' }, { label: 'Another', value: 'other' }] },
    { kind: 'select', key: 'dynamic', label: 'Profile picker', optionsFrom: { listKey: 'profiles' }, get options() { return forbidden() } },
    { kind: 'text', key: 'disabled', label: 'DISABLED_SENTINEL', disabled: true },
    { kind: 'select', key: 'hidden', label: 'HIDDEN_SELECT_SENTINEL', options: [{ label: 'Only', value: 'only' }] },
    { kind: 'action', id: 'reset', key: 'malformed-action', label: 'ACTION_SENTINEL', run: forbidden },
    { kind: 'modal', id: 'edit', key: 'malformed-modal', label: 'MODAL_SENTINEL', component: forbidden },
    { kind: 'text', key: 'dynamicLabel', get label() { return forbidden() } },
    { kind: 'text', key: 'dynamicDisabled', label: 'DYNAMIC_DISABLED_SENTINEL', get disabled() { return forbidden() } },
    { kind: 'text', key: 'dynamicRequires', label: 'DYNAMIC_REQUIRES_SENTINEL', get requires() { return forbidden() } },
    { kind: 'select', key: 'dynamicOptionsFrom', label: 'DYNAMIC_OPTIONS_SENTINEL', get optionsFrom() { return forbidden() }, options: ['one', 'two'] },
  ]
  const guarded = {
    settings: {
      title: 'Safe Plugin', titleI18n: { zh: '安全插件' },
      get defaultValue() { return forbidden() }, migrate: forbidden, onChange: forbidden,
      schema: { sections: [{ id: 'connection', title: 'Connection', titleI18n: { zh: '连接' }, fields: protectedFields }] },
    },
    launcher: { itemsFor: forbidden, dynamicItems: forbidden }, toolsFor: forbidden,
  }
  registerPluginMessages('guarded-settings-search', { en: { 'settings.endpoint': 'Service endpoint' }, zh: { 'settings.endpoint': '服务地址' } })
  pluginRegistry.registerProductionPlugin('guarded-settings-search', [], [], [], [], guarded)
  const indexed = search.indexPluginSettingsFields(guarded, 'guarded-settings-search')
  assert.deepEqual(indexed.map((entry) => entry.fieldKey), ['endpoint', 'profiles', 'provider', 'dynamic'])
  assert.equal(indexed[0].label.zh, '服务地址', 'static i18n keys must follow the same plugin dictionary as the renderer')
  assert.doesNotMatch(JSON.stringify(indexed), /SENTINEL|defaultValue|migrate|onChange/)
  assert.deepEqual(search.indexPluginSettingsFields({ settings: { schema: forbidden } }, 'dynamic-schema'), [])
  assert.deepEqual(search.indexPluginSettingsFields({ settings: { schema: guarded.settings.schema, component: forbidden } }, 'custom-body'), [])
  const getterArray = []
  Object.defineProperty(getterArray, 0, { get: forbidden })
  assert.deepEqual(search.indexPluginSettingsFields({ settings: { schema: { sections: getterArray } } }, 'dynamic-array'), [])
  const customIteratorFields = [{ kind: 'text', key: 'safe', label: 'Safe' }]
  customIteratorFields[Symbol.iterator] = forbidden
  assert.equal(search.indexPluginSettingsFields({ settings: { schema: { sections: [{ id: 'safe', fields: customIteratorFields }] } } }, 'custom-iterator').length, 1)
  for (const query of ['settings service', '设置 连接', 'settings account profiles']) {
    assert.ok(fieldRows(await collect(query)).some((item) => item.pluginId === 'guarded-settings-search'))
  }
  for (const term of ['HIDDEN_CHILD_SENTINEL', 'OPTION_SENTINEL', 'PRIVATE_OPTION_SENTINEL', 'DISABLED_SENTINEL', 'HIDDEN_SELECT_SENTINEL', 'ACTION_SENTINEL', 'MODAL_SENTINEL']) {
    assert.deepEqual(await collect(`settings ${term}`), [])
  }

  // Field permission revocation/removal invalidates both new and held results.
  const grants = usePluginPermissionStore.getState()
  grants.revokePermissions('builtin', 'clipboard-history', ['clipboard.image'])
  assert.equal((await collect('settings image')).some((item) => item.systemKey.endsWith(':recordImages')), false)
  assert.equal((await selected.execute({ surfaceId: 'global-launcher', locale: 'en' })).ok, false)
  grants.grantPermissions('builtin', 'clipboard-history', ['clipboard.image'])
  grants.revokePermissions('builtin', 'clipboard-history', ['clipboard.write'])
  assert.deepEqual(await collect('settings image'), [], 'the real selection gate also requires unrelated plugin-wide permissions')
  grants.grantPermissions('builtin', 'clipboard-history', ['clipboard.write'])
  assert.ok((await collect('settings image')).some((item) => item.systemKey.endsWith(':recordImages')), 'an unchanged query sees newly restored permissions')
  const held = (await collect('settings service')).find((item) => item.pluginId === 'guarded-settings-search')
  pluginRegistry.unregisterProductionPlugin('guarded-settings-search')
  assert.equal((await collect('settings service')).some((item) => item.pluginId === 'guarded-settings-search'), false)
  assert.equal((await held.execute({ surfaceId: 'global-launcher', locale: 'en' })).ok, false)

  // Installed and dev registrations retain distinct destinations for the same id.
  const sourceDefinition = { settings: { title: 'Source fixture', defaultValue: {}, schema: { sections: [{
    id: 'source-section', fields: [{ kind: 'text', key: 'sourceField', label: 'Unique source fixture' }],
  }] } } }
  usePluginStore.setState((state) => ({ plugins: { ...state.plugins, 'settings-source-fixture': { source: 'installed' } } }))
  pluginRegistry.registerProductionPlugin('settings-source-fixture', [], [], [], [], sourceDefinition)
  pluginRegistry.registerDevPlugin('settings-source-fixture', [], [], [], [], sourceDefinition)
  const sourceRows = await collect('settings unique source fixture')
  assert.deepEqual(sourceRows.map((item) => item.source).sort(), ['dev', 'installed'])
  assert.equal(new Set(sourceRows.map((item) => item.systemKey)).size, 2)
  for (const row of sourceRows) {
    assert.equal((await row.execute({ surfaceId: 'global-launcher', locale: 'en' })).ok, true)
    assert.equal(usePluginSettingsStore.getState().settingsDialogTarget.source, row.source)
    assert.deepEqual(usePluginSettingsStore.getState().settingsDialogTarget.target, { sectionId: 'source-section', fieldKey: 'sourceField' })
  }
  pluginRegistry.unregisterProductionPlugin('settings-source-fixture')
  pluginRegistry.unregisterDevPlugin('settings-source-fixture')

  // Fast static results are emitted before host I/O and survive its failure.
  const partials = []
  let releaseHost
  registry.setHostLauncherDynamicItemsProvider(() => new Promise((resolve) => { releaseHost = resolve }))
  const pending = collect('settings image', 'en', { onPartial: (update) => partials.push(update) })
  assert.ok(partials[0].items.some((item) => item.systemKey.endsWith(':recordImages')))
  releaseHost([{ systemKey: 'host:test:other', kind: 'host', display: { title: 'Other' }, behavior: { type: 'perform' }, execute: () => ({ ok: true }) }])
  const combined = await pending
  assert.ok(combined.some((item) => item.systemKey === 'host:test:other'))
  assert.deepEqual(partials.at(-1).items, combined)
  registry.setHostLauncherDynamicItemsProvider(async () => { throw new Error('Synthetic unrelated host failure') })
  const warn = console.warn
  console.warn = () => {}
  try { assert.ok(fieldRows(await collect('settings image')).length > 0) } finally { console.warn = warn }

  // Preserve the legacy plugin-level settings entry as an independent candidate.
  registry.setHostLauncherDynamicItemsProvider(() => [])
  pluginRegistry.registerProductionPlugin('legacy-settings-entry', [], [], [], [], {
    settings: { title: 'Legacy', defaultValue: {}, schema: { sections: [] } },
    launcher: { items: [{ id: 'settings', hostEntry: 'plugin-settings' }] },
  })
  assert.ok(registry.collectStaticCandidates('global-launcher').some((item) => item.systemKey === 'plugin-settings:builtin:legacy-settings-entry'))
} finally {
  await vite.close()
}
console.log('settings field search: static safety, real registry/ranking, navigation and lifecycle checks passed')
