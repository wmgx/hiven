import assert from 'node:assert/strict'
import { transformText } from '../src/plugins/encode-decode/core.ts'

// Literal escapes and real newlines must survive a workbench round trip.
const input = 'C:\\notes\\temp\n"你好" & <world>'
for (const format of ['base64', 'url', 'html', 'slashes'] as const) {
  assert.equal(transformText(format, 'decode', transformText(format, 'encode', input)), input)
}
assert.throws(() => transformText('base64', 'decode', '%%%'))
console.log('encode-decode core checks passed')
