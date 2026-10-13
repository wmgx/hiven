#!/usr/bin/env node
// Actual read-only helper with synthetic storage; no component/UI or external I/O.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/components/pluginSettingsConfirmation.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const module = { exports: {} }
new Function('module', 'exports', compiled)(module, module.exports)
const { readSettingsConfirmationSnapshot: read } = module.exports
const defaults = { retentionMonths: 3, enabled: false }
const contribution = { version: 2, defaultValue: defaults, migrate: old => ({ ...defaults, ...old }) }
const record = (value, version = 2) => ({ version, value })
const fixture = initial => {
  let raw = initial
  const storage = {
    getItem(key) { assert.equal(key, 'hiven-plugin-settings'); return raw },
    setItem() { assert.fail('Confirmation helper must not persist') },
    removeItem() { assert.fail('Confirmation helper must not delete') },
  }
  return { storage, replace: value => { raw = value }, read: () => read(storage, 'builtin', 'clipboard-history', contribution) }
}
const envelope = entry => JSON.stringify({ state: { pluginSettings: { builtin: { 'clipboard-history': entry }, installed: {}, dev: {} } }, version: 0 })

test('absent settings use detached defaults and a null record baseline without writing', () => {
  const f = fixture(null), snapshot = f.read()
  assert.equal(snapshot.fingerprint, 'null'); assert.deepEqual(snapshot.value, defaults)
  snapshot.value.retentionMonths = 1
  assert.equal(defaults.retentionMonths, 3)
})

test('baseline covers every field and record version, while reads remain fresh', () => {
  const f = fixture(envelope(record({ retentionMonths: 12, enabled: false })))
  const original = f.read()
  f.replace(envelope(record({ retentionMonths: 12, enabled: true })))
  const otherField = f.read()
  assert.notEqual(original.fingerprint, otherField.fingerprint)
  f.replace(envelope(record({ retentionMonths: 12, enabled: true }, 1)))
  assert.notEqual(otherField.fingerprint, f.read().fingerprint)
  f.replace(envelope(record({ retentionMonths: 6, enabled: true })))
  assert.equal(f.read().value.retentionMonths, 6)
  assert.equal(original.value.retentionMonths, 12)
})

test('fingerprint uses durable pre-migration record while value uses existing migration', () => {
  const old = record({ retentionMonths: 12 }, 1), f = fixture(envelope(old))
  const snapshot = f.read()
  assert.equal(snapshot.fingerprint, JSON.stringify(old))
  assert.deepEqual(snapshot.value, { retentionMonths: 12, enabled: false })
  assert.equal(f.read().fingerprint, snapshot.fingerprint, 'read does not persist migration')
})

test('different plugin/source records do not contaminate the selected baseline', () => {
  const records = { builtin: { 'clipboard-history': record({ retentionMonths: 12 }), other: record({ x: 1 }) }, installed: { 'clipboard-history': record({ retentionMonths: 1 }) }, dev: {} }
  const f = fixture(JSON.stringify({ state: { pluginSettings: records } }))
  const initial = f.read()
  records.builtin.other.value.x = 2
  f.replace(JSON.stringify({ state: { pluginSettings: records } }))
  assert.equal(f.read().fingerprint, initial.fingerprint)
  assert.equal(read(f.storage, 'installed', 'clipboard-history', contribution).value.retentionMonths, 1)
})

test('storage failures, malformed JSON, future versions and invalid records fail closed', () => {
  assert.throws(() => read({ getItem() { throw new Error('synthetic read failure') } }, 'builtin', 'clipboard-history', contribution), /synthetic/)
  for (const raw of ['{broken', envelope(record({ retentionMonths: 12 }, 3)), envelope([]), envelope('invalid'), envelope(record([])), envelope(record(42))]) {
    assert.throws(() => fixture(raw).read())
  }
})

test('failed or invalid migration cannot become a confirmation value', () => {
  const f = fixture(envelope(record({ retentionMonths: 12 }, 1)))
  for (const migrate of [() => { throw new Error('synthetic migration failure') }, () => null, () => []]) {
    assert.throws(() => read(f.storage, 'builtin', 'clipboard-history', { ...contribution, migrate }))
  }
  assert.equal(f.read().value.retentionMonths, 12)
})
