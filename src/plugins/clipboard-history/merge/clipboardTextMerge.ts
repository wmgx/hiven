import type { ClipboardHistoryRepository } from '../storage/clipboardHistoryRepository'
import type { ClipboardHistoryItem } from '../storage/clipboardHistoryTypes'

export const CLIPBOARD_TEXT_MERGE_MIN_ITEMS = 2
export const CLIPBOARD_TEXT_MERGE_MAX_ITEMS = 20

export type ClipboardTextMergeSeparator = 'newline' | 'blankline'

export type ClipboardTextMergePreview = Readonly<{
  ids: readonly string[]
  text: string
  separator: ClipboardTextMergeSeparator
}>

export type ClipboardTextMergeError = {
  code: 'count' | 'duplicate' | 'missing' | 'not-text' | 'read-failed'
  id?: string
}

type ClipboardTextMergeSelection = {
  ids: readonly string[]
  error: 'limit' | 'not-text' | null
}

/** Selection order belongs to this session, never to the current history/search order. */
export function toggleClipboardTextMergeSelection(
  ids: readonly string[],
  item: Pick<ClipboardHistoryItem, 'id' | 'kind'>,
): ClipboardTextMergeSelection {
  if (item.kind !== 'text') return { ids, error: 'not-text' }
  if (ids.includes(item.id)) return { ids: removeClipboardTextMergeSelection(ids, item.id), error: null }
  if (ids.length >= CLIPBOARD_TEXT_MERGE_MAX_ITEMS) return { ids, error: 'limit' }
  return { ids: [...ids, item.id], error: null }
}

export function removeClipboardTextMergeSelection(ids: readonly string[], id: string): readonly string[] {
  return ids.includes(id) ? ids.filter((selectedId) => selectedId !== id) : ids
}

export function moveClipboardTextMergeSelection(
  ids: readonly string[],
  id: string,
  direction: -1 | 1,
): readonly string[] {
  const index = ids.indexOf(id)
  const destination = index + direction
  if (index < 0 || destination < 0 || destination >= ids.length) return ids
  const next = [...ids]
  ;[next[index], next[destination]] = [next[destination], next[index]]
  return next
}

/** Do not trim, normalize line endings, deduplicate, or fall back to list previews. */
export function joinClipboardTexts(texts: readonly string[], separator: ClipboardTextMergeSeparator): string {
  return texts.join(separator === 'blankline' ? '\n\n' : '\n')
}

type TextRead = { text: string } | { error: ClipboardTextMergeError }

/**
 * A transient reader for one surface session. Call invalidate synchronously when
 * selection/separator changes or the surface is cancelled, disabled, or left.
 * Only a complete issued preview may be handed to the existing single-text host API.
 */
export function createClipboardTextMergeReader() {
  let revision = 0
  let currentPreview: ClipboardTextMergePreview | null = null

  return {
    invalidate() {
      revision += 1
      currentPreview = null
    },
    isCurrent(preview: ClipboardTextMergePreview | null | undefined): boolean {
      return preview != null && preview === currentPreview
    },
    async read(
      repository: Pick<ClipboardHistoryRepository, 'getItem'>,
      selectedIds: readonly string[],
      separator: ClipboardTextMergeSeparator,
      onReady: (preview: ClipboardTextMergePreview) => void,
      onError: (error: ClipboardTextMergeError) => void,
    ): Promise<void> {
      const requestRevision = ++revision
      currentPreview = null
      const ids = Object.freeze([...selectedIds])
      if (ids.length < CLIPBOARD_TEXT_MERGE_MIN_ITEMS || ids.length > CLIPBOARD_TEXT_MERGE_MAX_ITEMS) {
        onError({ code: 'count' })
        return
      }
      const seen = new Set<string>()
      for (const id of ids) {
        if (seen.has(id)) {
          onError({ code: 'duplicate', id })
          return
        }
        seen.add(id)
      }

      // At most 20 independent reads; Promise.all keeps the explicit selection order.
      const loaded = await Promise.all(ids.map(async (id): Promise<TextRead> => {
        try {
          const item = await repository.getItem(id)
          if (!item) return { error: { code: 'missing', id } }
          if (item.kind !== 'text') return { error: { code: 'not-text', id } }
          if (item.id !== id || typeof item.text !== 'string') return { error: { code: 'read-failed', id } }
          return { text: item.text }
        } catch {
          // Storage errors can contain private values; only expose a stable code and ID.
          return { error: { code: 'read-failed', id } }
        }
      }))
      if (requestRevision !== revision) return

      const texts: string[] = []
      for (const result of loaded) {
        if ('error' in result) {
          onError(result.error)
          return
        }
        texts.push(result.text)
      }
      const preview = Object.freeze({ ids, text: joinClipboardTexts(texts, separator), separator })
      currentPreview = preview
      onReady(preview)
    },
  }
}
