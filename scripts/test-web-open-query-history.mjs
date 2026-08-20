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

const history = loadModule('src/plugins/web-open/queryHistory.ts', { stripImports: stripTypeImports })

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
  assert.equal(items.length, 3)
  assert.ok(!items.some((i) => i.text === 'baz' && items.findIndex((x) => x.text === 'baz') === 0))
}

// filter
{
  const items = [
    { text: 'Hello World', lastUsedAt: 3 },
    { text: 'foo', lastUsedAt: 2 },
    { text: 'HEL', lastUsedAt: 1 },
  ]
  assert.equal(history.filterQueryHistory(items, '').length, 3)
  assert.deepEqual(
    history.filterQueryHistory(items, 'hel').map((i) => i.text),
    ['Hello World', 'HEL'],
  )
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

// model fields
const model = loadModule('src/plugins/web-open/settings/model.ts', { stripImports: stripTypeImports })
assert.equal(model.DEFAULT_MAX_QUERY_HISTORY, 20)
for (const entry of model.DEFAULT_WEB_QUICK_OPEN_SETTINGS.entries) {
  assert.equal(entry.recordQueryHistory, false)
}

// controller / types wiring source checks
const controllerSource = readFileSync('src/workspace/launcher/controller.ts', 'utf8')
assert.match(controllerSource, /selectedSuggestionIndex/)
assert.match(controllerSource, /moveSuggestionHighlight/)
assert.match(controllerSource, /refreshSuggestions/)
assert.match(controllerSource, /item\.suggest/)

const typesSource = readFileSync('src/workspace/launcher/types.ts', 'utf8')
assert.match(typesSource, /LauncherSuggestHandler/)
assert.match(typesSource, /suggest\?:/)

// registry.ts delegates contribution field mapping to normalizeContribution —
// that is where the suggest passthrough actually lives (this assertion used to
// point at registry.ts and had been silently stale since that refactor).
const registrySource = readFileSync('src/workspace/launcher/registry.ts', 'utf8')
assert.match(registrySource, /resolveDynamicItem[\s\S]*normalizeContribution/)
const normalizeSource = readFileSync('src/workspace/launcher/normalizeContribution.ts', 'utf8')
assert.match(normalizeSource, /suggest: contribution\.suggest/)

const webOpenSource = readFileSync('src/plugins/web-open/index.tsx', 'utf8')
assert.match(webOpenSource, /recordQueryHistory/)
assert.match(webOpenSource, /suggestHistoryForEntry|suggest:/)
assert.match(webOpenSource, /query-history/)

const keyboardSource = readFileSync('src/components/launcher/GlobalLauncherKeyboard.ts', 'utf8')
assert.match(keyboardSource, /moveSuggestionHighlight/)

console.log('test-web-open-query-history: ok')
