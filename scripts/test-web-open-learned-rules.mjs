#!/usr/bin/env node
/** Legacy URL-rule cleanup must remove automatic rules and retain manual ones. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadModule(path, modules = {}) {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const exports = {}
  const sandbox = {
    exports, module: { exports }, console,
    require(specifier) {
      assert.ok(Object.hasOwn(modules, specifier), `unexpected dependency: ${specifier}`)
      return modules[specifier]
    },
  }
  vm.runInNewContext(output, sandbox, { filename: path })
  return sandbox.module.exports
}

const model = loadModule('src/plugins/web-open/settings/model.ts')
const learnedRules = loadModule('src/plugins/web-open/learnedRules.ts', { './settings/model': model })
const { isAutoLearnedEntry } = learnedRules
const cache = loadModule('src/plugins/web-open/matchPatternCache.ts')
const history = loadModule('src/plugins/web-open/queryHistory.ts')
const browserModel = loadModule('src/plugins/web-open/browserTabsModel.ts')
const plugin = loadModule('src/plugins/web-open/index.tsx', {
  '@hiven/plugin': { definePlugin: (definition) => definition },
  './settings/model': model,
  './learnedRules': learnedRules,
  './matchPatternCache': cache,
  './queryHistory': history,
  './browserTabsModel': browserModel,
  './settings/FaviconCacheModal': {},
  './settings/BrowserTabsConnectionModal': {},
  './faviconCache': {},
  './browserProvider': {},
}).default

assert.equal(isAutoLearnedEntry({ learnedFrom: 'url:example.com/{hex}' }), true)
assert.equal(isAutoLearnedEntry({ tags: ['work', model.AUTO_CREATED_TAG] }), true)
assert.equal(isAutoLearnedEntry({ learnedFrom: '', tags: [] }), false)
assert.equal(isAutoLearnedEntry({ tags: ['manual', 'automation'] }), false)
assert.equal(isAutoLearnedEntry({}), false)
assert.equal(learnedRules.learnedOfferToEntry, undefined, 'migration helper must not recreate automatic URL rules')

const manual = {
  id: 'manual-logid', title: 'Manual log lookup', aliases: ['logs'], placeholder: 'Log ID',
  urlTemplate: 'https://example.com/logs/{query}', encodeQuery: false,
  emptyQueryBehavior: 'block', matchPattern: '^LOG-[0-9]+$',
  recordQueryHistory: true, maxQueryHistory: 12, tags: ['work'],
}
const oldAutomaticRules = [
  { ...manual, id: 'learned-cluster', learnedFrom: 'url:example.com/{id}', tags: [] },
  { ...manual, id: 'auto-tag', tags: [model.AUTO_CREATED_TAG] },
  { ...manual, id: 'edited-auto-title', title: 'Renamed old rule', learnedFrom: 'url:example.net/{hex}' },
]
const saved = { enabled: false, entries: [manual, ...oldAutomaticRules] }
const before = structuredClone(saved)
const migrated = plugin.settings.migrate(saved, 8)
assert.equal(migrated.enabled, false)
assert.equal(migrated.entries.length, 1)
assert.deepEqual(JSON.parse(JSON.stringify(migrated.entries[0])), manual, 'manual rule fields and pattern survive migration')
assert.deepEqual(saved, before, 'migration must not mutate stored settings')
assert.deepEqual(
  JSON.parse(JSON.stringify(plugin.settings.migrate(migrated, 8))),
  JSON.parse(JSON.stringify(migrated)),
  'cleanup is idempotent',
)
assert.equal(plugin.settings.migrate({ entries: oldAutomaticRules }, 8).entries.length, 0)
assert.equal(plugin.settings.migrate({ entries: [] }, 8).entries.length, 0, 'an explicitly empty rule list stays empty')
assert.equal(plugin.settings.migrate(null, 8).entries.length, model.DEFAULT_WEB_QUICK_OPEN_SETTINGS.entries.length)
assert.ok(cache.testMatchPattern(manual.matchPattern, 'LOG-123'), 'the manual rule remains usable after migration')
assert.equal(cache.testMatchPattern(manual.matchPattern, 'unrelated-query'), false)

const source = readFileSync('src/plugins/web-open/index.tsx', 'utf8')
assert.doesNotMatch(source, /registerSink\(['"]web-open['"]/, 'automatic URL learning must remain disabled')
console.log('test-web-open-learned-rules: legacy cleanup passed')
