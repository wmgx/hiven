import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const entry = new URL('../src/plugins/currency-converter/index.ts', import.meta.url)
const require = createRequire(entry)
function load(file) {
  const module = { exports: {} }
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  })
  vm.runInNewContext(outputText, {
    module, exports: module.exports, window: { setTimeout, clearTimeout },
    require(id) {
      if (id === '@hiven/plugin') return { definePlugin: (definition) => definition }
      if (id === './CurrencySurface') return { CurrencySurface: () => null }
      if (id === './core' || id === './parse') return load(new URL(id + '.ts', entry))
      return require(id)
    },
  })
  return module.exports
}
const { dynamicItems } = load(entry).default.launcher
const now = Date.now()
const day = 86_400_000
const stored = [0, 1, 3].map((age, index) => ({
  amount: index + 1, from: 'USD', to: 'CNY', value: (index + 1) * 7,
  date: '2026-11-20', savedAt: now - age * day,
}))
const ctx = {
  surfaceId: 'global-launcher',
  query: 'cur history',
  locale: 'en',
  settings: { retentionDays: 2, maxEntries: 10 },
  storage: { kv: { get: async () => stored } },
  t: (key) => key,
}

assert.deepEqual(Array.from(await dynamicItems(ctx), (row) => row.display.title.split(' ')[0]), ['1', '2'])
ctx.settings.maxEntries = 1
const [row, extra] = await dynamicItems(ctx)
assert.equal(extra, undefined)
let copied
await row.execute({ api: { copyText: async (value) => { copied = value } } })
assert.equal(copied, '7.00')
console.log('Currency history retention, entry limit and reuse passed.')

const expression = {
  ...ctx,
  query: '1,399.99 US dollars to CNY',
  network: { request: async () => ({
    status: 200,
    body: JSON.stringify([
      { base: 'USD', quote: 'USD', rate: 1, date: '2026-11-20' },
      { base: 'USD', quote: 'CNY', rate: 7, date: '2026-11-20' },
      { base: 'USD', quote: 'JPY', rate: 150, date: '2026-11-20' },
    ]),
  }) },
}
const [answer] = await dynamicItems(expression)
assert.equal(answer.display.title, '1,399.99 USD ≈ 9,799.93 CNY')
assert.equal(answer.display.subtitle, '1 USD = 7 CNY · rateDate')
assert.equal(answer.params, undefined)
const invalid = await dynamicItems({ ...expression, query: '13,99.99 USD to CNY' })
assert.equal(invalid.length, 0)

const title = async (query) => (await dynamicItems({ ...expression, query }))[0]?.display.title
assert.equal(await title('100美元换人民币'), '100 USD ≈ 700.00 CNY')
assert.equal(await title('$1k'), '1,000 USD ≈ 7,000.00 CNY')
assert.equal(await title('100 usd'), '100 USD ≈ 700.00 CNY')
assert.equal(await title('700块等于多少美元'), '700 CNY ≈ 100.00 USD')
assert.equal(await title('10 all'), undefined)
assert.equal(await title('cur 10 all'), 'lookup', 'the keyword turns an ambiguous word into a conversion row')
const multi = await dynamicItems({ ...expression, query: '100 usd to cny, jpy' })
assert.deepEqual(Array.from(multi, (row) => row.display.title), ['100 USD ≈ 700.00 CNY', '100 USD ≈ 15,000 JPY'])
assert.equal(new Set(Array.from(multi, (row) => row.id)).size, 2)
assert.deepEqual(Array.from(await dynamicItems({ ...expression, query: '100美元换人民币和日元' }), (row) => row.display.title.split(' ').at(-1)), ['CNY', 'JPY'])
console.log('Natural-language currency conversion and amount validation passed.')
