import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
const cache = new Map()
export function historyModule(relative) {
  const file = path.resolve(relative)
  if (cache.has(file)) return cache.get(file)
  let source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2023 } }).outputText
  source = source.replace(/from ['"](\.[^'"]+)['"]/g, (_, dependency) => `from '${historyModule(path.resolve(path.dirname(file), dependency + '.ts'))}'`)
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  cache.set(file, url)
  return url
}
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
export function syntheticHistoryStorage() {
  const data = new Map()
  const deletedBlobs = []
  const stats = { maxPage: 0, maxArrayPage: 0, gets: [], getMany: [], relatedSearches: 0, batches: 0 }
  let rejectBatch
  let rejectBlob = false
  const storage = {
    kv: {
      get: async (key) => { stats.gets.push(key); return clone(data.get(key)) },
      getMany: async (keys) => {
        stats.getMany.push([...keys])
        return keys.flatMap((key) => data.has(key) ? [{ key, value: clone(data.get(key)) }] : [])
      },
      relatedSearch: async ({ indexPrefix, valuePrefix, after, limit = 64, scanLimit = 512, query, idPath, indexPaths, indexPathGroups = [], valuePaths }) => {
        stats.relatedSearches++
        const keys = [...data.keys()].filter((key) => key.startsWith(indexPrefix) && (!after || key > after)).sort()
        const normalized = query.trim().toLowerCase()
        const upper = normalized.toUpperCase()
        const at = (value, jsonPath) => jsonPath.slice(2).split('.').reduce((current, field) => current?.[field], value)
        const matches = (value) => Array.isArray(value) ? value.some(matches) : (typeof value === 'string' || typeof value === 'number') && (String(value).toLowerCase().includes(normalized) || String(value).toUpperCase().includes(upper))
        const entries = []
        const scannedKeys = keys.slice(0, scanLimit)
        let lastKey
        for (const key of scannedKeys) {
          lastKey = key
          const index = data.get(key)
          const related = data.get(valuePrefix + at(index, idPath))
          const groups = indexPathGroups.map((paths) => paths.map((path) => at(index, path)).filter((value) => typeof value === 'string' || typeof value === 'number').join(' '))
          if ([...indexPaths.map((path) => at(index, path)), ...groups, ...valuePaths.map((path) => at(related, path))].some(matches)) entries.push({ key, value: clone(index) })
          if (entries.length === limit) break
        }
        const consumed = lastKey ? keys.indexOf(lastKey) + 1 : 0
        return { entries, scanned: consumed, ...(consumed < keys.length ? { nextCursor: lastKey } : {}) }
      },
      set: async (key, value) => { data.set(key, clone(value)) },
      delete: async (key) => { data.delete(key) },
      list: async () => { throw new Error('Unbounded list forbidden') },
      page: async ({ prefix, after, limit = 64, order = 'asc' }) => {
        stats.maxPage = Math.max(stats.maxPage, limit)
        const keys = [...data.keys()].filter((key) => key.startsWith(prefix)).sort()
        if (order === 'desc') keys.reverse()
        const selected = keys.filter((key) => !after || (order === 'asc' ? key > after : key < after))
        const slice = selected.slice(0, limit)
        return { entries: slice.map((key) => ({ key, value: clone(data.get(key)), updatedAt: 0 })), ...(selected.length > limit ? { nextCursor: slice.at(-1) } : {}) }
      },
      arrayPage: async ({ key, path: jsonPath, afterIndex = -1, limit = 64 }) => {
        stats.maxArrayPage = Math.max(stats.maxArrayPage, limit)
        const raw = data.get(key)
        if (raw === undefined) return { entries: [] }
        const entries = raw[jsonPath.slice(2)]
        if (!Array.isArray(entries)) throw new Error('invalid array')
        const slice = entries.slice(afterIndex + 1, afterIndex + 1 + limit)
        return { entries: slice.map((value, index) => ({ index: afterIndex + 1 + index, value: clone(value) })), ...(afterIndex + 1 + slice.length < entries.length ? { nextIndex: afterIndex + slice.length } : {}) }
      },
      batch: async ({ checks = [], operations }) => {
        stats.batches++
        if (checks.some(({ key, expected }) => JSON.stringify(data.get(key)) !== JSON.stringify(clone(expected)))) return { committed: false }
        if (rejectBatch?.(operations)) { rejectBatch = undefined; throw new Error('simulated atomic failure') }
        for (const op of operations) { if (op.type === 'set') data.set(op.key, clone(op.value)); else data.delete(op.key) }
        return { committed: true }
      },
    },
    blob: { delete: async (id) => { if (rejectBlob) throw new Error('simulated blob failure'); deletedBlobs.push(id) } },
  }
  return { data, storage, stats, deletedBlobs, failBatch: (condition) => { rejectBatch = condition }, failBlob: (value) => { rejectBlob = value } }
}
