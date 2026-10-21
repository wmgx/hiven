import assert from 'node:assert/strict'
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
  unescapeJsonString,
  yamlToJson,
} = jsonCore

assert.equal(jsonCore.jsonPrettify('{"z":1,"a":{"d":2,"b":1},"__proto__":3}', 2, true), '{\n  "__proto__": 3,\n  "a": {\n    "b": 1,\n    "d": 2\n  },\n  "z": 1\n}')
assert.deepEqual(JSON.parse(queryStringToJson('?name=Ada&active=true')), { name: 'Ada', active: 'true' })
assert.deepEqual(JSON.parse(queryStringToJson('?empty=&name=%E4%BD%A0%E5%A5%BD')), { empty: '', name: '你好' })
for (const query of [
  'tag=one&tag=two',
  'tag=same&tag=same',
  '%74ag=one&tag=two',
  'a+b=one&a%20b=two',
  '=one&=two',
]) {
  assert.throws(() => queryStringToJson(query), (error) => error instanceof Error && error.message === 'queryDuplicateKey', query)
  assert.deepEqual(processJson(query, { operation: 'query-to-json' }), {
    ok: false, message: 'queryDuplicateKey', code: 'queryDuplicateKey',
  }, query)
}
const privateDuplicate = processJson('token=synthetic-secret&token=synthetic-other', { operation: 'query-to-json' })
assert.deepEqual(privateDuplicate, { ok: false, message: 'queryDuplicateKey', code: 'queryDuplicateKey' })
assert.doesNotMatch(JSON.stringify(privateDuplicate), /synthetic-(?:secret|other)/)
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

// int64 and high-precision decimals survive format / compact / sorted-format verbatim.
for (const source of ['9007199254740993', '12345678901234567890', '0.12345678901234567891', '1e400', '-0']) {
  const input = `{"value":${source},"label":"x"}`
  assert.equal(jsonCore.jsonPrettify(input), `{\n  "value": ${source},\n  "label": "x"\n}`, source)
  assert.equal(jsonCore.jsonCompact(input), input, source)
  assert.equal(jsonCore.jsonPrettify(input, 2, true), `{\n  "label": "x",\n  "value": ${source}\n}`, source)
}
assert.equal(jsonCore.jsonCompact('[9007199254740993,"9007199254740993"]'), '[9007199254740993,"9007199254740993"]')
for (const operation of ['format', 'compact'] as const) {
  const input = '{"z":0.1,"n":1e3,"id":"9007199254740993","escaped":"\\\"-0"}'
  const result = processJson(input, { operation, sortKeys: true })
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(JSON.parse(result.output), JSON.parse(input))
}

// yaml / query / expression keep int64 digits; nested query values are JSON text.
assert.equal(JSON.parse(yamlToJson('a: 1')).a, 1)
assert.match(yamlToJson('a: 9007199254740993'), /9007199254740993/)
assert.match(jsonToYaml('{"a":9007199254740993}'), /^a: 9007199254740993$/m)
assert.equal(evaluateJsonExpression('{"a":{"id":9007199254740993}}', '.a.id'), '9007199254740993')
assert.equal(jsonToQueryString('{"a":9007199254740993,"b":{"x":1},"c":null}'), 'a=9007199254740993&b=%7B%22x%22%3A1%7D&c=null')
