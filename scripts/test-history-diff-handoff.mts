import assert from 'node:assert/strict'
import { readHistoryCompareSnapshots } from '../src/plugins/clipboard-history/merge/clipboardTextCompare.ts'
import { createHistoryDiffReturnReceipt, prepareHistoryDiffTarget, HISTORY_DIFF_MAX_BYTES } from '../src/historyDiffHandoff.ts'

const selection = [{ id: 'a', hash: 'hash-a', title: 'History 1' }, { id: 'b', hash: 'hash-b', title: 'History 2' }]
const items = selection.map((item, i) => ({ ...item, kind: 'text' as const, text: i === 0 ? '  完整\r\n\n尾部  ' : '', preview: 'NOT THE FULL TEXT' }))
let entries = items
let active = true
const repository = {
  getItem: async (id: string) => items.find(item => item.id === id),
  getFreshListItems: async () => entries,
} as Parameters<typeof readHistoryCompareSnapshots>[0]
const snapshots = await readHistoryCompareSnapshots(repository, selection, () => active)
assert.deepEqual(snapshots.map(item => item.text), ['  完整\r\n\n尾部  ', ''])
const target = prepareHistoryDiffTarget('builtin', 'clipboard-history', snapshots)
const payload = JSON.parse(target.initialText)
assert.equal(payload.original.text, items[0].text)
assert.equal(payload.modified.text, '')
assert.equal(payload.original.title, 'History 1')
assert.equal(payload.modified.sourceId, 'history:b')
assert.equal(payload.original.kind, 'empty')
assert.equal(payload.original.paneId, undefined)
assert.throws(() => prepareHistoryDiffTarget('installed', 'clipboard-history', snapshots), /NotSupported/)
assert.throws(() => prepareHistoryDiffTarget('builtin', 'other', snapshots), /NotSupported/)
assert.throws(() => prepareHistoryDiffTarget('builtin', 'clipboard-history', [snapshots[0], snapshots[0]]), /InvalidSnapshot/)
assert.throws(() => prepareHistoryDiffTarget('builtin', 'clipboard-history', [{ ...snapshots[0], text: '中'.repeat(HISTORY_DIFF_MAX_BYTES / 3 + 1) }, snapshots[1]]), /TextTooLarge/)
assert.equal(JSON.parse(prepareHistoryDiffTarget('builtin', 'clipboard-history', [{ ...snapshots[0], text: 'a'.repeat(HISTORY_DIFF_MAX_BYTES) }, snapshots[1]]).initialText).original.text.length, HISTORY_DIFF_MAX_BYTES)
entries = items.slice(0, 1)
await assert.rejects(readHistoryCompareSnapshots(repository, selection, () => active), /ReadFailed/)
entries = items
await assert.rejects(readHistoryCompareSnapshots(repository, [{ ...selection[0], hash: 'changed' }, selection[1]], () => active), /ReadFailed/)
let release!: () => void
const gate = new Promise<void>(resolve => { release = resolve })
const late = readHistoryCompareSnapshots({ ...repository, getItem: async (id) => { await gate; return repository.getItem(id) } }, selection, () => active)
active = false
release()
await assert.rejects(late, /AbortError/)
active = true
await assert.rejects(readHistoryCompareSnapshots({ ...repository, getItem: async () => { throw Error('private detail') } }, selection, () => active))
await assert.rejects(readHistoryCompareSnapshots({ ...repository, getItem: async (id) => ({ ...items.find(item => item.id === id)!, text: '中'.repeat(HISTORY_DIFF_MAX_BYTES / 4) }) as never }, selection, () => active), /TextTooLarge/)
console.log('History → Diff: full ordered snapshots, deletion/change, stale read, bounded UTF-8 and scoped routing passed')

const listeners = new Set<() => void>()
const owner = { isCurrent: () => active, subscribeInvalidation: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } }
let closes = 0
const oldReceipt = createHistoryDiffReturnReceipt(owner, undefined, () => { closes++ })
oldReceipt.start()
active = false
for (const listener of [...listeners]) listener()
assert.equal(await oldReceipt.promise, false)
assert.equal(closes, 1)
active = true
const newReceipt = createHistoryDiffReturnReceipt(owner, undefined, () => { closes++ })
newReceipt.start()
oldReceipt.finish(true)
assert.equal(closes, 1, 'a late receipt must not finish the new visit')
newReceipt.finish(true)
assert.equal(await newReceipt.promise, true)
assert.equal(closes, 2)
assert.equal(listeners.size, 0)
const cancelled = new AbortController()
const cancelledReceipt = createHistoryDiffReturnReceipt(owner, cancelled.signal, () => { closes++ })
cancelledReceipt.start()
cancelled.abort()
assert.equal(await cancelledReceipt.promise, false)
cancelledReceipt.finish(true)
assert.equal(closes, 3)
assert.equal(listeners.size, 0)
console.log('History → Diff: owner revocation, abort and late return receipts passed')
