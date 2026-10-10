#!/usr/bin/env node
/** Shared launcher visibility: ranking, favorites, and classified action browsing. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const modules = new Map()
function loadModule(url) {
  if (modules.has(url.href)) return modules.get(url.href)
  const source = readFileSync(url, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const exports = {}
  modules.set(url.href, exports)
  vm.runInNewContext(output, {
    exports,
    module: { exports },
    require(specifier) {
      assert.ok(specifier.startsWith('.'), `browse logic must have only local pure dependencies: ${specifier}`)
      return loadModule(new URL(`${specifier}.ts`, url))
    },
  }, { filename: url.pathname })
  return exports
}
const { MAX_VISIBLE_IDLE, selectLauncherVisibleItems } = loadModule(new URL('../src/workspace/launcher/visibleItems.ts', import.meta.url))
const { getLauncherBrowseCategory } = loadModule(new URL('../src/workspace/launcher/browseItems.ts', import.meta.url))

assert.equal(MAX_VISIBLE_IDLE, 12, 'ordinary idle recommendations keep their 12-row limit')

const item = (key, label = key) => Object.freeze({ key, label })
const keyOf = (row) => row.key
const keys = (rows) => Array.from(rows, keyOf)
const pins = Object.freeze(Array.from({ length: 24 }, (_, index) => item(`pin-${index}`)))
const ordinary = Object.freeze(Array.from({ length: 28 }, (_, index) => item(`ordinary-${index}`)))
let checked = 0
function check(name, run) {
  run()
  checked += 1
  console.log(`✓ ${name}`)
}

check('24 favorites survive both the 12-row visible cap and 16-row rank cap', () => {
  const favoriteKeys = Object.freeze(keys(pins).reverse())
  const rankedItems = Object.freeze(pins.slice(0, 16))
  const availableItems = Object.freeze([...pins].reverse())
  const visible = selectLauncherVisibleItems({ rankedItems, availableItems, favoriteKeys, query: '', keyOf })
  assert.equal(visible.length, 24)
  assert.deepEqual(keys(visible), [
    ...keys(pins.slice(0, 12)),
    ...keys(pins.slice(12)).reverse(),
  ], 'keep the ranked prefix, then append omitted pins in saved favorite order')
  assert.equal(new Set(keys(visible)).size, 24, 'pins already in the prefix appear only once')
  for (const pin of pins) assert.ok(visible.includes(pin), `preserve the actual candidate ${pin.key}`)
})

check('only pins extend idle recommendations; duplicate keys keep the first available item', () => {
  const duplicatePin = item(pins[0].key, 'later duplicate')
  const visible = selectLauncherVisibleItems({
    rankedItems: ordinary,
    availableItems: [...ordinary, pins[0], duplicatePin, pins[1]],
    favoriteKeys: [ordinary[0].key, pins[1].key, pins[0].key, pins[1].key, pins[0].key],
    query: '',
    keyOf,
  })
  assert.deepEqual(keys(visible), [...keys(ordinary.slice(0, 12)), pins[1].key, pins[0].key])
  assert.equal(visible[13], pins[0], 'first available instance wins over duplicate candidates')
  assert.equal(visible.filter((row) => row.key.startsWith('ordinary-')).length, 12)
})

check('a typed query preserves every ranked result and its original order', () => {
  const rankedItems = Object.freeze([...ordinary].reverse().concat(ordinary[3]))
  const visible = selectLauncherVisibleItems({
    rankedItems,
    availableItems: [...ordinary, ...pins],
    favoriteKeys: keys(pins),
    query: '  ordinary  ',
    browse: false,
    keyOf,
  })
  assert.deepEqual(keys(visible), keys(rankedItems), 'search must not be capped, reordered, deduplicated, or extended')
  assert.equal(visible.length, 29)
  assert.notEqual(visible, rankedItems, 'return a mutable result without exposing the readonly input array')
})

check('whitespace uses idle visibility and no favorites retain the original 12 recommendations', () => {
  for (const query of ['', ' \t\n ']) {
    const visible = selectLauncherVisibleItems({
      rankedItems: ordinary,
      availableItems: [...pins, ...ordinary],
      favoriteKeys: [],
      query,
      keyOf,
    })
    assert.deepEqual(keys(visible), keys(ordinary.slice(0, 12)))
  }
  const visible = selectLauncherVisibleItems({
    rankedItems: ordinary,
    availableItems: [...ordinary, pins[0]],
    favoriteKeys: [pins[0].key],
    query: '\n\t ',
    keyOf,
  })
  assert.deepEqual(keys(visible), [...keys(ordinary.slice(0, 12)), pins[0].key])
})

check('empty-query browse keeps every unknown candidate in first-occurrence order', () => {
  const availableItems = Object.freeze([
    ordinary[20], pins[0], ...ordinary, item(ordinary[20].key, 'duplicate'), pins[0], pins[1],
  ])
  for (const query of ['', ' \n\t ']) {
    const visible = selectLauncherVisibleItems({
      rankedItems: [ordinary[2]],
      availableItems,
      favoriteKeys: [pins[1].key, pins[0].key],
      query,
      browse: true,
      keyOf,
    })
    assert.deepEqual(keys(visible), [ordinary[20].key, pins[0].key,
      ...keys(ordinary.filter((row) => row !== ordinary[20])), pins[1].key])
    assert.equal(visible.length, 30, 'browse has no idle or ranked cap')
    assert.equal(visible[0], ordinary[20])
  }
})

check('a nonempty query wins over every stale browse category and keeps fresh ranked objects', () => {
  const freshResult = item('fresh-query-result')
  const rankedItems = Object.freeze([freshResult, ordinary[17], ordinary[4], ordinary[17]])
  for (const browseCategory of ['all', 'tools', 'apps', 'system']) {
    const visible = selectLauncherVisibleItems({
      rankedItems,
      availableItems: [ordinary[4], ...pins],
      favoriteKeys: keys(pins),
      query: '  new query  ',
      browse: true,
      browseCategory,
      browseItemOf() { throw new Error('search must never classify browse candidates') },
      keyOf,
    })
    assert.deepEqual(keys(visible), keys(rankedItems))
    assert.equal(visible[0], freshResult, 'a fresh query result need not be in the old browse candidates')
    assert.equal(visible[1], rankedItems[1])
    assert.equal(visible[3], rankedItems[3], 'search preserves duplicates, order, and every ranked result')
  }
})

check('classification uses identity and metadata, including management before plugin/app capability', () => {
  const classify = (systemKey, metadata = {}) => getLauncherBrowseCategory({ systemKey, ...metadata })
  for (const key of [
    'host:view:settings', 'host:view:plugins', 'host:view:devtools',
    'host:system:restart', 'host:system:shutdown', 'host:system:lock-screen',
    'host:experience:learning-inbox', 'host:experience:pause',
    'host:saved-action:save-last', 'host:saved-action:delete',
    'host:saved-action:rename:one', 'host:saved-action:delete:one',
  ]) assert.equal(classify(key), 'system', key)
  assert.equal(classify('plugin-settings:installed:calculator', { pluginId: 'calculator' }), 'system')
  assert.equal(classify('host:app-launcher:refresh', {
    kind: 'host', behavior: { type: 'perform' }, requiredCapabilities: ['app-search'],
  }), 'system')
  for (const key of [
    'host:app-launcher:app:notes', 'host:window:focus:app:notes', 'host:tab:focus:app:browser',
    'host.window:focus:native:one', 'host.window:close:native:one', 'host.app:notes', 'browser.chromium:tab:one',
  ]) assert.equal(classify(key), 'apps', key)
  for (const capability of ['app-search', 'desktop-windows', 'desktop-browser-tabs']) {
    assert.equal(classify('new-provider:concrete-target', {
      kind: 'host', behavior: { type: 'perform' }, requiredCapabilities: [capability],
    }), 'apps', capability)
  }
  assert.equal(classify('host:view:quick-editor'), 'tools')
  assert.equal(classify('plugin:extra:dynamic:tool', { pluginId: 'extra' }), 'tools')
  assert.equal(classify('custom:product-action', { productProvider: 'Custom Product' }), 'tools')
  assert.equal(classify('plugin:web-open:launcher:quick-open', {
    pluginId: 'web-open', requiredCapabilities: ['desktop-browser-tabs'],
  }), 'tools', 'a plugin tool requiring a desktop capability remains a tool')
  assert.equal(classify('host:window:switch-command', {
    kind: 'host', behavior: { type: 'collect-input' }, requiredCapabilities: ['desktop-windows'],
  }), null, 'a window command is not a concrete window target')
  for (const key of ['host:future:action', 'browser.chromium:document:history', 'object-action:new-object']) {
    assert.equal(classify(key, {
      kind: 'host', display: { title: 'Settings', kindLabel: 'App', kindLabelI18n: { zh: '工具' } },
    }), null, 'display text must not guess a category for an unknown item')
  }
})

check('browse groups tools by the existing catalog, keeps all candidates, and preserves executable row indexes', () => {
  const executed = []
  const row = (systemKey, metadata = {}) => Object.freeze({
    kind: 'domain', id: systemKey, title: systemKey,
    domainItem: Object.freeze({ systemKey, execute: () => executed.push(systemKey), ...metadata }),
  })
  const app = row('host:app-launcher:app:notes')
  const settings = row('host:view:settings')
  const unknown = row('object-action:new-object')
  const textOne = row('plugin:line-tools:tool:first', { pluginId: 'line-tools' })
  const jsonOne = row('plugin:yaml:tool:first', { pluginId: 'yaml' })
  const textTwo = row('plugin:case:tool:second', { pluginId: 'case' })
  const calculator = row('plugin:calculator:tool:calculate', { pluginId: 'calculator' })
  const jsonTwo = row('plugin:json-tools:tool:second', { pluginId: 'json-tools' })
  const extraOne = row('plugin:extra-one:tool:first', { pluginId: 'extra-one', productProvider: 'Extra' })
  const quickEditor = row('host:view:quick-editor')
  const extraTwo = row('plugin:extra-two:tool:second', { pluginId: 'extra-two', productProvider: 'Extra' })
  const pluginSettings = row('plugin-settings:installed:calculator', { pluginId: 'calculator' })
  const providerOnly = row('provider:json', { productProvider: 'JSON / YAML Tools' })
  const availableItems = Object.freeze([
    app, settings, textOne, unknown, extraOne, jsonOne, textTwo, quickEditor,
    calculator, extraTwo, jsonTwo, pluginSettings, providerOnly,
    row(textOne.id, { pluginId: 'line-tools' }),
  ])
  const toolRows = [calculator, jsonOne, jsonTwo, providerOnly, textOne, textTwo, extraOne, extraTwo, quickEditor]
  const ids = (rows) => Array.from(rows, (item) => item.id)
  const before = ids(availableItems)
  for (const [browseCategory, expected] of [
    ['all', [...toolRows, app, settings, pluginSettings, unknown]],
    ['tools', toolRows], ['apps', [app]], ['system', [settings, pluginSettings]],
  ]) {
    const visible = selectLauncherVisibleItems({
      rankedItems: [settings], availableItems, favoriteKeys: [settings.id], query: '',
      browse: true, browseCategory, keyOf: (item) => item.id, browseItemOf: (item) => item.domainItem,
    })
    assert.deepEqual(ids(visible), ids(expected))
    for (let index = 0; index < visible.length; index += 1) {
      assert.equal(visible[index], expected[index], 'display and keyboard execution share the original wrapper')
      visible[index].domainItem.execute()
      assert.equal(executed.at(-1), expected[index].id)
    }
    assert.equal(new Set(ids(visible)).size, visible.length)
    visible.reverse()
    assert.deepEqual(ids(availableItems), before, 'sorting never mutates caller candidates')
  }
})

check('browse category has no effect on idle recommendations or available favorite expansion', () => {
  for (const browseCategory of ['all', 'tools', 'apps', 'system']) {
    const visible = selectLauncherVisibleItems({
      rankedItems: ordinary, availableItems: [...ordinary, pins[0]], favoriteKeys: [pins[0].key],
      query: '', browse: false, browseCategory, keyOf,
      browseItemOf() { throw new Error('idle must not classify browse candidates') },
    })
    assert.deepEqual(keys(visible), [...keys(ordinary.slice(0, 12)), pins[0].key])
  }
})

check('missing or unavailable favorites never create synthetic candidates', () => {
  const visible = selectLauncherVisibleItems({
    rankedItems: [],
    availableItems: [pins[0]],
    favoriteKeys: ['missing', 'disabled-plugin', pins[1].key, pins[0].key, 'missing'],
    query: '',
    keyOf,
  })
  assert.deepEqual(keys(visible), [pins[0].key])
  assert.equal(visible[0], pins[0], 'only caller-approved available candidates can be appended')
  assert.deepEqual(keys(selectLauncherVisibleItems({
    rankedItems: [], availableItems: [], favoriteKeys: keys(pins), query: '', keyOf,
  })), [])
})

check('unavailable favorites in the idle prefix disappear without backfilling ordinary rows', () => {
  const rankedItems = Object.freeze([pins[0], ...ordinary.slice(0, 5), pins[1], ...ordinary.slice(5)])
  const availableItems = Object.freeze([pins[1], pins[2]])
  const favoriteKeys = Object.freeze([pins[0].key, pins[1].key, pins[2].key])
  for (const query of ['', ' \n\t ']) {
    const visible = selectLauncherVisibleItems({ rankedItems, availableItems, favoriteKeys, query, keyOf })
    assert.deepEqual(keys(visible), [
      ...keys(ordinary.slice(0, 5)), pins[1].key, ...keys(ordinary.slice(5, 10)), pins[2].key,
    ], 'keep original ordinary rows, remove only the unavailable pin, then append an available pin')
    assert.ok(!visible.includes(pins[0]), 'an unavailable pin cannot survive through the ranked prefix')
    assert.ok(!visible.includes(ordinary[10]), 'ordinary row 13 must not fill the removed favorite slot')
  }
  const unpinned = selectLauncherVisibleItems({
    rankedItems, availableItems: [], favoriteKeys: [], query: '', keyOf,
  })
  assert.deepEqual(keys(unpinned), keys(rankedItems.slice(0, 12)), 'ordinary idle semantics remain unchanged without pins')
})

check('typed queries leave unavailable ranked favorites under the existing search contract', () => {
  const rankedItems = Object.freeze([pins[0], ...ordinary])
  const visible = selectLauncherVisibleItems({
    rankedItems,
    availableItems: [pins[1]],
    favoriteKeys: [pins[0].key, pins[1].key],
    query: 'search',
    keyOf,
  })
  assert.deepEqual(keys(visible), keys(rankedItems), 'availability filtering applies only to idle favorites')
  assert.equal(visible[0], pins[0])
})

check('all modes leave inputs and their order untouched', () => {
  const rankedItems = Object.freeze([...ordinary].reverse())
  const availableItems = Object.freeze([...pins, ...ordinary, pins[0]])
  const favoriteKeys = Object.freeze([pins[2].key, pins[0].key, pins[2].key])
  const before = JSON.stringify({ rankedItems, availableItems, favoriteKeys })
  for (const mode of [{ query: '' }, { query: 'search' }, { query: '', browse: true }]) {
    const options = Object.freeze({ rankedItems, availableItems, favoriteKeys, keyOf, ...mode })
    const visible = selectLauncherVisibleItems(options)
    assert.ok(visible.every((row) => rankedItems.includes(row) || availableItems.includes(row)))
    visible.reverse()
    visible.pop()
    assert.equal(JSON.stringify({ rankedItems, availableItems, favoriteKeys }), before)
  }
})

console.log(`launcher visible items checks passed (${checked} cases)`)
