#!/usr/bin/env node
// Pure production queue + mocked delivery/repository; no native clipboard or APIs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const root = 'src/plugins/clipboard-history/queue/'
const urls = new Map()
function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name)
  let code = ts.transpileModule(readFileSync(`${root}${name}.ts`, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText
  code = code.replace(/from ['"]\.\/(\w+)['"]/g, (_, dependency) => `from '${moduleUrl(dependency)}'`)
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  urls.set(name, url)
  return url
}
const { createClipboardPasteQueue, validateQueueSnapshots } = await import(moduleUrl('clipboardPasteQueue'))
const { readClipboardQueueSnapshots } = await import(moduleUrl('readClipboardQueueSnapshots'))
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
assert.throws(() => validateQueueSnapshots(Array.from({ length: 21 }, (_, i) => ({ id: String(i), text: '' }))), /Count/)
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

const selection = [{ id: 'b', hash: 'hb' }, { id: 'a', hash: 'ha' }]
const items = { a: { id: 'a', hash: 'ha', kind: 'text', text: 'A\r\n' }, b: { id: 'b', hash: 'hb', kind: 'text', text: 'B😀' } }
const repository = { getItem: async (id) => items[id], getFreshListItems: async () => Object.values(items) }
assert.deepEqual(await readClipboardQueueSnapshots(repository, selection, () => true), [{ id: 'b', text: 'B😀' }, { id: 'a', text: 'A\r\n' }])
await assert.rejects(readClipboardQueueSnapshots({ ...repository, getFreshListItems: async () => [items.a] }, selection, () => true), /Read/)
await assert.rejects(readClipboardQueueSnapshots({ ...repository, getFreshListItems: async () => [{ ...items.b, hash: 'edited' }, items.a] }, selection, () => true), /Read/)
await assert.rejects(readClipboardQueueSnapshots({ ...repository, getItem: async () => ({ ...items.a, kind: 'image' }) }, selection, () => true), /Read/)
await assert.rejects(readClipboardQueueSnapshots({ ...repository, getItem: async () => { throw new Error('private storage path') } }, selection, () => true), /^Error: QueueReadError$/)
const firstRead = deferred()
const mutableSelection = [{ id: 'a', hash: 'ha' }]
const fixedRead = readClipboardQueueSnapshots({ ...repository, getItem: () => firstRead.promise }, mutableSelection, () => true)
mutableSelection[0].hash = 'mutated while awaiting'
mutableSelection[0].id = 'b'
firstRead.resolve(items.a)
assert.deepEqual(await fixedRead, [{ id: 'a', text: 'A\r\n' }])
let current = true
const readPending = deferred()
const reading = readClipboardQueueSnapshots({ ...repository, getFreshListItems: () => readPending.promise }, selection, () => current)
await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
current = false
readPending.resolve(Object.values(items))
await assert.rejects(reading, /Cancelled/)
console.log('✓ queue preserves ordered full snapshots; one-at-a-time success-only advance; failure/cancel/replace/owner fencing; bounded fresh reads')
