import type { ClipboardHistoryRepository } from '../storage/clipboardHistoryRepository'
import type { ClipboardHistoryItem } from '../storage/clipboardHistoryTypes'

export const CLIPBOARD_TEXT_MERGE_MIN_ITEMS = 2
export const CLIPBOARD_TEXT_MERGE_MAX_ITEMS = 20

export const CLIPBOARD_TEXT_MERGE_MAX_BYTES = 1024 * 1024
export type ClipboardTextMergeSeparator = 'newline' | 'blankline' | 'custom'

export type ClipboardTextMergePreview = Readonly<{
  ids: readonly string[]
  text: string
  separator: ClipboardTextMergeSeparator
}>

export type ClipboardTextMergeError = {
  code: 'count' | 'duplicate' | 'missing' | 'not-text' | 'read-failed' | 'too-large'
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
export function joinClipboardTexts(texts: readonly string[], separator: ClipboardTextMergeSeparator, customSeparator = ''): string {
  return texts.join(resolveClipboardTextSeparator(separator, customSeparator))
}

function resolveClipboardTextSeparator(separator: ClipboardTextMergeSeparator, customSeparator: string): string {
  return separator === 'custom' ? customSeparator : separator === 'blankline' ? '\n\n' : '\n'
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
      customSeparator = '',
    ): Promise<ClipboardTextMergePreview | undefined> {
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
      const separatorText = resolveClipboardTextSeparator(separator, customSeparator)
      let bytes = new TextEncoder().encode(separatorText).byteLength * (ids.length - 1)
      for (const result of loaded) {
        if ('error' in result) {
          onError(result.error)
          return
        }
        if (result.text.length > CLIPBOARD_TEXT_MERGE_MAX_BYTES) { onError({ code: 'too-large' }); return }
        bytes += new TextEncoder().encode(result.text).byteLength
        if (bytes > CLIPBOARD_TEXT_MERGE_MAX_BYTES) { onError({ code: 'too-large' }); return }
        texts.push(result.text)
      }
      const preview = Object.freeze({ ids, text: joinClipboardTexts(texts, separator, customSeparator), separator })
      currentPreview = preview
      onReady(preview)
      return preview
    },
  }
}

/** Reread complete text and recheck the durable index immediately before one copy. */
export async function copyClipboardTextBundle(
  repository: Pick<ClipboardHistoryRepository, 'getItem' | 'getFreshListItems'>,
  selection: readonly { id: string; hash: string }[],
  separator: ClipboardTextMergeSeparator,
  customSeparator: string,
  isCurrent: () => boolean,
  writeText: (text: string) => Promise<void>,
): Promise<void> {
  const requireCurrent = () => { if (!isCurrent()) throw new Error('aborted') }
  requireCurrent()
  const reader = createClipboardTextMergeReader()
  let failure: ClipboardTextMergeError | undefined
  const preview = await reader.read({ getItem: async (id) => {
    const item = await repository.getItem(id)
    requireCurrent()
    return item?.hash === selection.find((selected) => selected.id === id)?.hash ? item : undefined
  } }, selection.map((item) => item.id), separator,
    () => {}, (error) => { failure = error }, customSeparator)
  requireCurrent()
  if (!preview) throw new Error(failure?.code ?? 'read-failed')
  const index = await repository.getFreshListItems()
  requireCurrent()
  if (selection.some((selected) => !index.some((item) => item.id === selected.id && item.kind === 'text' && item.hash === selected.hash))) {
    throw new Error('read-failed')
  }
  await writeText(preview.text)
}
