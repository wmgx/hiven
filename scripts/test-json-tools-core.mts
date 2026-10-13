import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { operationRoutes } from '../src/plugins/json-tools/routes.ts'
import { searchableFieldsMatch } from '../src/workspace/searchRanking.ts'
import { jsonCore } from './helpers/text-transform-cores.mjs'

const {
  evaluateJsonExpression,
  escapeJsonString,
  jsonToYaml,
  jsonToQueryString,
  processJson,
  queryStringToJson,
  sortJsonKeys,
  unescapeJsonString,
  yamlToJson,
} = jsonCore

assert.equal(sortJsonKeys('{"z":1,"a":{"d":2,"b":1},"__proto__":3}'), '{\n  "__proto__": 3,\n  "a": {\n    "b": 1,\n    "d": 2\n  },\n  "z": 1\n}')
assert.deepEqual(JSON.parse(queryStringToJson('?name=Ada&active=true')), { name: 'Ada', active: 'true' })
assert.equal(jsonToQueryString('{"name":"Ada Lovelace","active":true}'), 'name=Ada+Lovelace&active=true')
assert.equal(escapeJsonString(' line\n'), '" line\\n"')
assert.equal(unescapeJsonString('" line\\n"'), ' line\n')
assert.equal(evaluateJsonExpression('{"items":[1,2,3]}', '.items.filter(value => value > 1)'), '[\n  2,\n  3\n]')
assert.deepEqual(processJson('   ', { operation: 'format' }), { ok: true, output: '' })
assert.equal(processJson('[]', { operation: 'json-to-query' }).ok, false)

const yamlJson = yamlToJson('released: 2026-09-21\noptional:\nitems:\n  - one\n  - two', 4)
assert.deepEqual(JSON.parse(yamlToJson(jsonToYaml(yamlJson, 4), 4)), {
  released: '2026-09-21', optional: null, items: ['one', 'two'],
})
const unsupportedYaml = processJson('value: .nan', { operation: 'yaml-to-json' })
assert.equal(unsupportedYaml.ok, false)
if (!unsupportedYaml.ok) assert.equal(unsupportedYaml.code, 'finiteNumberRequired')

assert.match(readFileSync('src/plugins/json-tools/index.ts', 'utf8'), /items: operationRoutes\.map/, 'workspace routes must use normal launcher search')
const formatRoute = operationRoutes.find((route) => route.id === 'format')!
const formatFields = { id: formatRoute.id, title: '', aliases: formatRoute.aliases }
assert.ok(['json for', 'geshihua', 'gsh'].every((query) => searchableFieldsMatch(formatFields, query, 'zh')), 'partial names, pinyin, and initials must find the same route')
assert.equal(searchableFieldsMatch(formatFields, '{"json":"format"}', 'zh'), false)

const fullUrl = 'https://example.test/search?q=hello+world&tag=one&tag=two&empty=#anchor'
assert.deepEqual(processJson(fullUrl, { operation: 'url-query-edit' }), { ok: true, output: fullUrl })
const invalidUrl = processJson('/relative?q=1', { operation: 'url-query-edit' })
assert.equal(invalidUrl.ok, false)
if (!invalidUrl.ok) assert.equal(invalidUrl.code, 'urlRequired')
console.log('json-tools core tests passed')

// Guard the exported entrypoints too: editor tools and previews bypass processJson.
for (const source of ['9007199254740993', '0.12345678901234567891', '1e400', '1e-400', '-0']) {
  const input = `{"value":${source},"label":"unchanged"}`
  for (const operation of ['format', 'compact', 'sort'] as const) {
    const result = processJson(input, { operation, sortKeys: true })
    assert.equal(result.ok, false, `${operation}: ${source}`)
    if (!result.ok) assert.equal(result.code, 'numberFidelity')
  }
  for (const transform of [jsonCore.jsonPrettify, jsonCore.jsonCompact, sortJsonKeys]) {
    assert.throws(() => transform(input), error => error instanceof Error && error.message === 'numberFidelity')
  }
}
for (const operation of ['format', 'compact', 'sort'] as const) {
  const input = '{"z":0.1,"n":1e3,"id":"9007199254740993","escaped":"\\\"-0"}'
  const result = processJson(input, { operation, sortKeys: true })
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(JSON.parse(result.output), JSON.parse(input))
}
