import type { ClipboardHistoryItem } from './clipboardHistoryTypes'

export type ClipboardHistorySearchMatchMode = 'literal' | 'all-terms'

export function getClipboardHistorySearchNeedles(
  query: string,
  matchMode: ClipboardHistorySearchMatchMode = 'literal',
): string[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return []
  if (matchMode === 'literal') return [normalizedQuery]
  return [...new Set(normalizedQuery.split(/\s+/u).filter(Boolean))]
}

export function clipboardHistorySearchFieldMatches(
  value: string,
  query: string,
  matchMode: ClipboardHistorySearchMatchMode = 'literal',
): boolean {
  const needles = getClipboardHistorySearchNeedles(query, matchMode)
  if (!needles.length) return true
  const normalizedValue = value.toLowerCase()
  return needles.every((needle) => normalizedValue.includes(needle))
}

export function matchesClipboardHistorySearch(
  item: ClipboardHistoryItem,
  query: string,
  matchMode: ClipboardHistorySearchMatchMode = 'literal',
): boolean {
  if (!query.trim()) return true
  if (item.favoriteTitle && clipboardHistorySearchFieldMatches(item.favoriteTitle, query, matchMode)) return true
  if (item.kind === 'text') {
    return clipboardHistorySearchFieldMatches(item.preview, query, matchMode)
      || clipboardHistorySearchFieldMatches(item.text, query, matchMode)
  }
  if (item.kind === 'image') {
    return clipboardHistorySearchFieldMatches(
      `${item.contentType} ${item.width ?? ''} ${item.height ?? ''}`,
      query,
      matchMode,
    )
  }
  return item.fileNames.some((fileName) => clipboardHistorySearchFieldMatches(fileName, query, matchMode))
}

export function getTextSearchCandidateIds(
  items: ClipboardHistoryItem[],
  query: string,
  matchMode: ClipboardHistorySearchMatchMode = 'literal',
): string[] {
  if (!query.trim()) return []
  return items
    .filter((item) => item.kind === 'text'
      && !item.text
      && item.preview.endsWith('…')
      && !matchesClipboardHistorySearch(item, query, matchMode))
    .map((item) => item.id)
}
