#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(rel, dependencies = {}) {
  const source = readFileSync(rel, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const module = { exports: {} }
  const requireFn = (specifier) => {
    if (specifier in dependencies) return dependencies[specifier]
    throw new Error(`Unexpected import: ${specifier}`)
  }
  vm.runInNewContext(`(function(module, exports, require) { ${compiled}\n})`, {
    module, exports: module.exports, require: requireFn,
    AbortController, DOMException, Blob, structuredClone, Buffer, atob, Promise, Array, Math, setTimeout, clearTimeout,
  })(module, module.exports, requireFn)
  return module.exports
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

const { QrHudSession } = load('src/plugins/qr-code/qrHudSession.ts')
const content = load('src/kits/content/detectContent.ts')
const { isSensitiveQrText } = load('src/qrHudSensitivity.ts', { './kits/content': content })
assert.equal(isSensitiveQrText('https://example.test/plain'), false)
assert.equal(isSensitiveQrText('otpauth://totp/example?secret=fake'), true)
assert.equal(isSensitiveQrText('WIFI:T:WPA;S:Example;P:not-a-real-password;;'), true)
assert.equal(isSensitiveQrText('eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.sig'), true)

function harness({ decoded = { ok: true, text: 'https://example.test/plain' }, sensitive = false, pendingDecode, onDecode, writeFails = false } = {}) {
  let now = 1000
  const shown = []
  const writes = []
  const dismissed = []
  let rejectPresent = false
  const session = new QrHudSession({
    async read(signal, current) {
      assert.equal(signal.aborted, false)
      assert.equal(current(), true)
      return new Blob(['png'], { type: 'image/png' })
    },
    decode: () => { onDecode?.(); return pendingDecode?.promise ?? Promise.resolve(decoded) },
    isSensitive: () => sensitive,
    async write(text, markedSensitive, signal) {
      writes.push({ text, sensitive: markedSensitive, aborted: signal.aborted })
      if (writeFails) throw new Error('synthetic write failure')
    },
    async present(view, fullText) {
      if (rejectPresent) throw new Error('native session was tombstoned')
      shown.push({ view: structuredClone(view), fullText })
    },
    async activate() { return now + 120_000 },
    async dismiss(id, revision) { dismissed.push({ id, revision }) },
    now: () => now,
    schedule: () => 1,
    clearSchedule() {},
    randomId: () => 'qr-session',
  })
  return { session, shown, writes, dismissed, rejectPresent: () => { rejectPresent = true }, allowPresent: () => { rejectPresent = false }, setNow: (value) => { now = value } }
}

{
  const h = harness({ writeFails: true })
  await h.session.trigger()
  await h.session.trigger()
  const active = h.shown.at(-1).view
  // Model native focus-loss cleanup after Copy owns the action: the failed
  // state update is rejected, then the next shortcut must start fresh.
  h.rejectPresent()
  assert.equal(await h.session.copyAndClose({ sessionId: active.sessionId, revision: active.revision }), false)
  h.allowPresent()
  assert.equal(await h.session.trigger(), 'started')
  assert.equal(h.shown.at(-1).view.phase, 'ready')
}

{
  const h = harness()
  assert.equal(await h.session.trigger(), 'started')
  assert.equal(h.shown.at(-1).view.phase, 'ready')
  assert.equal(h.shown.at(-1).view.preview, 'https://example.test/plain')
  assert.equal(h.shown.at(-1).fullText, undefined)
  assert.equal(await h.session.trigger(), 'activated')
  const active = h.shown.at(-1)
  assert.equal(active.view.phase, 'active')
  assert.equal(active.fullText, 'https://example.test/plain')
  assert.equal(await h.session.copyAndClose({ sessionId: active.view.sessionId, revision: active.view.revision }), true)
  assert.deepEqual(h.writes, [{ text: 'https://example.test/plain', sensitive: false, aborted: false }])
  assert.equal(h.dismissed.length, 1)
}

{
  const h = harness({ decoded: { ok: true, text: 'otpauth://totp/example?secret=fake' }, sensitive: true })
  await h.session.trigger()
  assert.equal(h.shown.at(-1).view.sensitive, true)
  assert.equal(h.shown.at(-1).view.preview, '')
  assert.equal(h.shown.at(-1).fullText, undefined)
  await h.session.trigger()
  assert.equal(h.shown.at(-1).fullText, 'otpauth://totp/example?secret=fake')
}

{
  const pending = deferred()
  const entered = deferred()
  const h = harness({ pendingDecode: pending, onDecode: () => entered.resolve() })
  const first = h.session.trigger()
  await entered.promise
  await h.session.cancel()
  const count = h.shown.length
  pending.resolve({ ok: true, text: 'late-result-must-not-return' })
  assert.equal(await first, 'cancelled')
  assert.equal(h.shown.length, count)
}

{
  const h = harness({ decoded: { ok: false } })
  await h.session.trigger()
  assert.equal(h.shown.at(-1).view.phase, 'error')
  assert.equal(h.shown.at(-1).view.failure, 'incomplete')
}

const handoff = readFileSync('src/qrHudHandoff.ts', 'utf8')
assert.match(handoff, /acquireRegisteredSurfaceShortcutInterceptor/)
assert.match(handoff, /createPluginClipboardImageReader/)
assert.match(handoff, /writeTextWithoutHistory/)
assert.doesNotMatch(handoff, /openExternal|fetch\(|showToast|navigator\.clipboard/)

console.log('QR HUD session, sensitive reveal, late cancellation, error, and host-boundary checks passed')
