import { performance } from 'node:perf_hooks'
import { historyModule, syntheticHistoryStorage } from './lib/history-synthetic-storage.mjs'

const { createClipboardHistoryRepository } = await import(historyModule('src/plugins/clipboard-history/storage/clipboardHistoryRepository.ts'))
const count = Number(process.argv[2] ?? 10_000)
const textSize = Number(process.argv[3] ?? 4_096)
const now = Date.parse('2026-10-14T00:00:00Z')
const memory = syntheticHistoryStorage()
memory.data.set('history/v2/state', { version: 2, phase: 'complete', revision: 'benchmark', active: count, trash: 0, legacy: 0 })
for (let index = 0; index < count; index++) {
  const id = `synthetic-${String(index).padStart(6, '0')}`
  const marker = index === count - 1 ? ' tail-needle 中文目标 ' : index % 997 === 0 ? ' many-match ' : ' '
  const text = (`row-${index}${marker}` + 'x'.repeat(textSize)).slice(0, textSize)
  const item = { id, kind: 'text', hash: id, text, preview: text.slice(0, 200), firstCopiedAt: now - index, lastCopiedAt: now - index, byteSize: text.length, copyCount: 1, pasteCount: 0, isFavorite: false }
  const meta = { ...item }; delete meta.text
  const inverted = String(9_000_000_000_000_000 - item.lastCopiedAt).padStart(16, '0')
  memory.data.set(`history/items/${id}`, item)
  memory.data.set(`history/v2/order/${inverted}/${id}`, meta)
}
const repository = createClipboardHistoryRepository(memory.storage)
async function run(query) {
  memory.stats.gets.length = 0
  memory.stats.getMany.length = 0
  memory.stats.relatedSearches = 0
  memory.stats.maxPage = 0
  const start = performance.now()
  let cursor
  let matches = 0
  let scanned = 0
  do {
    const page = await repository.getPage({ query, cursor, limit: 100 })
    matches += page.items.length
    scanned += page.scanned
    cursor = page.nextCursor
  } while (cursor)
  return { query, durationMs: Number((performance.now() - start).toFixed(2)), matches, scanned, singleGets: memory.stats.gets.length, batchReads: memory.stats.getMany.length, relatedSearches: memory.stats.relatedSearches, maxMetadataPage: memory.stats.maxPage }
}
const results = []
for (const query of ['absent-value', 'tail-needle', '中文目标', 'many-match']) results.push(await run(query))
console.log(JSON.stringify({ environment: `node ${process.version} synthetic in-memory KV`, records: count, textChars: textSize, results }, null, 2))
