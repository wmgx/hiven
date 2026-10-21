import assert from 'node:assert/strict'
import { encodeDecodeCore } from './helpers/text-transform-cores.mjs'

const { transformText, isBase64, htmlDecode, unescapeSlashes } = encodeDecodeCore

// Literal escapes and real newlines must survive a workbench round trip.
const input = 'C:\\notes\\temp\n"你好" & <world>'
for (const format of ['base64', 'url', 'html', 'slashes'] as const) {
  assert.equal(transformText(format, 'decode', transformText(format, 'encode', input)), input)
}
assert.throws(() => transformText('base64', 'decode', '%%%'))

// Base64 detection really decodes; URL-safe and unpadded forms work.
for (const word of ['hello', 'password', 'test', 'abcd1234']) assert.equal(isBase64(word), false, word)
assert.equal(isBase64('SGVsbG8gV29ybGQ'), true)
assert.equal(transformText('base64', 'decode', 'SGVsbG8gV29ybGQ'), 'Hello World')
assert.equal(transformText('base64', 'decode', 'Pz8-'), '??>')
assert.equal(transformText('base64', 'decode', 'Pz8+'), '??>')
assert.throws(() => transformText('base64', 'decode', 'hello'))
assert.equal(htmlDecode('&#65;&#x42;&nbsp;&apos;&amp;lt;&#0;'), 'AB\u00a0\'&lt;&#0;')
assert.equal(unescapeSlashes('\\u4f60\\u597d \\ud83d\\ude00 \\n'), '你好 😀 \n')
console.log('encode-decode core checks passed')
