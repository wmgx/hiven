#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const code = ts.transpileModule(readFileSync('src/plugins/text-explode/outputActionGate.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2023 },
}).outputText
const { createExplodeOutputGate } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
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
