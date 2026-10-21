#!/usr/bin/env node
/**
 * Unit checks for web-open query history pure helpers + host suggest wiring.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadModule(path, { stripImports = [], globals = {} } = {}) {
  let src = readFileSync(path, 'utf8')
  for (const re of stripImports) src = src.replace(re, '')
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const stripTypeImports = [
  /import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g,
  /import\s*\{[\s\S]*?\}\s*from\s*'@hiven\/plugin'\s*;?\s*\n?/g,
]

const history = loadModule('src/plugins/web-open/queryHistory.ts', { stripImports: stripTypeImports, globals: { URL } })

// upsert: empty no-op
assert.deepEqual(history.upsertQueryHistory([], '  ', 20), [])

// upsert: dedupe + front + truncate
{
  let items = []
  items = history.upsertQueryHistory(items, 'foo', 3, 1)
  items = history.upsertQueryHistory(items, 'bar', 3, 2)
  items = history.upsertQueryHistory(items, 'baz', 3, 3)
  items = history.upsertQueryHistory(items, 'qux', 3, 4)
  assert.equal(items.length, 3)
  assert.equal(items[0].text, 'qux')
  items = history.upsertQueryHistory(items, 'bar', 3, 5)
  assert.equal(items[0].text, 'bar')
  assert.equal(items[0].useCount, 2)
  assert.equal(items.length, 3)
  assert.ok(!items.some((i) => i.text === 'baz' && items.findIndex((x) => x.text === 'baz') === 0))
}

// ranking: repeated use outweighs a single slightly newer hit; old records migrate as count=1
{
  const now = 100 * 24 * 60 * 60 * 1000
  const items = history.normalizeQueryHistory({ queries: [
    { text: 'frequent', lastUsedAt: now - 2 * 24 * 60 * 60 * 1000, useCount: 8 },
    { text: 'new', lastUsedAt: now - 1 * 24 * 60 * 60 * 1000 },
  ] })
  assert.equal(items[1].useCount, 1)
  assert.equal(history.filterQueryHistory(items, '', now).map((i) => i.text).join(','), 'frequent,new')
}

// filter
{
  const items = [
    { text: 'Hello World', lastUsedAt: 3 },
    { text: 'foo', lastUsedAt: 2 },
    { text: 'HEL', lastUsedAt: 1 },
  ]
  assert.equal(history.filterQueryHistory(items, '').length, 3)
  assert.equal(history.filterQueryHistory(items, 'hel').map((i) => i.text).join(','), 'Hello World,HEL')
}

// remove
{
  const items = [
    { text: 'a', lastUsedAt: 2 },
    { text: 'b', lastUsedAt: 1 },
  ]
  assert.deepEqual(
    history.removeQueryHistoryItem(items, 'a').map((i) => i.text),
    ['b'],
  )
}

// searchParams values are already decoded: no second decode of literal percent text
assert.equal(history.queryFromBrowserUrl('https://x.test/s?q={query}', 'https://x.test/s?q=a%2520b'), 'a%20b')
assert.equal(history.queryFromBrowserUrl('https://x.test/s?q={query}', 'https://x.test/s?q=100%25'), '100%')
assert.equal(history.queryFromBrowserUrl('https://x.test/s/{query}', 'https://x.test/s/a%20b'), 'a b')

// model fields
const model = loadModule('src/plugins/web-open/settings/model.ts', { stripImports: stripTypeImports })
assert.equal(model.DEFAULT_MAX_QUERY_HISTORY, 20)
for (const entry of model.DEFAULT_WEB_QUICK_OPEN_SETTINGS.entries) {
  assert.equal(entry.recordQueryHistory, false)
}

console.log('test-web-open-query-history: ok')
