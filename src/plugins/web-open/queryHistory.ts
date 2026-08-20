/**
 * Per-entry query parameter history for Browser plugin quick-open rules.
 * Stored in plugin private kv (not settings).
 */

import type { PluginPrivateStorageApi } from '@hiven/plugin'

export type QueryHistoryItem = {
  text: string
  lastUsedAt: number
}

export type QueryHistoryRecord = {
  queries: QueryHistoryItem[]
}

export const DEFAULT_MAX_QUERY_HISTORY = 20

export function queryHistoryKey(entryId: string): string {
  return `query-history/${entryId}`
}

export function normalizeQueryHistory(raw: unknown): QueryHistoryItem[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const queries = (raw as QueryHistoryRecord).queries
  if (!Array.isArray(queries)) return []
  const items: QueryHistoryItem[] = []
  for (const entry of queries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const text = typeof (entry as QueryHistoryItem).text === 'string'
      ? (entry as QueryHistoryItem).text.trim()
      : ''
    if (!text) continue
    const lastUsedAt = typeof (entry as QueryHistoryItem).lastUsedAt === 'number'
      ? (entry as QueryHistoryItem).lastUsedAt
      : 0
    items.push({ text, lastUsedAt })
  }
  return items
}

/** Dedupe by exact text, move to front, truncate to max. Empty text is a no-op. */
export function upsertQueryHistory(
  items: QueryHistoryItem[],
  text: string,
  max: number,
  now: number = Date.now(),
): QueryHistoryItem[] {
  const trimmed = text.trim()
  if (!trimmed) return items
  const limit = Math.max(1, Math.floor(max) || DEFAULT_MAX_QUERY_HISTORY)
  const rest = items.filter((item) => item.text !== trimmed)
  return [{ text: trimmed, lastUsedAt: now }, ...rest].slice(0, limit)
}

export function removeQueryHistoryItem(items: QueryHistoryItem[], text: string): QueryHistoryItem[] {
  const trimmed = text.trim()
  if (!trimmed) return items
  return items.filter((item) => item.text !== trimmed)
}

/** Case-insensitive substring filter; empty query returns all (newest first assumed). */
export function filterQueryHistory(items: QueryHistoryItem[], query: string): QueryHistoryItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((item) => item.text.toLowerCase().includes(q))
}

export function clampMaxQueryHistory(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_MAX_QUERY_HISTORY
  return Math.max(1, Math.floor(n))
}

export async function loadQueryHistory(
  storage: PluginPrivateStorageApi,
  entryId: string,
): Promise<QueryHistoryItem[]> {
  try {
    const raw = await storage.kv.get(queryHistoryKey(entryId))
    return normalizeQueryHistory(raw)
  } catch {
    return []
  }
}

export async function saveQueryHistory(
  storage: PluginPrivateStorageApi,
  entryId: string,
  items: QueryHistoryItem[],
): Promise<void> {
  const key = queryHistoryKey(entryId)
  if (items.length === 0) {
    try {
      await storage.kv.delete(key)
    } catch {
      // ignore
    }
    return
  }
  try {
    await storage.kv.set(key, { queries: items } satisfies QueryHistoryRecord)
  } catch {
    // silent write failure
  }
}

export async function clearQueryHistory(
  storage: PluginPrivateStorageApi,
  entryId: string,
): Promise<void> {
  try {
    await storage.kv.delete(queryHistoryKey(entryId))
  } catch {
    // ignore
  }
}

export async function recordQueryHistory(
  storage: PluginPrivateStorageApi,
  entryId: string,
  text: string,
  max: number = DEFAULT_MAX_QUERY_HISTORY,
): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  const current = await loadQueryHistory(storage, entryId)
  const next = upsertQueryHistory(current, trimmed, clampMaxQueryHistory(max))
  await saveQueryHistory(storage, entryId, next)
}

export async function removeQueryHistoryEntry(
  storage: PluginPrivateStorageApi,
  entryId: string,
  text: string,
): Promise<void> {
  const current = await loadQueryHistory(storage, entryId)
  const next = removeQueryHistoryItem(current, text)
  await saveQueryHistory(storage, entryId, next)
}
