import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { operationRoutes } from '../src/plugins/json-tools/routes.ts'
import { searchableFieldsMatch } from '../src/workspace/searchRanking.ts'
import {
  evaluateJsonExpression,
  escapeJsonString,
  jsonToYaml,
  jsonToQueryString,
  processJson,
  queryStringToJson,
  sortJsonKeys,
  unescapeJsonString,
  yamlToJson,
} from '../src/plugins/json-tools/jsonCore.ts'

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

console.log('json-tools core tests passed')
