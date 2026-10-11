import assert from 'node:assert/strict'
import { readMatchingHistoryPage } from '../src/plugins/clipboard-history/surfaces/clipboardHistoryPageReader.ts'

const calls: (string | undefined)[] = []
const progress: number[] = []
const page = await readMatchingHistoryPage(async (cursor) => {
  calls.push(cursor)
  return cursor === 'b' ? { items: [{ id: 'deep-match' }], nextCursor: 'c', scanned: 19 }
    : { items: [], nextCursor: cursor === 'a' ? 'b' : 'a', scanned: 512 }
}, undefined, new AbortController().signal, (count) => progress.push(count))
assert.deepEqual(calls, [undefined, 'a', 'b'])
assert.deepEqual(progress, [512, 1024, 1043])
assert.deepEqual(page.items, [{ id: 'deep-match' }])
assert.equal(page.nextCursor, 'c', 'continuation survives without accumulating old pages')
assert.deepEqual(await readMatchingHistoryPage(async () => ({ items: [], scanned: 0 }), undefined, new AbortController().signal, () => {}), { items: [], scanned: 0 })
await assert.rejects(readMatchingHistoryPage(async () => ({ items: [], nextCursor: 'same', scanned: 2 }), 'same', new AbortController().signal, () => {}), /did not advance/)
const controller = new AbortController()
let publish = false
await assert.rejects(readMatchingHistoryPage(async () => {
  controller.abort()
  return { items: [{ id: 'late-receipt' }], scanned: 1 }
}, undefined, controller.signal, () => { publish = true }), { name: 'AbortError' })
assert.equal(publish, false, 'cancelled/late query result cannot publish progress or matching rows')
console.log('history page traversal and cancellation passed')
