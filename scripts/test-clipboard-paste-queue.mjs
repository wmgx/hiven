#!/usr/bin/env node
// Pure production queue + mocked delivery/repository; no native clipboard or APIs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const roots = { clipboardPasteQueue: 'src/workspace/pasteQueue/', clipboardCopyRound: 'src/plugins/clipboard-history/background/' }
const urls = new Map()
function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name)
  let code = ts.transpileModule(readFileSync(`${roots[name]}${name}.ts`, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  code = code.replace(/from ['"]\.\/(\w+)['"]/g, (_, dependency) => `from '${moduleUrl(dependency)}'`)
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  urls.set(name, url)
  return url
}
const { createClipboardPasteQueue, validateQueueSnapshots } = await import(moduleUrl('clipboardPasteQueue'))
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const texts = ['  first\r\n全文😀 ', 'second\n\n', 'third'.repeat(1000)]
const input = texts.map((text, i) => ({ id: String(i), text }))
const calls = []
const queue = createClipboardPasteQueue({ deliver: (attempt) => { const pending = deferred(); calls.push({ ...attempt, pending }); return pending.promise } })
queue.replace(input)
input[0].text = 'changed after snapshot'
const first = queue.next()
assert.equal(await queue.next(), 'busy')
assert.equal(calls.length, 1)
assert.equal(calls[0].snapshot.text, texts[0])
calls[0].pending.resolve({ ok: false, fallback: 'copied', message: 'sensitive raw text' })
assert.equal(await first, 'failed')
assert.equal(queue.getSnapshot().remaining, 3)
assert.equal(queue.getSnapshot().current.text, texts[0])
for (let i = 0; i < 3; i++) {
  const pending = queue.next()
  assert.equal(calls.at(-1).snapshot.text, texts[i])
  calls.at(-1).pending.resolve({ ok: true })
  assert.equal(await pending, 'delivered')
  assert.equal(queue.getSnapshot().completed, i + 1)
}
assert.equal(queue.getSnapshot().phase, 'completed')
assert.equal(queue.getSnapshot().current, null)
assert.equal(await queue.next(), 'empty')
queue.replace([{ id: 'old', text: 'old' }])
const lateOld = queue.next()
const oldCall = calls.at(-1)
queue.replace([{ id: 'replacement', text: 'new' }])
assert.equal(oldCall.signal.aborted, true)
assert.equal(oldCall.isCurrent(), false)
assert.equal(await queue.next(), 'busy', 'old transport keeps exclusion even after replacement')
oldCall.pending.resolve({ ok: true })
assert.equal(await lateOld, 'stale')
assert.equal(queue.getSnapshot().completed, 0)
assert.equal(queue.getSnapshot().current.text, 'new')
const cancelled = queue.next()
queue.cancel()
calls.at(-1).pending.resolve({ ok: true })
assert.equal(await cancelled, 'stale')
assert.equal(queue.getSnapshot().remaining, 0)
assert.equal(await queue.next(), 'empty')
let ownerCurrent = true
let invalidate
const ownerAttempt = deferred()
const owned = createClipboardPasteQueue({
  owner: { isCurrent: () => ownerCurrent, subscribeInvalidation: (fn) => { invalidate = fn; return () => { invalidate = null } } },
  deliver: () => ownerAttempt.promise,
})
owned.replace([{ id: 'owned', text: 'owner' }])
const ownerPending = owned.next()
ownerCurrent = false
invalidate()
ownerAttempt.resolve({ ok: true })
assert.equal(await ownerPending, 'stale')
assert.equal(owned.getSnapshot().remaining, 0)
assert.throws(() => owned.replace([{ id: 'new', text: 'new' }]), /Owner/)
owned.dispose()
assert.equal(invalidate, null)
const thrown = createClipboardPasteQueue({ deliver: async () => { throw new Error('private native detail') } })
thrown.replace([{ id: 'failure', text: 'retained' }])
assert.equal(await thrown.next(), 'failed')
assert.equal(thrown.getSnapshot().current.text, 'retained')
assert.equal(JSON.stringify(thrown.getSnapshot()).includes('private'), false)
assert.throws(() => thrown.replace([{ id: 'x', text: '😀'.repeat(300000) }]), /Size/)
assert.equal(thrown.getSnapshot().current.text, 'retained')
assert.throws(() => validateQueueSnapshots([{ id: 'x', text: 'x' }, { id: 'x', text: 'y' }]), /Snapshot/)
assert.equal(validateQueueSnapshots([{ id: 'empty', text: '' }])[0].text, '')
assert.throws(() => validateQueueSnapshots([{ id: 'one', text: 'a'.repeat(600000) }, { id: 'two', text: 'b'.repeat(600000) }]), /Size/)
const duringPublish = createClipboardPasteQueue({ deliver: async () => { throw new Error('must not be called') } })
duringPublish.replace([{ id: 'sync', text: 'sync' }])
let cancelledSynchronously = false
duringPublish.subscribe(() => {
  if (duringPublish.getSnapshot().busy && !cancelledSynchronously) {
    cancelledSynchronously = true
    duringPublish.cancel()
  }
})
assert.equal(await duringPublish.next(), 'stale')
assert.equal(duringPublish.getSnapshot().busy, false)

console.log('✓ queue delivery: ordered snapshots, failure/cancel/replace/owner fencing')

const { createClipboardCopyRound } = await import(moduleUrl('clipboardCopyRound'))
let clock = 0
let current
let clears = 0
const round = createClipboardCopyRound({
  setRound: (id, items, options) => { current = { id, items: [...items], ...options } },
  clear: () => { current = undefined; clears++ },
}, () => clock, text => text === 'secret')
const copy = (text, origin) => round.change({ kind: 'text', text, origin })
copy('first')
const initial = current.id
clock = 10_000; copy('second')
assert.equal(current.id, initial, '10 seconds stays in the round')
clock = 20_001; copy('third')
assert.notEqual(current.id, initial, 'greater than 10 seconds replaces the round')
assert.equal(current.items.length, 1)
copy(' third ')
assert.equal(current.items.length, 1, 'trimmed duplicates preserve the original text')
clock = 29_000; copy('own output', 'hiven'); copy('secret')
round.change({ kind: 'image' }); round.change({ kind: 'files' })
assert.equal(current.items.length, 1)
clock = 30_002; copy('new')
assert.equal(current.items.length, 1, 'excluded copies do not reset the clock')
const active = current.id
round.status({ sessionId: active, busy: true })
clock += 20_000; copy('append')
assert.equal(current.id, active)
assert.equal(current.items.length, 2, 'pasting keeps the round open beyond ten seconds')
round.status({ sessionId: active, phase: 'completed' })
copy('after completion')
assert.notEqual(current.id, active)
for (let i = 0; i < 21; i++) copy(`item ${i}`)
assert.equal(current.items.length, 20)
assert.equal(current.full, true)
clock += 599_999; round.expire(); assert.ok(current)
clock++; round.expire(); assert.equal(current, undefined)
assert.equal(clears, 1)
copy('cancel'); const cancelledRound = current.id
round.status({ sessionId: cancelledRound, phase: 'cancelled' }); copy('restart')
assert.notEqual(current.id, cancelledRound)

copy('second pending item')
const idleRound = current.id
clock += 60_000
round.status({ sessionId: idleRound, phase: 'ready', completed: 1 })
clock += 599_999; round.expire(); assert.ok(current, 'last paste progress starts the idle deadline')
round.status({ sessionId: idleRound, phase: 'ready', completed: 1 })
clock++; round.expire(); assert.equal(current, undefined, 'started rounds expire after ten idle minutes; status updates do not extend them')
copy('after idle expiry')
assert.notEqual(current.id, idleRound)

const appendDelivery = deferred()
const appending = createClipboardPasteQueue({ deliver: () => appendDelivery.promise })
const snapshots = [{ id: '1', text: 'one' }]
appending.replace(snapshots)
const pendingAppend = appending.next()
appending.appendRound([...snapshots, { id: '2', text: 'two' }])
appendDelivery.resolve({ ok: true })
assert.equal(await pendingAppend, 'delivered')
assert.equal(appending.getSnapshot().completed, 1)
assert.equal(appending.getSnapshot().current.text, 'two')
assert.throws(() => appending.appendRound([{ id: 'changed', text: 'one' }]), /Snapshot/)
console.log('✓ copy rounds: 10s boundary, dedup/exclusions, append/completion/cancel, 20 items, 10min expiry')
