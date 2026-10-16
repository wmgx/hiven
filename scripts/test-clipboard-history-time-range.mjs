import assert from 'node:assert/strict'
import { historyModule, syntheticHistoryStorage } from './lib/history-synthetic-storage.mjs'

const timeRangeModule = await import(historyModule('src/plugins/clipboard-history/storage/clipboardHistoryTimeRange.ts'))
const { getClipboardHistoryCopiedSince, getClipboardHistoryLocalDayKey } = timeRangeModule
const { createClipboardHistoryRepository } = await import(historyModule('src/plugins/clipboard-history/storage/clipboardHistoryRepository.ts'))
const { readMatchingHistoryPage } = await import(historyModule('src/plugins/clipboard-history/surfaces/clipboardHistoryPageReader.ts'))

const priorTimezone = process.env.TZ
const realNow = Date.now

function restoreTimezone() {
  if (priorTimezone === undefined) delete process.env.TZ
  else process.env.TZ = priorTimezone
}

function textItem(id, text, lastCopiedAt, extra = {}) {
  return {
    id,
    kind: 'text',
    hash: id,
    text,
    preview: text.length > 30 ? `${text.slice(0, 30)}…` : text,
    firstCopiedAt: lastCopiedAt,
    lastCopiedAt,
    byteSize: text.length,
    copyCount: 1,
    pasteCount: 0,
    isFavorite: false,
    ...extra,
  }
}

function imageItem(id, lastCopiedAt, extra = {}) {
  return {
    id,
    kind: 'image',
    hash: id,
    blobId: `${id}-blob`,
    previewBlobId: `${id}-preview`,
    contentType: 'image/png',
    width: 40,
    height: 30,
    firstCopiedAt: lastCopiedAt,
    lastCopiedAt,
    byteSize: 12,
    copyCount: 1,
    pasteCount: 0,
    isFavorite: false,
    ...extra,
  }
}

function seed(memory, items) {
  memory.data.set('history/index', {
    entries: items.map(({ text, paths, ...entry }) => entry),
    updatedAt: Date.now(),
  })
  for (const item of items) memory.data.set(`history/items/${item.id}`, item)
}

try {
  process.env.TZ = 'America/Los_Angeles'
  const springNow = new Date(2026, 2, 12, 14, 20, 0, 0).getTime()
  const springToday = new Date(2026, 2, 12, 0, 0, 0, 0).getTime()
  const springWeek = new Date(2026, 2, 6, 0, 0, 0, 0).getTime()
  assert.equal(getClipboardHistoryCopiedSince('all', springNow), undefined)
  assert.equal(getClipboardHistoryCopiedSince('today', springNow), springToday)
  assert.equal(getClipboardHistoryCopiedSince('last7Days', springNow), springWeek)
  assert.notEqual(springToday - springWeek, 6 * 86_400_000, 'calendar subtraction must not assume fixed-length DST days')
  assert.equal(getClipboardHistoryLocalDayKey(new Date(2026, 9, 31, 23, 59).getTime()), '2026-10-31')
  assert.equal(getClipboardHistoryLocalDayKey(new Date(2026, 10, 1, 0, 1).getTime()), '2026-11-01')

  process.env.TZ = 'UTC'
  let now = Date.parse('2026-10-16T12:00:00Z')
  Date.now = () => now
  const today = Date.parse('2026-10-16T00:00:00Z')
  const last7Days = Date.parse('2026-10-10T00:00:00Z')
  const memory = syntheticHistoryStorage()
  const recentFullText = textItem('recent-full-text', `preview gap ${'x'.repeat(80)} alpha middle beta`, today + 1_000, { isFavorite: true, favoriteTitle: 'work note' })
  const fixtures = [
    recentFullText,
    textItem('today-text', 'today literal needle', today + 2_000),
    imageItem('today-image', today + 3_000),
    textItem('week-boundary', 'alpha beta boundary', last7Days),
    textItem('too-old', `preview gap ${'x'.repeat(80)} alpha middle beta`, last7Days - 1),
    textItem('old-frequent', 'old frequent', last7Days - 5_000, { pasteCount: 9, lastPastedAt: now }),
    textItem('recent-frequent', 'recent frequent', today + 4_000, { pasteCount: 3, lastPastedAt: now - 1 }),
  ]
  seed(memory, fixtures)
  const repository = createClipboardHistoryRepository(memory.storage)

  assert.deepEqual(
    (await repository.getPage({ copiedSince: today })).items.map(({ id }) => id).sort(),
    ['recent-full-text', 'recent-frequent', 'today-image', 'today-text'].sort(),
  )
  assert.deepEqual(
    (await repository.getPage({ copiedSince: today, filter: 'text' })).items.map(({ id }) => id).sort(),
    ['recent-full-text', 'recent-frequent', 'today-text'].sort(),
  )
  assert.deepEqual(
    (await repository.getPage({ copiedSince: today, filter: 'image' })).items.map(({ id }) => id),
    ['today-image'],
  )
  assert.deepEqual(
    (await repository.getPage({ copiedSince: last7Days })).items.map(({ id }) => id).sort(),
    ['recent-full-text', 'recent-frequent', 'today-image', 'today-text', 'week-boundary'].sort(),
    'the seventh local calendar day is inclusive',
  )
  assert.deepEqual(
    (await repository.getPage({ copiedSince: today, filter: 'favorites' })).items.map(({ id }) => id),
    ['recent-full-text'],
  )
  assert.deepEqual(
    (await repository.getPage({ copiedSince: today, filter: 'frequent', frequentThreshold: 3 })).items.map(({ id }) => id),
    ['recent-frequent'],
    'frequent order filters old high-ranked rows without early termination',
  )
  memory.stats.getMany.length = 0
  assert.deepEqual(
    (await repository.getPage({
      copiedSince: today,
      query: 'alpha beta',
      matchMode: 'all-terms',
    })).items.map(({ id }) => id),
    ['recent-full-text'],
  )
  assert.ok(memory.stats.relatedSearches > 0)
  assert.ok(memory.stats.getMany.every((keys) => keys.length <= 32))
  assert.equal(
    memory.stats.getMany.flat().includes('history/items/too-old'),
    false,
    'time filtering happens before bounded full-body verification',
  )
  assert.deepEqual(
    (await repository.getPage({ copiedSince: today, query: 'literal needle' })).items.map(({ id }) => id),
    ['today-text'],
  )
  await assert.rejects(repository.getPage({ copiedSince: Number.NaN }), /Invalid history time range/)

  const pagingMemory = syntheticHistoryStorage()
  const paged = Array.from({ length: 105 }, (_, index) => textItem(
    `recent-${String(index).padStart(3, '0')}`,
    `recent ${index}`,
    today + 10_000 + index,
  ))
  paged[104] = imageItem('recent-image', today + 10_104)
  paged.push(...Array.from({ length: 8 }, (_, index) => textItem(`old-${index}`, `old ${index}`, today - index - 1)))
  seed(pagingMemory, paged)
  const pagingRepository = createClipboardHistoryRepository(pagingMemory.storage)
  const first = await pagingRepository.getPage({ copiedSince: today, limit: 100 })
  const second = await pagingRepository.getPage({ copiedSince: today, cursor: first.nextCursor, limit: 100 })
  assert.equal(first.items.length, 100)
  assert.ok(first.nextCursor)
  assert.equal(second.items.length, 5)
  assert.equal(second.nextCursor, undefined)
  assert.ok(pagingMemory.stats.maxPage <= 100, 'time ranges retain the existing page-size budget')
  const firstText = await pagingRepository.getPage({ copiedSince: today, filter: 'text', limit: 100 })
  const secondText = await pagingRepository.getPage({ copiedSince: today, filter: 'text', cursor: firstText.nextCursor, limit: 100 })
  assert.equal(firstText.items.length, 100)
  assert.ok(firstText.nextCursor, 'a filtered final storage batch must retain a cursor for unconsumed matching candidates')
  assert.equal(secondText.items.length, 4)
  assert.equal(secondText.nextCursor, undefined)
  assert.equal(new Set([...firstText.items, ...secondText.items].map(({ id }) => id)).size, 104)

  const boundaryMemory = syntheticHistoryStorage()
  seed(boundaryMemory, [
    ...Array.from({ length: 100 }, (_, index) => textItem(`boundary-recent-${index}`, `boundary recent ${index}`, today + index + 1)),
    ...Array.from({ length: 10 }, (_, index) => textItem(`boundary-old-${index}`, `boundary old ${index}`, today - index - 1)),
  ])
  const boundaryRepository = createClipboardHistoryRepository(boundaryMemory.storage)
  const exactBoundaryPage = await boundaryRepository.getPage({ copiedSince: today, limit: 100 })
  assert.equal(exactBoundaryPage.items.length, 100)
  assert.equal(exactBoundaryPage.nextCursor, undefined, 'an old-only tail must not expose a phantom empty time-range page')
  assert.ok(exactBoundaryPage.scanned <= 2_048)
  assert.ok(boundaryMemory.stats.maxPage <= 100)

  const sparseMemory = syntheticHistoryStorage()
  const oldFrequent = Array.from({ length: 2_100 }, (_, index) => textItem(
    `ranked-old-${String(index).padStart(4, '0')}`,
    `ranked old ${index}`,
    today - index - 1,
    { pasteCount: 20, lastPastedAt: now - index },
  ))
  const lateRecent = textItem('late-recent', 'late recent match', today + 1, { pasteCount: 3, lastPastedAt: 1 })
  seed(sparseMemory, [...oldFrequent, lateRecent])
  const sparseRepository = createClipboardHistoryRepository(sparseMemory.storage)
  const traversed = []
  const sparseResult = await readMatchingHistoryPage(async (cursor) => {
    const page = await sparseRepository.getPage({
      copiedSince: today,
      filter: 'frequent',
      frequentThreshold: 3,
      cursor,
      limit: 100,
    })
    traversed.push(page)
    return page
  }, undefined, new AbortController().signal, () => undefined)
  assert.ok(traversed.length > 1)
  assert.equal(traversed[0].items.length, 0)
  assert.ok(traversed[0].nextCursor)
  assert.deepEqual(sparseResult.items.map(({ id }) => id), ['late-recent'])
  assert.ok(sparseMemory.stats.maxPage <= 100)

  const surface = await import('node:fs').then(({ readFileSync }) => readFileSync('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx', 'utf8'))
  assert.match(surface, /copiedSince \?\? null/, 'time boundary participates in pagination criteria identity')
  assert.match(surface, /next === 'trash'\) setTimeRange\('all'\)/, 'trash entry visibly clears the inapplicable time range')
  assert.match(surface, /syncLocalDay = useCallback[\s\S]*getClipboardHistoryLocalDayKey\(now\)[\s\S]*setLocalDayAnchor\(now\)/, 'all re-query entry points can refresh a stale local-day boundary')
  assert.match(surface, /clearPage = useCallback[\s\S]*setRefreshEpoch\(\(value\) => value \+ 1\)/, 'cursor resets always schedule a replacement query, including All time on page one')
  assert.match(surface, /resetPage = useCallback[\s\S]*syncLocalDay\(\)[\s\S]*clearPage\(\)/, 'criteria changes refresh the day boundary and reset cursors')
  assert.match(surface, /changePage = useCallback[\s\S]*syncLocalDay\(\)[\s\S]*clearPage\(\)/, 'pagination resets instead of traversing a stale cross-midnight cursor')
  assert.match(surface, /subscribeCachedIndex\(refreshVisibleDay\)/, 'cache invalidation re-queries through the local-day boundary check')
  assert.match(surface, /resetBrowser = useCallback[\s\S]*setTimeRange\('all'\)/, 'a completed browse action resets the time filter with the other browse criteria')
  const pluginUi = await import('node:fs').then(({ readFileSync }) => readFileSync('src/plugin-ui.tsx', 'utf8'))
  assert.match(pluginUi, /aria-pressed=\{option\.value === value\}/, 'segmented controls expose their selected state to assistive technology')

  console.log('Clipboard History time ranges passed: local-calendar DST/midnight, candidate filtering, search modes, type/favorite/frequent combinations, sparse pagination, and trash reset')
} finally {
  Date.now = realNow
  restoreTimezone()
}
