#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { md5Hex } from '../src/plugins/text-tools/hash/md5.ts'

const encoder = new TextEncoder()
for (const text of ['', 'abc', 'hello 世界', 'a'.repeat(1000)]) {
  assert.equal(md5Hex(encoder.encode(text)), createHash('md5').update(text).digest('hex'), `md5 ${text.slice(0, 8)}`)
}
console.log('crypto md5 test passed')
