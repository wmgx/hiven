import type { PluginPrivateStorageApi } from '@hiven/plugin'
import { EMPTY_DB, readDb, type MemoDb } from './model'

// One in-memory copy shared by the surface and the Global Launcher items, so
// root search answers synchronously after the first load.
const KEY = 'db'
let current: MemoDb = EMPTY_DB
let loading: Promise<MemoDb> | null = null
let writing: Promise<void> = Promise.resolve()
const listeners = new Set<() => void>()

export const memoSnapshot = () => current
export function subscribeMemo(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function loadMemo(storage: PluginPrivateStorageApi): Promise<MemoDb> {
  loading ??= storage.kv.get(KEY).then(value => {
    current = readDb(value)
    listeners.forEach(listener => listener())
    return current
  }).catch(error => {
    loading = null
    throw error
  })
  // Later saves replace `current`; never hand out the snapshot from load time.
  return loading.then(() => current)
}

/** Writes are serialized; the caller only sees the new db once storage accepted it. */
export function saveMemo(storage: PluginPrivateStorageApi, next: MemoDb): Promise<void> {
  const write = writing.then(() => storage.kv.set(KEY, next)).then(() => {
    current = next
    listeners.forEach(listener => listener())
  })
  writing = write.catch(() => {})
  return write
}

/** What a root search result asked to open; the surface takes it once on mount. */
export type PendingOpen = { type: 'record' | 'kind'; id: string; query: string } | { type: 'search'; query: string }
let pendingOpen: PendingOpen | null = null
export function requestOpen(value: PendingOpen) { pendingOpen = value }
export function takePendingOpen() {
  const value = pendingOpen
  pendingOpen = null
  return value
}
