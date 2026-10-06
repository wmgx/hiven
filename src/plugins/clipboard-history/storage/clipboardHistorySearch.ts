import type { ClipboardHistoryItem } from './clipboardHistoryTypes'

export function matchesClipboardHistorySearch(item: ClipboardHistoryItem, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true
  if (item.favoriteTitle?.toLowerCase().includes(normalizedQuery)) return true
  if (item.kind === 'text') {
    return item.preview.toLowerCase().includes(normalizedQuery)
      || item.text.toLowerCase().includes(normalizedQuery)
  }
  if (item.kind === 'image') {
    return `${item.contentType} ${item.width ?? ''} ${item.height ?? ''}`.toLowerCase().includes(normalizedQuery)
  }
  return item.fileNames.some((fileName) => fileName.toLowerCase().includes(normalizedQuery))
}

export function getTextSearchCandidateIds(items: ClipboardHistoryItem[], query: string): string[] {
  if (!query.trim()) return []
  return items
    .filter((item) => item.kind === 'text'
      && !item.text
      && item.preview.endsWith('…')
      && !matchesClipboardHistorySearch(item, query))
    .map((item) => item.id)
}
