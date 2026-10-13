#!/usr/bin/env node
// Actual production helper; synthetic owner generations, no UI/network I/O.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'
const text = readFileSync(new URL('../src/workspace/launcher/searchRecovery.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const module = { exports: {} }
new Function('module', 'exports', compiled)(module, module.exports)
const { createSearchAttempt } = module.exports
const fixture = (retrying = false) => {
  let current = true
  const events = []
  return { events, revoke: () => { current = false }, attempt: createSearchAttempt(() => current, (failed, pending) => events.push({ failed, pending }), retrying) }
}

test('ordinary successful empty collection stays non-failed', () => {
  const f = fixture(); f.attempt.report('date', false); f.attempt.finish()
  assert.deepEqual(f.events, [{ failed: false, pending: true }, { failed: false, pending: false }])
})
test('successful providers cannot erase another provider failure in either order', () => {
  for (const reverse of [false, true]) {
    const f = fixture()
    const updates = [['failed', true], ['healthy', false]]
    for (const [id, failed] of reverse ? updates.reverse() : updates) f.attempt.report(id, failed)
    f.attempt.finish()
    assert.deepEqual(f.events.at(-1), { failed: true, pending: false })
  }
})
test('failure identity is per provider and same-provider success resolves its own failure', () => {
  const f = fixture()
  f.attempt.report('a', true); f.attempt.report('b', true); f.attempt.report('a', false); f.attempt.finish()
  assert.deepEqual(f.events.at(-1), { failed: true, pending: false })
  const g = fixture(); g.attempt.report('a', true); g.attempt.report('a', false); g.attempt.finish()
  assert.deepEqual(g.events.at(-1), { failed: false, pending: false })
})
test('retry remains failed/pending during partial success and clears only on successful finish', () => {
  const f = fixture(true)
  f.attempt.report('healthy', false)
  assert.deepEqual(f.events.at(-1), { failed: true, pending: true })
  f.attempt.finish()
  assert.deepEqual(f.events.at(-1), { failed: false, pending: false })
})
test('retry failure remains actionable after completion', () => {
  const f = fixture(true); f.attempt.report('a', true); f.attempt.finish()
  assert.deepEqual(f.events.at(-1), { failed: true, pending: false })
})
test('collection rejection records failure even without provider partials', () => {
  const f = fixture(); f.attempt.finish(true)
  assert.deepEqual(f.events, [{ failed: true, pending: false }])
})
test('finish is terminal against duplicate completion and late provider callbacks', () => {
  const f = fixture(); f.attempt.finish()
  f.attempt.finish(true); f.attempt.report('late', true)
  assert.deepEqual(f.events, [{ failed: false, pending: false }])
})
test('cancel and owner revocation each reject late success, failure and completion', () => {
  for (const cancel of [true, false]) {
    const f = fixture(); if (cancel) f.attempt.cancel(); else f.revoke()
    f.attempt.report('a', true); f.attempt.report('a', false); f.attempt.finish(true)
    assert.deepEqual(f.events, [])
  }
})
test('query A to B to A uses new owner identity, not equal text', () => {
  let owner = { query: 'A' }
  const oldOwner = owner, events = []
  const old = createSearchAttempt(() => owner === oldOwner, (...event) => events.push(['old', ...event]))
  owner = { query: 'B' }; owner = { query: 'A' }
  const freshOwner = owner
  const fresh = createSearchAttempt(() => owner === freshOwner, (...event) => events.push(['fresh', ...event]))
  old.report('late', true); old.finish(true); fresh.finish()
  assert.deepEqual(events, [['fresh', false, false]])
})
test('cancelled attempt stays cancelled even if external owner predicate becomes current again', () => {
  let current = true
  const events = [], attempt = createSearchAttempt(() => current, (...event) => events.push(event))
  attempt.cancel(); current = false; current = true
  attempt.report('a', true); attempt.finish()
  assert.deepEqual(events, [])
})
