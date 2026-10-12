#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const code = ts.transpileModule(readFileSync('src/plugins/text-explode/outputActionGate.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2023 },
}).outputText
const { createExplodeOutputGate, settleExplodeHandoff } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const snapshot = (gate, text = 'Current assembled preview') => ({ text, revision: gate.getRevision() })
let passed = 0
function check(name, run) {
  try { run(); passed += 1 }
  catch (error) { error.message = `${name}: ${error.message}`; throw error }
}

check('empty output cannot claim the native output lock', () => {
  const gate = createExplodeOutputGate()
  assert.equal(gate.begin(snapshot(gate, '')), false)
  assert.equal(gate.begin(snapshot(gate, '中文\n\n🙂')), true)
})
check('only one output may start before settlement', () => {
  const gate = createExplodeOutputGate(), first = snapshot(gate), second = snapshot(gate)
  assert.equal(gate.begin(first), true)
  assert.equal(gate.begin(first), false)
  assert.equal(gate.begin(second), false)
  gate.finish(first)
  assert.equal(gate.begin(second), true)
})
check('editing revokes retained callbacks even if the preview text returns to its old value', () => {
  const gate = createExplodeOutputGate(), old = snapshot(gate, 'A')
  gate.invalidate()
  const intermediate = snapshot(gate, 'B')
  gate.invalidate()
  const current = snapshot(gate, 'A')
  assert.equal(gate.isCurrent(old), false)
  assert.equal(gate.begin(old), false)
  assert.equal(gate.begin(intermediate), false)
  assert.equal(gate.begin(current), true)
})
check('editing does not unlock a non-cancellable copy or paste in flight', () => {
  const gate = createExplodeOutputGate(), pending = snapshot(gate)
  assert.equal(gate.begin(pending), true)
  gate.invalidate()
  const current = snapshot(gate, 'New preview')
  assert.equal(gate.isCurrent(pending), false, 'late completion cannot close a newer workflow')
  assert.equal(gate.begin(current), false)
  gate.finish(pending)
  assert.equal(gate.begin(current), true)
})
check('a different or previously settled operation cannot unlock the current writer', () => {
  const gate = createExplodeOutputGate(), old = snapshot(gate), current = snapshot(gate)
  gate.begin(old)
  gate.finish({ ...old })
  assert.equal(gate.begin(current), false)
  gate.finish(old)
  gate.begin(current)
  gate.finish(old)
  assert.equal(gate.begin(snapshot(gate)), false)
})
check('handoff failure leaves the same selection eligible for retry', () => {
  const gate = createExplodeOutputGate(), output = snapshot(gate, 'retain this\n\nexact preview')
  assert.equal(gate.begin(output), true)
  gate.finish(output)
  assert.equal(gate.isCurrent(output), true)
  assert.equal(gate.begin(output), true)
  assert.equal(output.text, 'retain this\n\nexact preview')
})
check('successful handoff blocks double-clicks and every other output for that preview', () => {
  const gate = createExplodeOutputGate(), output = snapshot(gate)
  gate.begin(output)
  gate.finish(output, true)
  assert.equal(gate.begin(output), false)
  assert.equal(gate.begin(snapshot(gate)), false)
  gate.invalidate()
  assert.equal(gate.begin(output), false)
  assert.equal(gate.begin(snapshot(gate)), true)
})
check('late settlement of an obsolete handoff does not consume the newer draft', () => {
  const gate = createExplodeOutputGate(), output = snapshot(gate)
  gate.begin(output)
  gate.invalidate()
  gate.finish(output, true)
  assert.equal(gate.begin(snapshot(gate)), true)
})

console.log(`Text Explode output gate passed: ${passed} revision and native-output concurrency cases`)


for (const failure of [false, undefined, 'reject']) {
  const gate = createExplodeOutputGate(), output = snapshot(gate, '完整选择\r\nlast')
  gate.begin(output)
  const result = await settleExplodeHandoff(output, gate, async () => {
    if (failure === 'reject') throw Error('synthetic failure')
    return failure
  }, () => true)
  assert.equal(result, 'failed')
  assert.equal(gate.begin(output), true, 'failed/refused receipt releases the same selection for retry')
  assert.equal(output.text, '完整选择\r\nlast')
  assert.equal(await settleExplodeHandoff(output, gate, async () => true, () => true), 'accepted')
  assert.equal(gate.begin(output), false)
}
for (const change of ['edit', 'unmount']) {
  const gate = createExplodeOutputGate(), output = snapshot(gate)
  gate.begin(output)
  let resolve
  let active = true
  let signal
  const pending = settleExplodeHandoff(output, gate, (s) => { signal = s; return new Promise((done) => { resolve = done }) }, () => active)
  assert.equal(gate.begin(output), false, 'pending host receipt keeps the output single-flight')
  if (change === 'unmount') active = false
  gate.invalidate()
  assert.equal(signal.aborted, true)
  resolve(true)
  assert.equal(await pending, 'stale')
  assert.equal(gate.begin(snapshot(gate)), true, 'late acceptance cannot consume the next selection')
}
console.log('Text Explode async handoff passed: exact selection retention, false/reject retry, acceptance, and stale-owner abort (synthetic host).')


// Back/Close intent is not draft deletion: it invalidates a pending native writer
// before the discard dialog, while Keep editing can reuse the exact selection.
for (const action of ['copy', 'paste', 'continue']) {
  const gate = createExplodeOutputGate()
  const text = 'same selection\r\n尾行'
  const pending = snapshot(gate, text)
  gate.begin(pending)
  const signal = gate.signal(pending)
  gate.invalidate() // requestBack/close before host confirmation
  assert.equal(gate.isCurrent(pending), false, `${action}: late completion cannot close the kept draft`)
  assert.equal(signal.aborted, true)
  gate.finish(pending, action === 'continue')
  const kept = snapshot(gate, text)
  assert.equal(gate.begin(kept), true, `${action}: Keep editing retains a retryable selection`)
  assert.equal(kept.text, pending.text)
}
console.log('Text Explode navigation intent revokes in-flight delivery without consuming the kept selection.')
