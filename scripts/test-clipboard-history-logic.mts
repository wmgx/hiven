/**
 * Clipboard History — Functional Logic Test
 * Run via: node --experimental-strip-types scripts/test-clipboard-history-logic.mts
 */

import assert from 'node:assert/strict'

// ─── In-memory store mock ────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

function makeTextPreview(text: string, maxLength = 200): string {
  const singleLine = text.replace(/\n/g, ' ').trim()
  if (singleLine.length <= maxLength) return singleLine
  return singleLine.slice(0, maxLength) + '…'
}

const kvStore = new Map<string, unknown>()
const blobStore = new Map<string, unknown>()

const store = {
  async getIndex() {
    return (kvStore.get('history/index') as { entries: any[]; updatedAt: number }) ?? { entries: [], updatedAt: Date.now() }
  },
  async saveIndex(index: { entries: any[]; updatedAt: number }) { kvStore.set('history/index', index) },
  async getItem(id: string) { return kvStore.get('history/items/' + id) as any },
  async saveItem(item: any) { kvStore.set('history/items/' + item.id, item) },
  async deleteItem(id: string) { kvStore.delete('history/items/' + id) },
  async deleteBlob(blobId: string) { blobStore.delete(blobId) },
  async clear() {
    const index = await store.getIndex()
    for (const entry of index.entries) kvStore.delete('history/items/' + entry.id)
    kvStore.set('history/index', { entries: [], updatedAt: Date.now() })
  },
}

// ─── Repository logic (mirrors clipboardHistoryRepository.ts) ────────────────

async function addItem(input: any) {
  const now = Date.now()
  const index = await store.getIndex()
  const existingEntry = index.entries.find((e: any) => e.hash === input.hash)
  if (existingEntry) {
    const existing = await store.getItem(existingEntry.id)
    if (existing) {
      const updated = { ...existing, lastCopiedAt: now, copyCount: existing.copyCount + 1 }
      await store.saveItem(updated)
      const filtered = index.entries.filter((e: any) => e.id !== existingEntry.id)
      filtered.unshift({ ...existingEntry, lastCopiedAt: now })
      await store.saveIndex({ entries: filtered, updatedAt: now })
      return updated
    }
  }
  const id = generateId()
  let item: any
  if (input.kind === 'text') {
    item = { id, kind: 'text', hash: input.hash, firstCopiedAt: now, lastCopiedAt: now, copyCount: 1, byteSize: input.byteSize, text: input.text, preview: makeTextPreview(input.text) }
  } else if (input.kind === 'image') {
    item = { id, kind: 'image', hash: input.hash, firstCopiedAt: now, lastCopiedAt: now, copyCount: 1, byteSize: input.byteSize, blobId: input.blobId, previewBlobId: input.previewBlobId, contentType: input.contentType }
  } else {
    item = { id, kind: 'files', hash: input.hash, firstCopiedAt: now, lastCopiedAt: now, copyCount: 1, byteSize: input.byteSize, paths: input.paths, fileNames: input.fileNames }
  }
  await store.saveItem(item)
  index.entries.unshift({ id, kind: input.kind, hash: input.hash, lastCopiedAt: now, byteSize: input.byteSize })
  await store.saveIndex({ entries: index.entries, updatedAt: now })
  return item
}

async function getAllItems() {
  const index = await store.getIndex()
  const items: any[] = []
  for (const entry of index.entries) {
    const item = await store.getItem(entry.id)
    if (item) items.push(item)
  }
  return items
}

async function deleteItem(id: string) {
  const item = await store.getItem(id)
  if (!item) return
  if (item.kind === 'image') {
    await store.deleteBlob(item.blobId)
    await store.deleteBlob(item.previewBlobId)
  }
  await store.deleteItem(id)
  const index = await store.getIndex()
  await store.saveIndex({ entries: index.entries.filter((e: any) => e.id !== id), updatedAt: Date.now() })
}

async function clearAll() { await store.clear() }

async function pruneItems(policy: { maxItems?: number; retentionDays?: number; maxTotalCacheBytes?: number }) {
  const index = await store.getIndex()
  const now = Date.now()
  const toRemove = new Set<string>()
  let removedBytes = 0
  const entries = [...index.entries]

  if (policy.retentionDays != null && policy.retentionDays > 0) {
    const cutoff = now - policy.retentionDays * 24 * 60 * 60 * 1000
    for (const entry of entries) {
      if (entry.lastCopiedAt < cutoff) { toRemove.add(entry.id); removedBytes += entry.byteSize }
    }
  }
  if (policy.maxItems != null && policy.maxItems > 0) {
    const remaining = entries.filter((e: any) => !toRemove.has(e.id))
    if (remaining.length > policy.maxItems) {
      for (const entry of remaining.slice(policy.maxItems)) { toRemove.add(entry.id); removedBytes += entry.byteSize }
    }
  }
  if (policy.maxTotalCacheBytes != null && policy.maxTotalCacheBytes > 0) {
    const remaining = entries.filter((e: any) => !toRemove.has(e.id))
    let total = remaining.reduce((s: number, e: any) => s + e.byteSize, 0)
    for (let i = remaining.length - 1; i >= 0 && total > policy.maxTotalCacheBytes; i--) {
      toRemove.add(remaining[i].id); total -= remaining[i].byteSize; removedBytes += remaining[i].byteSize
    }
  }

  for (const id of toRemove) {
    const item = await store.getItem(id)
    if (item && item.kind === 'image') { await store.deleteBlob(item.blobId); await store.deleteBlob(item.previewBlobId) }
    await store.deleteItem(id)
  }
  await store.saveIndex({ entries: entries.filter((e: any) => !toRemove.has(e.id)), updatedAt: now })
  return { removedCount: toRemove.size, removedBytes, removedBlobIds: [] as string[] }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

// Test: Add text item
const t1 = await addItem({ kind: 'text', text: 'Hello World', byteSize: 11, hash: 'hash-1' })
assert.equal(t1.kind, 'text')
assert.equal(t1.text, 'Hello World')
assert.equal(t1.copyCount, 1)

// Test: Get all items
const items1 = await getAllItems()
assert.equal(items1.length, 1)

// Test: Deduplicate
const d1 = await addItem({ kind: 'text', text: 'Hello World', byteSize: 11, hash: 'hash-1' })
assert.equal(d1.copyCount, 2)
const items2 = await getAllItems()
assert.equal(items2.length, 1)
assert.ok(d1.lastCopiedAt >= t1.lastCopiedAt)

// Test: Multiple items — add small delay to ensure different timestamps
await new Promise(r => setTimeout(r, 5))
await addItem({ kind: 'text', text: 'Second', byteSize: 6, hash: 'hash-2' })
await new Promise(r => setTimeout(r, 5))
await addItem({ kind: 'text', text: 'Third', byteSize: 5, hash: 'hash-3' })
const items3 = await getAllItems()
assert.equal(items3.length, 3)
assert.equal(items3[0].hash, 'hash-3', 'Newest first')

// Test: Delete
await deleteItem(items3[2].id)
const items4 = await getAllItems()
assert.equal(items4.length, 2)

// Test: Prune by maxItems
for (let i = 0; i < 5; i++) {
  await addItem({ kind: 'text', text: 'p' + i, byteSize: 6, hash: 'prune-' + i })
}
const pruned = await pruneItems({ maxItems: 3 })
const afterPrune = await getAllItems()
assert.ok(afterPrune.length <= 3, `After prune should have <= 3 items, got ${afterPrune.length}`)
assert.ok(pruned.removedCount > 0)

// Test: Clear all
await clearAll()
const empty = await getAllItems()
assert.equal(empty.length, 0)

// Test: Image blob cleanup on delete
blobStore.set('img-blob-1', new Uint8Array([1, 2, 3]))
blobStore.set('img-preview-1', new Uint8Array([4, 5]))
await addItem({ kind: 'image', blobId: 'img-blob-1', previewBlobId: 'img-preview-1', contentType: 'image/png', byteSize: 5000, hash: 'img-hash-1' })
const imgItems = await getAllItems()
assert.equal(imgItems.length, 1)
await deleteItem(imgItems[0].id)
assert.equal(blobStore.has('img-blob-1'), false, 'Original blob should be deleted')
assert.equal(blobStore.has('img-preview-1'), false, 'Preview blob should be deleted')

console.log('clipboard-history functional logic tests passed')
