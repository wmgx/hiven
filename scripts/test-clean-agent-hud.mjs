#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(rel) {
  const compiled = ts.transpileModule(readFileSync(rel, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(`(function(module, exports) { ${compiled}\n})`, {
    module, exports: module.exports, AbortController, DOMException, Promise, Array, Math, setTimeout, clearTimeout,
  })(module, module.exports)
  return module.exports
}

const { CleanAgentHudSession, CLEAN_AGENT_MAX_INPUT_CHARS } = load('src/plugins/line-tools/cleanAgentHudSession.ts')

function harness({ input = '┌─────┐\r\n│ one │\n└─────┘', output = 'one', isSensitive = false, writeFails = false } = {}) {
  let now = 1000, reads = 0
  const shown = [], writes = [], dismissed = []
  const session = new CleanAgentHudSession({
    async read(signal, current) { reads += 1; assert.equal(signal.aborted, false); assert.equal(current(), true); return input },
    clean: () => output,
    isSensitive: () => isSensitive,
    async write(text, sensitive, signal) {
      writes.push({ text, sensitive, aborted: signal.aborted })
      if (writeFails) throw new Error('synthetic failure')
    },
    async present(view, fullText) { shown.push({ view: structuredClone(view), fullText }) },
    async activate() { return now + 120_000 },
    async dismiss(id, revision) { dismissed.push({ id, revision }) },
    now: () => now, schedule: () => 1, clearSchedule() {}, randomId: () => 'clean-session',
  })
  return { session, shown, writes, dismissed, reads: () => reads, setNow: (value) => { now = value } }
}

{
  const h = harness()
  assert.equal(await h.session.trigger(), 'started')
  assert.equal(h.reads(), 1, 'the clipboard must be read exactly once')
  assert.equal(h.shown.at(-1).view.phase, 'ready')
  assert.equal(h.shown.at(-1).view.preview, '', 'passive HUD must not leak body text')
  assert.equal(h.shown.at(-1).fullText, undefined)
  assert.equal(h.writes.length, 0, 'cleaning must not overwrite the clipboard')
  assert.equal(await h.session.trigger(), 'activated')
  const active = h.shown.at(-1)
  assert.equal(active.fullText, 'one')
  assert.equal(await h.session.copyAndClose({ sessionId: active.view.sessionId, revision: active.view.revision }), true)
  assert.deepEqual(h.writes, [{ text: 'one', sensitive: false, aborted: false }])
}

for (const sample of [
  { input: 'plain text', output: 'plain text', failure: 'no-change' },
  { input: 'secret', output: 'cleaned', sensitive: true, failure: 'refused' },
  { input: 'x'.repeat(CLEAN_AGENT_MAX_INPUT_CHARS + 1), output: 'cleaned', failure: 'too-large' },
]) {
  const h = harness({ input: sample.input, output: sample.output, isSensitive: sample.sensitive })
  await h.session.trigger()
  assert.equal(h.shown.at(-1).view.failure, sample.failure)
  assert.equal(h.writes.length, 0)
  assert.equal(await h.session.trigger(), 'started', 'error feedback must start a fresh session')
}

{
  const h = harness({ writeFails: true })
  await h.session.trigger(); await h.session.trigger()
  const active = h.shown.at(-1).view
  assert.equal(await h.session.copyAndClose({ sessionId: active.sessionId, revision: active.revision }), false)
  assert.equal(h.shown.at(-1).view.copyFailed, true)
  assert.equal(h.shown.at(-1).view.phase, 'active')
}

const handoff = readFileSync('src/cleanAgentHudHandoff.ts', 'utf8')
assert.match(handoff, /cleanAgentText\(text, false\)/)
assert.match(handoff, /readNativeClipboardText/)
assert.match(handoff, /writeTextWithoutHistory/)
assert.doesNotMatch(handoff, /navigator\.clipboard|fetch\(|openExternal|showToast/)
console.log('Clean Agent HUD one-read, concealed reveal, no-write failures, copy recovery, and host boundaries passed')
