#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
assert.equal(lock.lockfileVersion, 3)
let checked = 0
for (const [name, entry] of Object.entries(lock.packages)) {
  if (!entry.resolved) continue
  const source = new URL(entry.resolved)
  assert.equal(source.protocol, 'https:', `${name}: dependency archives must use HTTPS`)
  assert.equal(source.hostname, 'registry.npmjs.org', `${name}: public builds must not depend on a private registry mirror`)
  assert.equal(source.username + source.password + source.search, '', `${name}: package URLs must not contain credentials or query tokens`)
  assert.ok(entry.version && entry.integrity, `${name}: keep the exact version and archive integrity`)
  checked += 1
}
assert.ok(checked > 0)
console.log(`Public dependency registry contract passed (${checked} locked archives).`)
