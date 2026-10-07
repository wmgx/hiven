#!/usr/bin/env node
/** Shared launcher visibility: preserve ranking, retain every available pin. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/workspace/launcher/visibleItems.ts', import.meta.url), 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText
const moduleExports = {}
vm.runInNewContext(output, { exports: moduleExports, module: { exports: moduleExports } })
const { MAX_VISIBLE_IDLE, selectLauncherVisibleItems } = moduleExports

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

check('browse returns all available candidates in first-occurrence order, even with a query', () => {
  const availableItems = Object.freeze([
    ordinary[20], pins[0], ...ordinary, item(ordinary[20].key, 'duplicate'), pins[0], pins[1],
  ])
  for (const query of ['', 'a nonempty query']) {
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
