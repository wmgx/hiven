/**
 * Per-entry query parameter history for Browser plugin quick-open rules.
 * Stored in plugin private kv (not settings).
 */

import type { PluginPrivateStorageApi } from '@hiven/plugin'

export type QueryHistoryItem = {
  text: string
  lastUsedAt: number
  useCount: number
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
    const useCount = typeof (entry as QueryHistoryItem).useCount === 'number'
      ? Math.max(1, Math.floor((entry as QueryHistoryItem).useCount))
      : 1
    items.push({ text, lastUsedAt, useCount })
  }
  return items
}

/** Dedupe by exact text, move to front, truncate to max. Empty text is a no-op. */
export function upsertQueryHistory(
  items: QueryHistoryItem[],
  text: string,
  max: number,
  now: number = Date.now(),
  observedUseCount?: number,
): QueryHistoryItem[] {
  const trimmed = text.trim()
  if (!trimmed) return items
  const limit = Math.max(1, Math.floor(max) || DEFAULT_MAX_QUERY_HISTORY)
  const previous = items.find((item) => item.text === trimmed)
  const useCount = observedUseCount === undefined
    ? (previous?.useCount ?? 0) + 1
    : Math.max(previous?.useCount ?? 0, Math.max(1, Math.floor(observedUseCount)))
  const rest = items.filter((item) => item.text !== trimmed)
  return [{ text: trimmed, lastUsedAt: Math.max(previous?.lastUsedAt ?? 0, now), useCount }, ...rest].slice(0, limit)
}

export function removeQueryHistoryItem(items: QueryHistoryItem[], text: string): QueryHistoryItem[] {
  const trimmed = text.trim()
  if (!trimmed) return items
  return items.filter((item) => item.text !== trimmed)
}

/** 60% frequency + 40% 30-day recency decay. */
export function filterQueryHistory(items: QueryHistoryItem[], query: string, now: number = Date.now()): QueryHistoryItem[] {
  const q = query.trim().toLowerCase()
  const filtered = q ? items.filter((item) => item.text.toLowerCase().includes(q)) : items
  const maxCount = Math.max(1, ...filtered.map((item) => item.useCount ?? 1))
  return [...filtered].sort((a, b) => {
    const score = (item: QueryHistoryItem) =>
      0.6 * Math.log1p(item.useCount ?? 1) / Math.log1p(maxCount) +
      0.4 * Math.exp(-Math.max(0, now - item.lastUsedAt) / (30 * 24 * 60 * 60 * 1000))
    return score(b) - score(a) || b.lastUsedAt - a.lastUsedAt
  })
}

const TEMPLATE_SLOT_RE = /\{(?:query|clipboard)\}/g
const TEMPLATE_SLOT_MARKER = '__hiven_slot__'

function captureTemplateValue(templatePart: string, actual: string, wildcard: string): string[] | null {
  const slots = templatePart.match(TEMPLATE_SLOT_RE)?.length ?? 0
  if (slots === 0) return templatePart === actual ? [] : null
  const pattern = templatePart
    .split(TEMPLATE_SLOT_RE)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join(`(${wildcard})`)
  const match = actual.match(new RegExp(`^${pattern}$`))
  return match ? match.slice(1).map(decodeURIComponent) : null
}

/** Match only template-declared URL parts; unrelated browser query params are ignored. */
export function queryFromBrowserUrl(template: string, browserUrl: string): string | null {
  try {
    const expected = new URL(template.replace(TEMPLATE_SLOT_RE, TEMPLATE_SLOT_MARKER))
    const actual = new URL(browserUrl)
    if (expected.origin !== actual.origin) return null

    const captures = captureTemplateValue(
      expected.pathname.split(TEMPLATE_SLOT_MARKER).join('{query}'),
      actual.pathname,
      '[^/]+',
    )
    if (!captures) return null
    for (const [key, value] of expected.searchParams) {
      const matched = captureTemplateValue(
        value.split(TEMPLATE_SLOT_MARKER).join('{query}'),
        actual.searchParams.get(key) ?? '',
        '.+',
      )
      if (!matched) return null
      captures.push(...matched)
    }
    if (captures.length === 0 || captures.some((value) => value !== captures[0])) return null
    return captures[0]?.trim() || null
  } catch {
    return null
  }
}

export async function importBrowserQueryHistory(
  storage: PluginPrivateStorageApi,
  entries: readonly { id: string; urlTemplate: string; recordQueryHistory?: boolean; maxQueryHistory?: number }[],
  history: readonly { url: string; lastVisitTime?: number | null; visitCount?: number | null }[],
): Promise<number> {
  let imported = 0
  for (const entry of entries) {
    if (!entry.recordQueryHistory) continue
    let remembered = await loadQueryHistory(storage, entry.id)
    const before = new Set(remembered.map((item) => item.text))
    const limit = clampMaxQueryHistory(entry.maxQueryHistory)
    for (const item of history) {
      const query = queryFromBrowserUrl(entry.urlTemplate, item.url)
      if (query) remembered = upsertQueryHistory(remembered, query, limit, item.lastVisitTime ?? Date.now(), item.visitCount ?? undefined)
    }
    imported += remembered.reduce((count, item) => count + (before.has(item.text) ? 0 : 1), 0)
    await saveQueryHistory(storage, entry.id, remembered)
  }
  return imported
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
