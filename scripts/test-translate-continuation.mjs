#!/usr/bin/env node
// Execute the real async controller with synthetic host receipts, without mounting UI or AI.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync('src/plugins/translate/surfaces/TranslateSurface.tsx', 'utf8')
const handler = source.slice(source.indexOf('  const continueProcessing = async'), source.indexOf('  const activeUsedChars'))
function harness(send) {
  const view = { outputText: '完整结果\r\n末行' }
  const output = { view }
  let current = output
  let shown = null
  let cancels = 0
  const messages = []
  const calls = []
  const outputActionRef = { current: null }
  const returnSubmissionRef = { current: null }
  const run = vm.runInNewContext(`${handler}\ncontinueProcessing`, {
    availableOutput: output, AbortController, outputActionRef, returnSubmissionRef,
    mountedRef: { current: true },
    canUseOutput: (value) => value === current,
    setOutputActionView: (value) => { shown = typeof value === 'function' ? value(shown) : value },
    host: { returnToLauncherWithObject: (block, options) => { calls.push({ block, options }); return send() }, showMessage: (text) => messages.push(text) },
    t: (key) => key,
    cancelCurrentRun: () => { cancels++; current = null },
  })
  return { run, calls, messages, outputActionRef, returnSubmissionRef, shown: () => shown, cancels: () => cancels, stale: () => { current = null } }
}
for (const send of [async () => false, async () => { throw Error('synthetic failure') }]) {
  const h = harness(send)
  await h.run()
  assert.equal(h.cancels(), 0)
  assert.equal(h.shown(), null)
  assert.equal(h.outputActionRef.current, null)
  assert.equal(h.returnSubmissionRef.current, null)
  assert.deepEqual(h.messages, ['toast.continueFailed'])
  await h.run()
  assert.equal(h.calls.length, 2, 'a refused handoff can be retried without changing the result')
  assert.equal(h.calls[1].block.text, '完整结果\r\n末行')
  assert.ok(h.calls[1].options.signal instanceof AbortSignal)
}
{
  let resolve
  const h = harness(() => new Promise((done) => { resolve = done }))
  const pending = h.run()
  await h.run()
  assert.equal(h.calls.length, 1, 'single-flight delivery')
  h.stale()
  resolve(false)
  await pending
  assert.deepEqual(h.messages, [], 'late failure cannot affect new material')
  assert.equal(h.cancels(), 0)
}
{
  const h = harness(async () => true)
  await h.run()
  assert.equal(h.cancels(), 1, 'cancel old processing only after accepted delivery')
  assert.equal(h.shown(), null)
}
console.log('Translation continuation: refusal, failure, retry, single-flight, stale receipt, and accepted completion passed (synthetic host only).')
