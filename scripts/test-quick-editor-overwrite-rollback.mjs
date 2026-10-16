import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const compile = (file) => ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const entries = new Map()
let rejectWrite = false, rejectRead = false
const storage = { getItem: key => { if (rejectRead) throw new Error('StorageReadError'); return entries.get(key) ?? null }, setItem: (key, value) => { if (rejectWrite) throw new Error('QuotaExceededError'); entries.set(key, value) }, removeItem: key => entries.delete(key) }
globalThis.localStorage = storage
globalThis.window = { localStorage: storage }
function store() {
  const exports = {}
  vm.runInNewContext(compile('src/workspace/quickEditor/quickEditorStore.ts'), { exports, require, localStorage: storage, console })
  return exports.useQuickEditorStore
}
const sender = store(), destination = store()
sender.getState().setText('stale sender')
const a = 'A full draft\r\n完整草稿\n  trailing spaces  \n'
destination.getState().setText(a)
destination.getState().overwriteActiveText('B full replacement', { source: 'text' })
assert.equal(sender.getState().text, 'stale sender')
assert.equal(destination.getState().externalVersionHistory[0].text, a)
assert.equal(JSON.parse(entries.get('hiven-quick-editor')).state.externalVersionHistory[0].text, a)
assert.equal(store().getState().text, 'B full replacement', 'A newly created window hydrates the committed result')
const c = 'C latest draft\n第二行\nEND-C'
destination.getState().setText(c)
const before = entries.get('hiven-quick-editor')
const memoryBefore = destination.getState()
rejectWrite = true
assert.throws(() => destination.getState().overwriteActiveText('must not replace'), /QuotaExceeded/)
assert.equal(destination.getState(), memoryBefore, 'Storage failure cannot publish replacement in memory')
assert.equal(entries.get('hiven-quick-editor'), before, 'Storage failure preserves previous durable content')
assert.throws(() => destination.getState().restoreExternalVersion(memoryBefore.externalVersionHistory[0].id), /QuotaExceeded/)
assert.equal(destination.getState(), memoryBefore)
rejectWrite = false
destination.getState().overwriteActiveText('decoded tool output', { source: 'result' })
assert.equal(destination.getState().externalVersionHistory[0].text, c)
assert.equal(destination.getState().restoreExternalVersion(destination.getState().externalVersionHistory[0].id), true)
assert.equal(store().getState().text, c, 'Restored full draft survives reopening')
rejectRead = true
const unread = store()
assert.equal(unread.persist.hasHydrated(), false)
const saved = entries.get('hiven-quick-editor')
assert.throws(() => unread.getState().overwriteActiveText('must not overwrite unread draft'), /QuickEditorStorageUnavailable/)
assert.equal(entries.get('hiven-quick-editor'), saved)
rejectRead = false
await sender.persist.rehydrate()
assert.equal(sender.getState().text, c, 'Returning to inline editor refreshes the current saved draft')

const listeners = new Map(), timers = new Map(), packets = []
let now = 1000, uuid = 0, timer = 0, holdRequest = false, dropReceipt = false
function api(label) {
  const emit = (name, payload, target) => {
    packets.push({ name, payload, target })
    if (holdRequest && name === 'hiven://quick-editor-overwrite') return Promise.resolve()
    if (dropReceipt && name === 'hiven://quick-editor-overwrite-reply' && !payload.ready) return Promise.resolve()
    for (const entry of [...(listeners.get(name) ?? [])]) if (!target || entry.label === target) entry.fn({ payload })
    return Promise.resolve()
  }
  return { listen: async (name, fn) => { const entry = { label, fn }; const set = listeners.get(name) ?? new Set(); set.add(entry); listeners.set(name, set); return () => set.delete(entry) }, emit: (name,payload) => emit(name,payload), emitTo: (target,name,payload) => emit(name,payload,target) }
}
function handoff(label) {
  const exports = {}, events = api(label)
  vm.runInNewContext(compile('src/workspace/quickEditor/quickEditorOverwriteHandoff.ts'), { exports, require: id => { assert.equal(id, '@tauri-apps/api/event'); return events }, crypto: { randomUUID: () => `id-${++uuid}` }, Date: { now: () => now }, Number, Map, Promise, Error, AbortController, setTimeout: fn => { timers.set(++timer,fn); return timer }, clearTimeout: id => timers.delete(id) })
  return exports
}
const flush = async () => { for(let i=0;i<40;i++) await Promise.resolve() }
const caller = handoff('launcher'), receiver = handoff('quick-editor')
let commits = 0, stop
const commit = (text, options) => { commits++; const paneId = destination.getState().overwriteActiveText(text, options); return { paneId, historyCount: destination.getState().externalVersionHistory.length } }
const result = await caller.requestQuickEditorOverwrite('first acknowledged B', {}, async () => { stop = await receiver.listenForQuickEditorOverwrites(commit) })
await flush()
assert.ok(result.paneId)
assert.equal(commits, 1, 'New window readiness delivers exactly once')
{
  let releaseShow
  const controller = new AbortController()
  let commitPoints = 0
  const cancelled = caller.requestQuickEditorOverwrite('cancelled before target delivery', {}, () => new Promise(resolve => { releaseShow = resolve }), {
    signal: controller.signal,
    isCurrent: () => !controller.signal.aborted,
    onCommit: () => { commitPoints++ },
  })
  await flush()
  controller.abort()
  releaseShow()
  await assert.rejects(cancelled, /QuickEditorOverwriteFailed/)
  await flush()
  assert.equal(commitPoints, 0, 'owner cancellation before target delivery never crosses the commit point')
  assert.equal(commits, 1, 'owner cancellation before target delivery never overwrites the draft')
}
{
  const controller = new AbortController()
  let commitPoints = 0
  const committed = caller.requestQuickEditorOverwrite('committed despite later owner loss', {}, async () => {}, {
    signal: controller.signal,
    isCurrent: () => !controller.signal.aborted,
    onCommit: () => { commitPoints++; controller.abort() },
  })
  await flush()
  assert.ok((await committed).paneId)
  assert.equal(commitPoints, 1, 'target delivery exposes one irreversible commit point')
  assert.equal(commits, 2, 'cancellation at the commit point cannot produce a half-delivered overwrite')
}
const packet = packets.find(p => p.name === 'hiven://quick-editor-overwrite')
await api('launcher').emitTo('quick-editor',packet.name,packet.payload)
assert.equal(commits, 2, 'Duplicate delivery only replays receipt')
stop(); stop = await receiver.listenForQuickEditorOverwrites(commit)
await api('launcher').emitTo('quick-editor',packet.name,packet.payload)
assert.equal(commits, 2, 'An old window generation cannot overwrite a new editor')
rejectWrite = true
const failedMemory = destination.getState()
await assert.rejects(caller.requestQuickEditorOverwrite('rejected B', {}, async () => {}), /QuickEditorOverwriteFailed/)
assert.equal(destination.getState(), failedMemory)
rejectWrite = false
holdRequest = true
const pending = caller.requestQuickEditorOverwrite('expired B', {}, async () => {})
const rejects = assert.rejects(pending, /QuickEditorOverwriteFailed/)
await flush(); const late = packets.filter(p=>p.name===packet.name).at(-1)
now += 8001; for(const fn of [...timers.values()]) fn(); await rejects
holdRequest = false
await api('launcher').emitTo('quick-editor', late.name, late.payload)
assert.equal(destination.getState(), failedMemory, 'A late, expired request cannot mutate the draft')
dropReceipt = true
destination.getState().setText('recoverable if ack is lost')
const lostAck = caller.requestQuickEditorOverwrite('committed with lost ack', {}, async () => {})
const lostRejects = assert.rejects(lostAck, /QuickEditorOverwriteFailed/)
await flush(); now += 8001; for(const fn of [...timers.values()]) fn(); await lostRejects
assert.equal(store().getState().externalVersionHistory[0].text, 'recoverable if ack is lost')
stop()
console.log('Quick Editor: durable full-text archive/restore, cancellable pre-commit handoff, failure preservation, readiness, duplicate/old-owner/expired delivery and lost-ack recovery passed')
