import assert from 'node:assert/strict'
import { compactJson, formatJson, sortKeys, urlDecode, urlEncode } from '../src/kits/textTransforms/index.ts'
import { jsonCore, encodeDecodeCore } from './helpers/text-transform-cores.mjs'

const {
  jsonCompact,
  jsonPrettify,
  processJson,
  sortKeys: pluginSortKeys,
} = jsonCore
const {
  transformText,
  urlDecode: pluginUrlDecode,
  urlEncode: pluginUrlEncode,
} = encodeDecodeCore

// Existing plugins and the workbench must share the actual implementations.
assert.equal(jsonPrettify, formatJson)
assert.equal(jsonCompact, compactJson)
assert.equal(pluginSortKeys, sortKeys)
assert.equal(pluginUrlEncode, urlEncode)
assert.equal(pluginUrlDecode, urlDecode)

const json = ' \r\n {"b":2,"a":" 空格 "} \t '
assert.equal(formatJson(json), '{\n  "b": 2,\n  "a": " 空格 "\n}')
assert.equal(formatJson(json, 4, true), '{\n    "a": " 空格 ",\n    "b": 2\n}')
assert.equal(compactJson(json), '{"b":2,"a":" 空格 "}')
assert.equal(compactJson(formatJson(json)), compactJson(json))
assert.equal(formatJson(formatJson(json)), formatJson(json))

for (const operation of ['format', 'compact'] as const) {
  const transform = operation === 'format' ? formatJson : compactJson
  assert.deepEqual(processJson(json, { operation }), { ok: true, output: transform(json) })
  for (const text of ['', ' \r\n\t']) {
    assert.throws(() => transform(text), SyntaxError, 'raw transforms keep native parse failures')
    assert.deepEqual(processJson(text, { operation }), { ok: true, output: '' }, 'plugin empty-input policy stays outside the kit')
  }
  let parseError: unknown
  try { JSON.parse('{invalid') } catch (error) { parseError = error }
  assert.ok(parseError instanceof SyntaxError)
  assert.throws(() => transform('{invalid'), { name: parseError.name, message: parseError.message })
  assert.deepEqual(processJson('{invalid', { operation }), { ok: false, message: parseError.message, code: undefined })
}
assert.deepEqual(processJson('[]', { operation: 'json-to-query' }), {
  ok: false, message: 'objectRequired', code: 'objectRequired',
}, 'non-format JSON errors retain their public code')

const text = ' \r\n中文🙂 & a+b /?\t '
assert.equal(urlEncode(text), '%20%0D%0A%E4%B8%AD%E6%96%87%F0%9F%99%82%20%26%20a%2Bb%20%2F%3F%09%20')
assert.equal(urlDecode(urlEncode(text)), text, 'encoding preserves leading and trailing input whitespace')
assert.equal(urlDecode(' \t a+b%20c \r\n'), 'a+b c', 'decoding trims raw edges but keeps plus signs literal')
assert.equal(urlDecode('%20x%20'), ' x ', 'decoding never trims decoded whitespace')
assert.equal(transformText('url', 'encode', text), urlEncode(text))
assert.equal(transformText('url', 'decode', '  a%20b  '), urlDecode('  a%20b  '))
assert.throws(() => urlDecode('%E0%A4%A'), URIError)
assert.throws(() => urlEncode('\uD800'), URIError)

console.log('shared text transform identity, whitespace, errors, and invariants passed')
