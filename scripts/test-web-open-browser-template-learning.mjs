import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync('src/plugins/web-open/queryHistory.ts', 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const module = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)

assert.equal(
  module.queryFromBrowserUrl(
    'https://example.com/search?q={query}',
    'https://example.com/search?q=hello%20world&utm_source=tracker&trace_id=secret',
  ),
  'hello world',
)
assert.equal(
  module.queryFromBrowserUrl('https://example.com/issues/{query}', 'https://example.com/issues/ABC-123?from=feed'),
  'ABC-123',
)
assert.equal(
  module.queryFromBrowserUrl('https://example.com/search?q={query}', 'https://other.com/search?q=hello'),
  null,
)

let stored
const storage = {
  kv: {
    get: async () => stored,
    set: async (_key, value) => { stored = value },
    delete: async () => { stored = undefined },
  },
}
const imported = await module.importBrowserQueryHistory(
  storage,
  [{ id: 'search', urlTemplate: 'https://example.com/search?q={query}', recordQueryHistory: true, maxQueryHistory: 10 }],
  [
    { url: 'https://example.com/search?q=kept&utm_source=dropped', lastVisitTime: 1 },
    { url: 'https://example.com/search?q=kept&trace_id=dropped', lastVisitTime: 2 },
  ],
)
assert.equal(imported, 1)
assert.deepEqual(stored.queries.map((item) => item.text), ['kept'])

console.log('web-open browser template learning checks passed')
