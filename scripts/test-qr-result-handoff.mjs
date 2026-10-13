import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/plugins/qr-code/qrResultHandoff.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module, exports: module.exports, AbortController })
const { createQrResultHandoff } = module.exports
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
let state
const handoff = createQrResultHandoff(next => { state = next })
handoff.activate()
const original = { ok: true, text: '  synthetic%20text\n完整\n  ' }
handoff.setResult(original)
let calls = [], response = deferred(), ownerCurrent = true
const host = { deliveryFeedbackOwner: { isCurrent: () => ownerCurrent }, returnToLauncherWithObject(block, options) { calls.push({ block, options }); return response.promise } }
const first = state
const pending = handoff.submit(first, host)
await handoff.submit(first, host)
await handoff.submit(state, host)
assert.equal(calls.length, 1)
assert.equal(calls[0].block.text, original.text)
assert.equal(calls[0].block.source, 'tool-result')
response.resolve(false); await pending
assert.equal(state.status, 'failed'); assert.equal(state.result, original)
response = deferred(); const retry = handoff.submit(state, host)
// The host revokes the copy/paste owner when initiating its own handoff. This
// must not self-cancel the separately owned handoff or create another navigation.
ownerCurrent = false; response.resolve(true); await retry
assert.equal(state.status, 'accepted')
await handoff.submit(state, host); assert.equal(calls.length, 2)
ownerCurrent = true
for (const revoke of ['replace', 'same-text', 'leave', 'dispose']) {
  handoff.activate(); handoff.setResult(original); response = deferred()
  const old = state, run = handoff.submit(old, host), submission = calls.at(-1)
  if (revoke === 'replace') handoff.setResult({ ok: true, text: 'new result' })
  if (revoke === 'same-text') handoff.setResult({ ...original })
  if (revoke === 'leave') handoff.interrupt()
  if (revoke === 'dispose') handoff.deactivate()
  const expected = state
  assert.equal(submission.options.signal.aborted, true)
  response.resolve(true); await run
  assert.equal(state, expected)
  const count = calls.length
  await handoff.submit(old, host)
  assert.equal(calls.length, count, 'old callback cannot send a newer or previous scan')
}
handoff.activate(); handoff.setResult(original); response = deferred()
const rejected = handoff.submit(state, host); response.reject(Error('synthetic failure')); await rejected
assert.equal(state.status, 'failed'); assert.equal(state.result.text, original.text)
ownerCurrent = false; const count = calls.length; await handoff.submit(state, host); assert.equal(calls.length, count)
ownerCurrent = true; handoff.setResult(null); await handoff.submit(state, host); assert.equal(calls.length, count)
console.log('PASS QR full text, explicit ownership, deduplication, retry, same-text rescan, replacement, leave and late receipts')
