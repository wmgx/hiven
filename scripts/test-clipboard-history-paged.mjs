import assert from 'node:assert/strict'
import { historyModule, syntheticHistoryStorage } from './lib/history-synthetic-storage.mjs'
const { createClipboardHistoryRepository: create, historyRetentionCutoff } = await import(historyModule('src/plugins/clipboard-history/storage/clipboardHistoryRepository.ts'))
const realNow = Date.now
let now = Date.parse('2026-10-11T12:00:00Z')
Date.now = () => now
const DAY = 86400000
const item = (id, ago = 0, extra = {}) => ({ id, kind: 'text', hash: id, text: 'prefix '.repeat(100) + `UNIQUE-${id}`, preview: 'prefix…', firstCopiedAt: now - ago * DAY, lastCopiedAt: now - ago * DAY, byteSize: 800, copyCount: 1, ...extra })
const seed = (memory, items) => { memory.data.set('history/index', { entries: items.map(({ text, ...entry }) => entry), updatedAt: now }); for (const value of items) memory.data.set('history/items/' + value.id, value) }
try {
  const memory = syntheticHistoryStorage()
  const old = Array.from({ length: 620 }, (_, i) => item(`legacy-${String(i).padStart(4, '0')}`, 500))
  old.push(item('favorite', 800, { isFavorite: true }))
  seed(memory, old)
  memory.data.set('history/items/orphan', item('orphan'))
  const repo = create(memory.storage)
  const first = await repo.getPage({ limit: 100 })
  assert.equal(first.items.length, 100)
  assert.ok(first.nextCursor)
  const second = await repo.getPage({ cursor: first.nextCursor, limit: 100 })
  assert.equal(second.items.length, 100)
  assert.ok(second.items.every((entry) => !first.items.some((other) => other.id === entry.id)))
  assert.equal(await repo.getItem('orphan'), undefined, 'old orphan body must not become visible')
  assert.equal(memory.data.has('history/index'), false, 'complete migration retires v1 authoritative source')
  assert.equal(memory.stats.gets.includes('history/index'), false, 'never load the full old index')
  assert.ok(memory.stats.maxArrayPage <= 8)
  assert.ok(memory.stats.maxPage <= 100)
  let cursor, matched = []
  const singleBodyGetsBeforeSearch = memory.stats.gets.filter((key) => key.startsWith('history/items/')).length
  do { const page = await repo.getPage({ query: 'UNIQUE-legacy-0619', cursor }); matched.push(...page.items); cursor = page.nextCursor } while (cursor)
  assert.equal(matched[0].id, 'legacy-0619', 'search matches full text beyond preview without caching all full texts')
  assert.equal(matched[0].text, '', 'search result remains lightweight')
  assert.equal(memory.stats.gets.filter((key) => key.startsWith('history/items/')).length, singleBodyGetsBeforeSearch, 'full-text search never falls back to per-record KV reads')
  assert.ok(memory.stats.relatedSearches > 0)
  assert.ok(memory.stats.getMany.length <= 1 && memory.stats.getMany.every((keys) => keys.length <= 32), 'active full-text verification uses at most one bounded candidate batch')
  assert.equal((await repo.getPage({ query: 'definitely-absent' })).items.length, 0)
  assert.equal((await repo.getFreshListItems(['legacy-0619', 'legacy-0000'])).length, 2, 'cross-page explicit selected IDs validate')
  assert.equal((await repo.getRetentionStatus()).legacyProtectedCount, 621)
  const unchangedRevision = memory.data.get('history/v2/state').revision
  const beforePruneBatches = memory.stats.batches
  for (let i = 0; i < 12; i++) await repo.pruneItems({ retentionMonths: 1, maxItems: 1, retentionDays: 1, maxTotalCacheBytes: 1 })
  assert.equal((await repo.getRetentionStatus()).trashCount, 0, 'legacy old quantity/day/cache policy never deletes protected records')
  assert.equal(memory.data.get('history/v2/state').revision, unchangedRevision)
  assert.equal(memory.stats.batches, beforePruneBatches, 'protected/non-candidate scans must not issue per-item CAS writes')
  await repo.enableLegacyRetention(1)
  assert.equal((await repo.getRetentionStatus()).legacyProtectedCount, 0)
  for (let i = 0; i < 12; i++) await repo.pruneItems({ retentionMonths: 1 })
  assert.equal((await repo.getRetentionStatus()).trashCount, 0, 'opt-in starts a new full retention interval')
  now += 32 * DAY
  for (let i = 0; i < 12; i++) await repo.pruneItems({ retentionMonths: 1 })
  assert.equal((await repo.getRetentionStatus()).trashCount, 620)
  assert.ok(await repo.getItem('favorite'), 'favorite survives every automatic route')
  assert.equal(await repo.getItem('legacy-0000'), undefined)
  assert.ok(await repo.getTrashItem('legacy-0000'))
  await repo.restoreItem('legacy-0000')
  await repo.pruneItems({ retentionMonths: 1 })
  assert.ok(await repo.getItem('legacy-0000'), 'restore restarts retention without falsifying copy timestamp')
  const originalCopyTime = old[0].lastCopiedAt
  assert.equal((await repo.getItem('legacy-0000')).lastCopiedAt, originalCopyTime)
  assert.equal((await repo.purgeExpiredTrash()).removedCount, 0, '30-day recovery cannot be shortened')
  now += 31 * DAY
  assert.ok((await repo.purgeExpiredTrash()).removedCount > 0)

  const failure = syntheticHistoryStorage()
  seed(failure, [item('a'), item('b')])
  failure.failBatch((ops) => ops.some((op) => op.key === 'history/v2/meta/a'))
  await assert.rejects(create(failure.storage).getPage(), /atomic failure/)
  assert.ok(failure.data.has('history/index'))
  assert.equal(failure.data.has('history/v2/meta/a'), false)
  assert.equal((await create(failure.storage).getPage()).items.length, 2, 'restart recovers without duplicates')
  const missing = syntheticHistoryStorage(); seed(missing, [item('missing')]); missing.data.delete('history/items/missing')
  await assert.rejects(create(missing.storage).getPage(), /unreadable/)
  assert.ok(missing.data.has('history/index'))
  const newer = syntheticHistoryStorage(); seed(newer, [item('a')]); newer.data.set('history/v2/state', { version: 3, phase: 'complete' })
  await assert.rejects(create(newer.storage).getPage(), /Unsupported/)
  assert.ok(newer.data.has('history/index'))

  const concurrent = syntheticHistoryStorage(); const one = create(concurrent.storage); const two = create(concurrent.storage)
  await Promise.all([one.addItem({ kind: 'text', text: 'a', hash: 'a', byteSize: 1 }), two.addItem({ kind: 'text', text: 'b', hash: 'b', byteSize: 1 })])
  assert.equal((await one.getPage()).items.length, 2)
  const added = await one.addItem({ kind: 'text', text: 'pin', hash: 'pin', byteSize: 3 })
  await Promise.all([one.toggleFavorite(added.id), two.toggleFavorite(added.id)])
  assert.equal((await one.getItem(added.id)).isFavorite, false, 'cross-repository CAS prevents lost toggles')
  concurrent.failBatch((ops) => ops.some((op) => op.key === 'history/items/' + added.id))
  await assert.rejects(one.updateText(added.id, 'pin', 'replacement', 100), /atomic failure/)
  assert.equal((await one.getItem(added.id)).text, 'pin', 'body and index failure is atomic')

  const images = syntheticHistoryStorage(); const pictures = create(images.storage)
  const photo = { kind: 'image', blobId: 'shared', previewBlobId: 'shared', contentType: 'image/png', byteSize: 20 }
  const left = await pictures.addItem({ ...photo, hash: 'left' }); const right = await pictures.addItem({ ...photo, hash: 'right' })
  await pictures.setFavorite(right.id, true)
  await pictures.deleteItem(left.id); now += 31 * DAY; await pictures.purgeExpiredTrash()
  assert.deepEqual(images.deletedBlobs, [], 'active favorite shared blob stays intact')
  await pictures.deleteItem(right.id); now += 31 * DAY; images.failBlob(true); await pictures.purgeExpiredTrash()
  assert.deepEqual(images.deletedBlobs, [])
  images.failBlob(false); await pictures.purgeExpiredTrash()
  assert.deepEqual(images.deletedBlobs, ['shared'], 'shared original/preview is deleted once; failure retries safely')
  await assert.rejects(pictures.addItem({ ...photo, hash: 'resurrect-file' }), /no longer available/)
  assert.equal(historyRetentionCutoff(Date.parse('2024-03-31T12:34:56Z'), 1), Date.parse('2024-02-29T12:34:56Z'))
  assert.equal(historyRetentionCutoff(Date.parse('2026-03-31T12:34:56Z'), 1), Date.parse('2026-02-28T12:34:56Z'))
  assert.equal(historyRetentionCutoff(Date.parse('2026-10-11T12:00:00Z'), 12), Date.parse('2025-10-11T12:00:00Z'))
  const repeats = syntheticHistoryStorage(); const repeatedRepo = create(repeats.storage)
  const firstCapture = await repeatedRepo.addItem({ ...photo, blobId: 'original', previewBlobId: 'original', hash: 'same-image' })
  const duplicateCapture = await repeatedRepo.addItem({ ...photo, blobId: 'new-unused', previewBlobId: 'new-unused', hash: 'same-image' })
  assert.equal(duplicateCapture.id, firstCapture.id)
  assert.equal(duplicateCapture.blobId, 'original', 'dedupe keeps the exact existing image snapshot')
  assert.deepEqual(repeats.deletedBlobs, [], 'unused capture collection occurs only after the dedupe commit')
  await repeatedRepo.purgeExpiredTrash()
  assert.deepEqual(repeats.deletedBlobs, ['new-unused'], 'same incoming original/preview is collected once')
  const sharedCapture = await repeatedRepo.addItem({ ...photo, blobId: 'actively-shared', previewBlobId: 'actively-shared', hash: 'another-image' })
  await repeatedRepo.addItem({ ...photo, blobId: 'actively-shared', previewBlobId: 'original', hash: 'same-image' })
  await repeatedRepo.purgeExpiredTrash()
  assert.deepEqual(repeats.deletedBlobs, ['new-unused'], 'incoming active/shared IDs and existing image IDs remain protected')
  await repeatedRepo.deleteItem(sharedCapture.id)
  await repeatedRepo.addItem({ ...photo, blobId: 'actively-shared', previewBlobId: 'actively-shared', hash: 'same-image' })
  await repeatedRepo.purgeExpiredTrash()
  assert.deepEqual(repeats.deletedBlobs, ['new-unused'], 'recovery-area references also protect incoming shared IDs')
  repeats.failBatch((ops) => ops.some((op) => op.key === 'history/v2/gc/failure-unused'))
  await assert.rejects(repeatedRepo.addItem({ ...photo, blobId: 'failure-unused', previewBlobId: 'failure-unused', hash: 'same-image' }), /atomic failure/)
  assert.equal(repeats.data.has('history/v2/gc/failure-unused'), false, 'failed dedupe cannot publish garbage collection')
  await repeatedRepo.addItem({ ...photo, blobId: 'failure-unused', previewBlobId: 'failure-unused', hash: 'same-image' })
  repeats.failBlob(true); await repeatedRepo.purgeExpiredTrash()
  assert.ok(repeats.data.has('history/v2/gc/failure-unused'))
  repeats.failBlob(false); await repeatedRepo.purgeExpiredTrash()
  assert.deepEqual(repeats.deletedBlobs, ['new-unused', 'failure-unused'], 'known incoming failed physical cleanup retries')
  assert.ok(await repeatedRepo.getItem(firstCapture.id))
  const competingRepo = create(repeats.storage)
  await competingRepo.getRetentionStatus()
  const readBeforeRace = repeats.storage.kv.get
  let interleaved = false
  repeats.storage.kv.get = async (key) => {
    const result = await readBeforeRace(key)
    if (!interleaved && key === 'history/v2/blob/racing-reference') {
      interleaved = true
      await competingRepo.addItem({ ...photo, blobId: 'racing-reference', previewBlobId: 'racing-reference', hash: 'competing-image' })
    }
    return result
  }
  await repeatedRepo.addItem({ ...photo, blobId: 'racing-reference', previewBlobId: 'racing-reference', hash: 'same-image' })
  await repeatedRepo.purgeExpiredTrash()
  assert.equal(repeats.data.has('history/v2/gc/racing-reference'), false, 'CAS retry rechecks a reference acquired by another window')
  assert.equal(repeats.deletedBlobs.includes('racing-reference'), false)


  const cancelled = syntheticHistoryStorage(); const cancelRepo = create(cancelled.storage)
  const cancelledPhoto = await cancelRepo.addItem({ ...photo, blobId: 'cancel-photo', previewBlobId: 'cancel-photo', hash: 'cancel-photo' })
  await cancelRepo.deleteItem(cancelledPhoto.id); now += 31 * DAY
  const lateAbort = new AbortController()
  const ordinaryGet = cancelled.storage.kv.get
  cancelled.storage.kv.get = async (key) => {
    const result = await ordinaryGet(key)
    if (key === 'history/v2/blob/cancel-photo') lateAbort.abort()
    return result
  }
  await assert.rejects(cancelRepo.purgeExpiredTrash({ signal: lateAbort.signal }), /cancelled/)
  assert.ok(await cancelRepo.getTrashItem(cancelledPhoto.id), 'abort after async blob checks prevents permanent transaction dispatch')
  assert.deepEqual(cancelled.deletedBlobs, [])
  const abort = new AbortController(); abort.abort()
  await assert.rejects(repo.getPage({ signal: abort.signal }), /cancelled/)
  const unicodeMemory = syntheticHistoryStorage(); const unicodeRepo = create(unicodeMemory.storage)
  const unicode = await unicodeRepo.addItem({ kind: 'text', text: 'prefix '.repeat(40) + '中文检索 CAFÉ Straße ΟΣ', hash: 'unicode-search', byteSize: 320 })
  assert.equal((await unicodeRepo.getPage({ query: '中文检索' })).items.some(({ id }) => id === unicode.id), true)
  assert.equal((await unicodeRepo.getPage({ query: 'café' })).items.some(({ id }) => id === unicode.id), true, 'batching preserves JavaScript Unicode lowercase matching')
  assert.equal((await unicodeRepo.getPage({ query: '\uFEFFος\uFEFF' })).items.some(({ id }) => id === unicode.id), true, 'JS trim and contextual lowercase semantics remain authoritative')
  assert.equal((await unicodeRepo.getPage({ query: 'ss' })).items.some(({ id }) => id === unicode.id), false, 'Unicode uppercase expansion does not change JavaScript search semantics')
  assert.equal((await unicodeRepo.getPage({ query: 'prefix CAFÉ' })).items.some(({ id }) => id === unicode.id), false, 'literal mode stays the default for spaced queries')
  assert.equal((await unicodeRepo.getPage({ query: ' prefix\nCAFÉ prefix ', matchMode: 'all-terms' })).items.some(({ id }) => id === unicode.id), true, 'all-terms deduplicates Unicode-whitespace terms and still finds full text beyond the preview')
  assert.equal((await unicodeRepo.getPage({ query: 'prefix\uFEFFCAFÉ', matchMode: 'all-terms' })).items.some(({ id }) => id === unicode.id), true, 'all-terms follows ECMAScript whitespace for U+FEFF')
  assert.equal((await unicodeRepo.getPage({ query: 'prefix\u0085CAFÉ', matchMode: 'all-terms' })).items.some(({ id }) => id === unicode.id), false, 'all-terms does not treat U+0085 as ECMAScript whitespace')
  await assert.rejects(unicodeRepo.getPage({ query: Array.from({ length: 65 }, (_, index) => `term${index}`).join(' '), matchMode: 'all-terms' }), /too many terms/, 'synthetic native search preserves the 64-term bound')
  const multiline = await unicodeRepo.addItem({ kind: 'text', text: 'front-token\n中间内容\nback-token', hash: 'multiline-search', byteSize: 37 })
  assert.equal((await unicodeRepo.getPage({ query: 'front-token back-token', matchMode: 'all-terms' })).items.some(({ id }) => id === multiline.id), true, 'all-terms spans lines within one text field')
  const splitFields = await unicodeRepo.addItem({ kind: 'text', text: 'body-token only', hash: 'split-fields', byteSize: 15 })
  await unicodeRepo.setFavorite(splitFields.id, true, 'title-token only')
  assert.equal((await unicodeRepo.getPage({ query: 'title-token body-token', matchMode: 'all-terms' })).items.some(({ id }) => id === splitFields.id), false, 'all-terms cannot assemble a match across favorite title and body')
  const splitFiles = await unicodeRepo.addItem({ kind: 'files', paths: ['/tmp/first-token.txt', '/tmp/second-token.txt'], fileNames: ['first-token.txt', 'second-token.txt'], hash: 'split-files', byteSize: 40 })
  assert.equal((await unicodeRepo.getPage({ query: 'first-token second-token', matchMode: 'all-terms' })).items.some(({ id }) => id === splitFiles.id), false, 'all-terms cannot assemble a match across file names')
  const compositeImage = await unicodeRepo.addItem({ kind: 'image', blobId: 'composite-image', previewBlobId: 'composite-image', contentType: 'image/png', width: 640, height: 480, hash: 'composite-image', byteSize: 10 })
  assert.equal((await unicodeRepo.getPage({ query: 'image/png 640' })).items.some(({ id }) => id === compositeImage.id), true, 'image composite-field search semantics remain intact')
  assert.equal((await unicodeRepo.getPage({ query: '640 480' })).items.some(({ id }) => id === compositeImage.id), true)
  const partialImage = await unicodeRepo.addItem({ kind: 'image', blobId: 'partial-image', previewBlobId: 'partial-image', contentType: 'image/png', height: 480, hash: 'partial-image', byteSize: 10 })
  assert.equal((await unicodeRepo.getPage({ query: 'image/png 480' })).items.some(({ id }) => id === partialImage.id), false, 'missing composite fields retain their semantic spacing')
  const longMemory = syntheticHistoryStorage(); const longRepo = create(longMemory.storage)
  for (let index = 0; index < 100; index++) {
    const text = `Straße ${index} ${'x'.repeat(260_000)}`
    await longRepo.addItem({ kind: 'text', text, hash: `long-${index}`, byteSize: text.length })
  }
  for (let index = 0; index < 10; index++) {
    const text = `Straße escaped ${index} ${'\0'.repeat(300_000)}`
    await longRepo.addItem({ kind: 'text', text, hash: `escaped-${index}`, byteSize: text.length })
  }
  assert.equal((await longRepo.getPage({ query: 'ss' })).items.length, 0, 'broad native candidates are always verified with exact JavaScript semantics')
  assert.ok(longMemory.stats.getMany.length >= 4 && longMemory.stats.getMany.every((keys) => keys.length <= 32), 'large candidate body reads stay under bounded batch size')
  assert.ok(longMemory.stats.getMany.every((keys) => keys.reduce((bytes, key) => bytes + JSON.stringify(longMemory.data.get(key)).length, 0) < 16 * 1024 * 1024), 'escaped candidate bodies stay below the native response ceiling')
  await unicodeRepo.deleteItem(unicode.id)
  unicodeMemory.stats.getMany.length = 0
  assert.equal((await unicodeRepo.getPage({ filter: 'trash', query: '中文检索' })).items.some(({ id }) => id === unicode.id), true)
  assert.ok(unicodeMemory.stats.getMany.length > 0, 'trash full-text fallback uses a bounded batch read')
  console.log('History v2: bounded migration/pages/search, legacy protection, UTC calendar retention, recovery, CAS faults/concurrency, and shared image cleanup passed (synthetic only)')
} finally { Date.now = realNow }
