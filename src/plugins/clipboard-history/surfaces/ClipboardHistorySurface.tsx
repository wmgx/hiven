/**
 * Clipboard History Plugin — Main Surface
 *
 * Host-openable custom-view surface providing:
 * - Top bar: plugin-owned back, search, type filter, settings, close
 * - Left panel: grouped clipboard history list
 * - Right panel: preview and metadata for the selected item
 * - Keyboard shortcuts: Enter=paste, Cmd/Ctrl+C=copy selection in preview, Delete=remove
 */

import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, useId, memo, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { PluginSurfaceProps } from '@hiven/plugin'
import {
  Button,
  ContextMenu,
  Dialog,
  IconButton,
  SearchField,
  SegmentedControl,
  SurfaceEmptyState,
  SurfaceFooterHints,
  SurfaceList,
  SurfaceListItem,
  SurfacePreview,
  ToolbarButton,
  useImeKeyboard,
  type MenuItemSpec,
} from '@hiven/plugin-ui'
import { BackIcon, ClipboardIcon, CloseIcon, FileTextIcon, ImageIcon, SettingsIcon, StarIcon } from '@hiven/plugin-ui/icons'
import type { ClipboardHistorySettings } from '../settings/model'
import type { ClipboardHistoryItem } from '../storage/clipboardHistoryTypes'
import { subscribeCachedIndex } from '../storage/clipboardHistoryCache'
import { createClipboardHistoryRepository, indexToListItems } from '../storage/clipboardHistoryRepository'
import { getTextSearchCandidateIds, matchesClipboardHistorySearch } from '../storage/clipboardHistorySearch'
import {
  CLIPBOARD_TEXT_MERGE_MIN_ITEMS,
  CLIPBOARD_TEXT_MERGE_MAX_ITEMS,
  createClipboardTextMergeReader,
  toggleClipboardTextMergeSelection,
  removeClipboardTextMergeSelection,
  moveClipboardTextMergeSelection,
  type ClipboardTextMergePreview,
  type ClipboardTextMergeError,
  type ClipboardTextMergeSeparator,
} from '../merge/clipboardTextMerge'
import { ClipboardTextMergePanel } from './ClipboardTextMergePanel'
import { getClipboardHistoryMatchContext, getClipboardHistoryMatchSnippet } from './clipboardHistoryMatchContext'
import {
  getClipboardHistoryShortcuts,
  observeClipboardHistoryShortcutFocus,
  readClipboardHistoryShortcutFocus,
  type ClipboardHistoryShortcutFocus,
} from './clipboardHistoryShortcuts'

type FilterKind = 'all' | 'text' | 'image' | 'files' | 'frequent' | 'favorite'
type SurfaceStorage = PluginSurfaceProps<ClipboardHistorySettings>['host']['storage']

function initialFilter(surfaceId: string): FilterKind {
  if (surfaceId === 'text' || surfaceId === 'image' || surfaceId === 'files' || surfaceId === 'frequent' || surfaceId === 'favorite') return surfaceId
  return 'all'
}
type ImageHistoryItem = Extract<ClipboardHistoryItem, { kind: 'image' }>

type MetaRow = {
  label: string
  value: string
}

type FavoriteTitleDialogState = {
  id: string
  draft: string
  mode: 'create' | 'edit'
}

export function ClipboardHistorySurface(props: PluginSurfaceProps<ClipboardHistorySettings>) {
  const { host, locale, t, settings } = props

  const repository = useMemo(
    () => createClipboardHistoryRepository(host.storage),
    [host.storage]
  )

  // Try to initialize synchronously from in-memory cache (warmed by background)
  const initialItems = useMemo(() => repository.getListItemsSync() ?? [], [repository])
  const hasInitialCache = initialItems.length > 0

  const [items, setItems] = useState<ClipboardHistoryItem[]>(initialItems)
  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.id ?? null)
  const [query, setQuery] = useState('')
  const [pasteNotice, setPasteNotice] = useState<string | null>(null)
  const pasteNoticeGenerationRef = useRef(0)
  const [filter, setFilter] = useState<FilterKind>(() => initialFilter(props.surfaceId))
  const [loading, setLoading] = useState(!hasInitialCache)
  const [fullTextSearchState, setFullTextSearchState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [titleDialog, setTitleDialog] = useState<FavoriteTitleDialogState | null>(null)
  const [shortcutFocus, setShortcutFocus] = useState<ClipboardHistoryShortcutFocus>({
    withinSurface: false, nativeButton: false, editing: false,
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const imeKeyDown = useImeKeyboard()
  const pendingDeleteRef = useRef<{ timerId: ReturnType<typeof setTimeout>; id: string; toastId: string } | null>(null)
  const unreadableTextIdsRef = useRef(new Set<string>())
  const frequentThreshold = settings.frequentPasteThreshold ?? 3
  const [mergeReader] = useState(createClipboardTextMergeReader)
  const [combining, setCombining] = useState(false)
  useLayoutEffect(() => {
    pasteNoticeGenerationRef.current += 1
    setPasteNotice(null)
    return () => { pasteNoticeGenerationRef.current += 1 }
  }, [query, selectedId, filter, combining, host, settings.enabled])
  const [mergeIds, setMergeIds] = useState<readonly string[]>([])
  // The selection owns its order and labels; searches and background index refreshes do not.
  const mergeItemsRef = useRef(new Map<string, ClipboardHistoryItem>())
  const [mergeSeparator, setMergeSeparator] = useState<ClipboardTextMergeSeparator>('newline')
  const [mergePreview, setMergePreview] = useState<ClipboardTextMergePreview | null>(null)
  const [mergeError, setMergeError] = useState<ClipboardTextMergeError | null>(null)
  const [mergeLoading, setMergeLoading] = useState(false)
  const [mergeRetry, setMergeRetry] = useState(0)
  const [mergeSuspended, setMergeSuspended] = useState(false)
  const mergeSuspendedRef = useRef(false)
  const mergeSubmissionRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const surface = containerRef.current
    if (surface) return observeClipboardHistoryShortcutFocus(surface, setShortcutFocus)
  }, [combining])

  const invalidateMerge = useCallback((cancelSubmission = true) => {
    if (cancelSubmission) {
      mergeSubmissionRef.current?.abort()
      mergeSubmissionRef.current = null
    }
    mergeReader.invalidate()
    setMergePreview(null)
    setMergeError(null)
  }, [mergeReader])

  const cancelMerge = useCallback(() => {
    invalidateMerge()
    setCombining(false)
    setMergeIds([])
    mergeItemsRef.current.clear()
    setMergeLoading(false)
    mergeSuspendedRef.current = false
    setMergeSuspended(false)
    searchRef.current?.focus()
  }, [invalidateMerge])

  const startMerge = useCallback(() => {
    invalidateMerge()
    setMergeIds([])
    mergeItemsRef.current.clear()
    setMergeSeparator('newline')
    mergeSuspendedRef.current = document.visibilityState === 'hidden'
    setMergeSuspended(mergeSuspendedRef.current)
    setCombining(true)
    searchRef.current?.focus()
  }, [invalidateMerge])

  const toggleMergeItem = useCallback((item: ClipboardHistoryItem) => {
    const result = toggleClipboardTextMergeSelection(mergeIds, item)
    if (result.error) {
      host.showMessage(t(result.error === 'limit' ? 'merge.limit' : 'merge.textOnly', { max: CLIPBOARD_TEXT_MERGE_MAX_ITEMS }), 'info')
      return
    }
    invalidateMerge()
    if (result.ids.includes(item.id)) mergeItemsRef.current.set(item.id, item)
    else mergeItemsRef.current.delete(item.id)
    setMergeIds(result.ids)
  }, [mergeIds, invalidateMerge, host, t])

  const removeMergeItem = useCallback((id: string) => {
    invalidateMerge()
    mergeItemsRef.current.delete(id)
    setMergeIds((current) => removeClipboardTextMergeSelection(current, id))
  }, [invalidateMerge])

  const moveMergeItem = useCallback((id: string, direction: -1 | 1) => {
    invalidateMerge()
    setMergeIds((current) => moveClipboardTextMergeSelection(current, id, direction))
  }, [invalidateMerge])

  const changeMergeSeparator = useCallback((separator: ClipboardTextMergeSeparator) => {
    if (separator === mergeSeparator) return
    invalidateMerge()
    setMergeSeparator(separator)
  }, [invalidateMerge, mergeSeparator])

  useEffect(() => {
    if (!combining || mergeSuspended || mergeSuspendedRef.current || !settings.enabled || mergeIds.length < CLIPBOARD_TEXT_MERGE_MIN_ITEMS) {
      setMergeLoading(false)
      return
    }
    setMergeLoading(true)
    void mergeReader.read(repository, mergeIds, mergeSeparator, (preview) => {
      setMergePreview(preview)
      setMergeError(null)
      setMergeLoading(false)
    }, (error) => {
      setMergePreview(null)
      setMergeError(error)
      setMergeLoading(false)
    })
    return () => mergeReader.invalidate()
  }, [combining, settings.enabled, mergeIds, mergeSeparator, mergeReader, repository, mergeRetry, mergeSuspended])

  useEffect(() => {
    if (!settings.enabled) cancelMerge()
  }, [settings.enabled, cancelMerge])

  useEffect(() => () => {
    mergeSubmissionRef.current?.abort()
    mergeSubmissionRef.current = null
    mergeReader.invalidate()
  }, [mergeReader])

  useEffect(() => {
    if (!combining) return
    const suspend = () => {
      mergeSuspendedRef.current = true
      // Showing Launcher blurs this window. Keep the submitted preview until its
      // receipt arrives; explicit draft edits/cancel still revoke the submission.
      if (!mergeSubmissionRef.current) {
        invalidateMerge(false)
        setMergeLoading(false)
      }
      setMergeSuspended(true)
    }
    const resume = () => {
      if (document.visibilityState === 'hidden' || !mergeSuspendedRef.current) return
      mergeSuspendedRef.current = false
      setMergeSuspended(false)
      // A quick blur/focus can batch back to the previous false state. A new
      // read revision ensures the invalidated preview is rebuilt even then.
      setMergeRetry((current) => current + 1)
    }
    const onVisibilityChange = () => document.visibilityState === 'hidden' ? suspend() : resume()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', suspend)
    window.addEventListener('pageshow', resume)
    window.addEventListener('blur', suspend)
    window.addEventListener('focus', resume)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', suspend)
      window.removeEventListener('pageshow', resume)
      window.removeEventListener('blur', suspend)
      window.removeEventListener('focus', resume)
    }
  }, [combining, invalidateMerge])

  const continueMerge = useCallback(async () => {
    if (mergeSubmissionRef.current || !settings.enabled || !combining || mergeSuspended || mergeSuspendedRef.current || !mergePreview || !mergeReader.isCurrent(mergePreview)) return
    const text = mergePreview.text
    const submission = new AbortController()
    mergeSubmissionRef.current = submission
    setMergeLoading(true)
    try {
      const accepted = await host.returnToLauncherWithObject({ kind: 'text', text, source: 'tool-result' }, { signal: submission.signal })
      if (mergeSubmissionRef.current !== submission || submission.signal.aborted) return
      mergeSubmissionRef.current = null
      if (accepted !== false) cancelMerge()
      else {
        setMergeLoading(false)
        setMergeRetry((current) => current + 1)
      }
    } catch {
      if (mergeSubmissionRef.current !== submission || submission.signal.aborted) return
      mergeSubmissionRef.current = null
      setMergeLoading(false)
      host.showMessage(t('error.returnFailed'), 'error')
      setMergeRetry((current) => current + 1)
    }
  }, [settings.enabled, combining, mergePreview, mergeReader, host, cancelMerge, t, mergeSuspended])

  const applyListItems = useCallback((listItems: ClipboardHistoryItem[]) => {
    setItems((current) => {
      const previousById = new Map(current.map((item) => [item.id, item]))
      return listItems.map((item) => {
        const previous = previousById.get(item.id)
        // Index refreshes must not temporarily remove full-text search matches.
        // Keep only text for the same content; all fresh metadata still wins.
        return item.kind === 'text' && !item.text && item.hash
          && previous?.kind === 'text' && previous.hash === item.hash && previous.text
          ? { ...item, text: previous.text }
          : item
      })
    })
    setSelectedId((current) => {
      if (listItems.length === 0) return null
      if (current && listItems.some((item) => item.id === current)) return current
      return listItems[0].id
    })
    setLoading(false)
  }, [])

  const loadItems = useCallback(async () => {
    try {
      const listItems = await repository.getFreshListItems()
      applyListItems(listItems)
    } catch {
      host.showMessage(t('error.loadFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }, [repository, host, t, applyListItems])

  useEffect(() => {
    // If we already have cached data, skip the initial load delay
    if (hasInitialCache) return
    const timer = window.setTimeout(() => { void loadItems() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadItems, hasInitialCache])

  useEffect(() => {
    const candidateIds = getTextSearchCandidateIds(items, query)
      .filter((id) => !unreadableTextIdsRef.current.has(id))
    if (candidateIds.length === 0) {
      setFullTextSearchState('idle')
      return
    }

    let cancelled = false
    setFullTextSearchState('loading')
    const timer = window.setTimeout(() => {
      void (async () => {
        const textById = new Map<string, string>()
        for (let offset = 0; offset < candidateIds.length && !cancelled; offset += 8) {
          const batchIds = candidateIds.slice(offset, offset + 8)
          const loadedItems = await Promise.all(
            batchIds.map((id) => repository.getItem(id)),
          )
          for (let index = 0; index < loadedItems.length; index++) {
            const item = loadedItems[index]
            if (item?.kind === 'text' && item.text) textById.set(item.id, item.text)
            else unreadableTextIdsRef.current.add(batchIds[index])
          }
        }
        if (cancelled) return
        if (textById.size > 0) {
          setItems((current) => current.map((item) => {
            const text = textById.get(item.id)
            return item.kind === 'text' && text !== undefined ? { ...item, text } : item
          }))
        }
        setFullTextSearchState('idle')
      })()
        .catch(() => {
          if (cancelled) return
          setFullTextSearchState('error')
          host.showMessage(t('error.loadFailed'), 'error')
        })
    }, 120)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [items, query, repository, host, t])

  useEffect(() => {
    return subscribeCachedIndex((index) => {
      applyListItems(index ? indexToListItems(index) : [])
    })
  }, [applyListItems])

  useEffect(() => {
    if (!settings.enabled) return
    // 初次挂载时刷新一次
    void repository.getFreshListItems()
      .then(applyListItems)
      .catch(() => {})
    // 窗口获焦时刷新，替代固定 1s 轮询
    const handleFocus = () => {
      void repository.getFreshListItems()
        .then(applyListItems)
        .catch(() => {})
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [repository, settings.enabled, applyListItems])

  useEffect(() => {
    if (loading || !settings.enabled) return
    const frame = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [loading, settings.enabled, combining])

  // Flush pending soft-delete on unmount
  useEffect(() => {
    return () => {
      if (pendingDeleteRef.current) {
        clearTimeout(pendingDeleteRef.current.timerId)
        host.dismissToast(pendingDeleteRef.current.toastId)
        void repository.deleteItem(pendingDeleteRef.current.id)
        pendingDeleteRef.current = null
      }
    }
  }, [repository])

  const filteredItems = useMemo(() => {
    let result = combining ? items.filter((item) => item.kind === 'text') : items
    if (combining) {
      // Combining always shows text, while preserving the ordinary browser's filter.
    } else if (filter === 'frequent') {
      result = result
        .filter((item) => (item.pasteCount ?? 0) >= frequentThreshold)
        .slice()
        .sort((a, b) => {
          const recentDiff = (b.lastPastedAt ?? 0) - (a.lastPastedAt ?? 0)
          if (recentDiff !== 0) return recentDiff
          return (b.pasteCount ?? 0) - (a.pasteCount ?? 0)
        })
    } else if (filter === 'favorite') {
      result = result
        .filter((item) => item.isFavorite)
        .slice()
        .sort((a, b) => (b.favoritedAt ?? 0) - (a.favoritedAt ?? 0))
    } else if (filter !== 'all') {
      result = result.filter((item) => item.kind === filter)
    }
    if (query.trim()) {
      result = result.filter((item) => matchesClipboardHistorySearch(item, query))
    }
    return result
  }, [items, filter, query, frequentThreshold, combining])

  useEffect(() => {
    setSelectedId((current) => {
      if (filteredItems.length === 0) return null
      if (current && filteredItems.some((item) => item.id === current)) return current
      return filteredItems[0].id
    })
  }, [filteredItems])

  const selectedItem = useMemo(
    () => filteredItems.find((i) => i.id === selectedId) ?? null,
    [filteredItems, selectedId]
  )

  const shortcutHints = getClipboardHistoryShortcuts({
    hasSelection: Boolean(selectedItem),
    loading,
    enabled: settings.enabled,
    blocked: combining || Boolean(titleDialog),
    focus: shortcutFocus,
  })

  const [selectedFullItem, setSelectedFullItem] = useState<ClipboardHistoryItem | null>(null)
  // A selection change renders before the previous read's effect is cleaned up.
  const matchingFullItem = selectedFullItem?.id === selectedItem?.id && selectedFullItem?.hash === selectedItem?.hash
    ? selectedFullItem : null
  const previewItem = selectedItem?.kind === 'text' && selectedItem.text
    ? selectedItem : matchingFullItem ?? selectedItem

  useEffect(() => {
    if (!selectedId) {
      setSelectedFullItem(null)
      return
    }
    let cancelled = false
    setSelectedFullItem(null)
    void repository.getItem(selectedId).then((item) => {
      if (!cancelled && item) {
        setSelectedFullItem(item)
        setItems((current) => current.map((entry) => entry.id === item.id ? item : entry))
      }
    }).catch(() => { /* The current row can still be retried by its explicit action. */ })
    return () => { cancelled = true }
  }, [selectedId, repository])

  const groupedItems = useMemo(() => {
    // Frequent / favorite use their own sort; do not re-bucket by day.
    if (!combining && (filter === 'frequent' || filter === 'favorite')) {
      return [{ label: '', items: filteredItems }]
    }
    return groupItemsByDay(filteredItems, locale, t)
  }, [filteredItems, filter, locale, t, combining])

  type VirtualRow =
    | { type: 'group-header'; label: string }
    | { type: 'item'; item: ClipboardHistoryItem }

  const flatRows = useMemo<VirtualRow[]>(() => {
    const rows: VirtualRow[] = []
    for (const group of groupedItems) {
      if (group.label) {
        rows.push({ type: 'group-header', label: group.label })
      }
      for (const item of group.items) {
        rows.push({ type: 'item', item })
      }
    }
    return rows
  }, [groupedItems])

  const listRef = useRef<HTMLDivElement>(null)

  const resetBrowser = useCallback(() => {
    setQuery('')
    setFilter('all')
    setSelectedId(items[0]?.id ?? null)
    if (listRef.current) listRef.current.scrollTop = 0
    window.getSelection()?.removeAllRanges()
  }, [items])

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => flatRows[index].type === 'group-header' ? 28 : 44,
    overscan: 8,
  })

  const handlePaste = useCallback(async (item: ClipboardHistoryItem) => {
    if (combining) return
    const generation = ++pasteNoticeGenerationRef.current
    setPasteNotice(null)
    try {
      // For list items from index, load full item for paste
      let fullItem = item
      if ((item.kind === 'text' && !item.text) || (item.kind === 'image' && !item.blobId) || (item.kind === 'files' && item.paths.length === 0)) {
        const loaded = await repository.getItem(item.id)
        if (!loaded) {
          if (generation === pasteNoticeGenerationRef.current) setPasteNotice(t('error.pasteFailed'))
          return
        }
        fullItem = loaded
      }
      if (generation !== pasteNoticeGenerationRef.current) return

      let result
      if (fullItem.kind === 'text') {
        result = await host.paste.pasteText(fullItem.text)
      } else if (fullItem.kind === 'image') {
        result = await host.paste.pasteImage(fullItem.blobId)
      } else if (fullItem.kind === 'files') {
        result = await host.paste.pasteFiles(fullItem.paths)
      }
      if (generation !== pasteNoticeGenerationRef.current) return
      if (!result?.ok) {
        if (result && !result.message) return
        setPasteNotice(result?.message ?? t('error.pasteFailed'))
        return
      }
      // Persist paste count for Frequent tab (window closes; next open reads storage/cache).
      void repository.recordPaste(fullItem.id).catch(() => {})
      resetBrowser()
      host.complete()
    } catch {
      if (generation === pasteNoticeGenerationRef.current) setPasteNotice(t('error.pasteFailed'))
    }
  }, [host, t, repository, resetBrowser, combining])

  const resolveFullItem = useCallback(async (item: ClipboardHistoryItem) => {
    if ((item.kind === 'text' && !item.text) || (item.kind === 'image' && !item.blobId) || (item.kind === 'files' && item.paths.length === 0)) {
      return repository.getItem(item.id)
    }
    return item
  }, [repository])

  const handleCopy = useCallback(async (item: ClipboardHistoryItem) => {
    pasteNoticeGenerationRef.current += 1
    setPasteNotice(null)
    try {
      const fullItem = await resolveFullItem(item)
      if (!fullItem) {
        host.showMessage(t('error.copyFailed'), 'error')
        return
      }
      if (fullItem.kind === 'text') {
        await host.clipboard.writeText(fullItem.text)
      } else if (fullItem.kind === 'image') {
        await host.clipboard.writeImage(fullItem.blobId)
      } else {
        await host.clipboard.writeFiles(fullItem.paths)
      }
      host.showMessage(t('message.copied'), 'success')
      resetBrowser()
      host.complete()
    } catch {
      host.showMessage(t('error.copyFailed'), 'error')
    }
  }, [host, resetBrowser, resolveFullItem, t])

  const applyItemUpdate = useCallback((updated: ClipboardHistoryItem) => {
    setItems((current) =>
      current.map((entry) => {
        if (entry.id !== updated.id) return entry
        // Keep list-friendly payloads (preview / empty text) when full item is loaded.
        if (entry.kind === 'text' && updated.kind === 'text') {
          return {
            ...updated,
            text: updated.text || entry.text,
            preview: updated.preview || entry.preview,
          }
        }
        if (entry.kind === 'image' && updated.kind === 'image') {
          return {
            ...updated,
            blobId: updated.blobId || entry.blobId,
            previewBlobId: updated.previewBlobId || entry.previewBlobId,
          }
        }
        if (entry.kind === 'files' && updated.kind === 'files') {
          return {
            ...updated,
            paths: updated.paths.length > 0 ? updated.paths : entry.paths,
            fileNames: updated.fileNames.length > 0 ? updated.fileNames : entry.fileNames,
          }
        }
        return updated
      }),
    )
    setSelectedFullItem((current) => (current?.id === updated.id ? updated : current))
  }, [])

  const openFavoriteTitleDialog = useCallback((item: ClipboardHistoryItem, mode: 'create' | 'edit') => {
    const fallback =
      item.favoriteTitle
      || (item.kind === 'text' ? item.preview : item.kind === 'files' ? item.fileNames.join(', ') : '')
    setTitleDialog({ id: item.id, draft: mode === 'edit' ? (item.favoriteTitle ?? '') : fallback.slice(0, 80), mode })
  }, [])

  const handleFavoriteClick = useCallback((item: ClipboardHistoryItem) => {
    if (item.isFavorite) {
      void repository.setFavorite(item.id, false)
        .then((updated) => {
          if (updated) applyItemUpdate(updated)
        })
        .catch(() => host.showMessage(t('error.favoriteFailed'), 'error'))
      return
    }
    openFavoriteTitleDialog(item, 'create')
  }, [repository, applyItemUpdate, openFavoriteTitleDialog, host, t])

  const confirmFavoriteTitleDialog = useCallback(() => {
    if (!titleDialog) return
    const { id, draft, mode } = titleDialog
    setTitleDialog(null)
    const action =
      mode === 'create'
        ? repository.setFavorite(id, true, draft)
        : repository.updateFavoriteTitle(id, draft)
    void action
      .then((updated) => {
        if (updated) applyItemUpdate(updated)
      })
      .catch(() => host.showMessage(t('error.favoriteFailed'), 'error'))
  }, [titleDialog, repository, applyItemUpdate, host, t])

  const handleDelete = useCallback((id: string) => {
    // Cancel any previous pending delete
    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timerId)
      host.dismissToast(pendingDeleteRef.current.toastId)
      // Commit previous pending delete immediately
      const prevId = pendingDeleteRef.current.id
      void repository.deleteItem(prevId)
      pendingDeleteRef.current = null
    }

    // Capture item and its position for undo
    const itemIndex = items.findIndex((i) => i.id === id)
    if (itemIndex === -1) return
    const removedItem = items[itemIndex]

    // Optimistically remove from displayed list
    const newItems = items.filter((i) => i.id !== id)
    setItems(newItems)

    // Move selection to next item (or previous if last)
    setSelectedId((current) => {
      if (current !== id) return current
      if (newItems.length === 0) return null
      // Prefer the item that was below the deleted one
      return newItems[Math.min(itemIndex, newItems.length - 1)]?.id ?? null
    })

    // Show undo toast
    const toastMessage = `${t('message.deleted.toast')} \u00b7 `
    const toastId = host.showToast(toastMessage, 'info', {
      duration: 5000,
      action: {
        label: t('message.undo'),
        onClick: () => {
          // Restore item at original position
          if (pendingDeleteRef.current?.id === id) {
            clearTimeout(pendingDeleteRef.current.timerId)
            pendingDeleteRef.current = null
          }
          setItems((current) => {
            const restored = [...current]
            const insertAt = Math.min(itemIndex, restored.length)
            restored.splice(insertAt, 0, removedItem)
            return restored
          })
          setSelectedId(id)
        },
      },
    })

    // Schedule actual deletion after 5 seconds
    const timerId = setTimeout(() => {
      if (pendingDeleteRef.current?.id === id) {
        pendingDeleteRef.current = null
      }
      void repository.deleteItem(id)
    }, 5000)

    pendingDeleteRef.current = { timerId, id, toastId }
  }, [items, repository, t])

  const itemContextMenuItems = useCallback((item: ClipboardHistoryItem): MenuItemSpec[] => [
    { key: 'paste', label: t('action.paste'), onSelect: () => void handlePaste(item) },
    { key: 'copy', label: t('action.copy'), onSelect: () => void handleCopy(item) },
    { key: 'delete', label: t('action.delete'), danger: true, onSelect: () => handleDelete(item.id) },
  ], [handlePaste, handleCopy, handleDelete, t])

  const handleReturnToLauncher = useCallback(async (item: ClipboardHistoryItem) => {
    pasteNoticeGenerationRef.current += 1
    setPasteNotice(null)
    try {
      let fullItem = item
      if ((item.kind === 'text' && !item.text) || (item.kind === 'image' && !item.blobId) || (item.kind === 'files' && item.paths.length === 0)) {
        const loaded = await repository.getItem(item.id)
        if (!loaded) {
          host.showToast(t('error.loadFailed'), 'error')
          return
        }
        fullItem = loaded
      }

      const ageMs = Date.now() - fullItem.lastCopiedAt
      const ageLabel =
        ageMs < 1000 ? undefined
          : ageMs < 60_000 ? `${Math.floor(ageMs / 1000)}s`
            : ageMs < 3_600_000 ? `${Math.floor(ageMs / 60_000)}m`
              : undefined

      if (fullItem.kind === 'text') {
        if (!fullItem.text) {
          host.showToast(t('error.returnFailed'), 'error')
          return
        }
        host.returnToLauncherWithObject({ kind: 'text', text: fullItem.text, ageLabel })
        return
      }
      if (fullItem.kind === 'image') {
        if (!fullItem.blobId) {
          host.showToast(t('error.returnFailed'), 'error')
          return
        }
        host.returnToLauncherWithObject({
          kind: 'image',
          blobId: fullItem.blobId,
          contentType: fullItem.contentType,
          width: fullItem.width,
          height: fullItem.height,
          ageLabel,
        })
        return
      }
      if (fullItem.kind === 'files') {
        if (!fullItem.paths?.length) {
          host.showToast(t('error.returnFailed'), 'error')
          return
        }
        host.returnToLauncherWithObject({
          kind: 'files',
          paths: fullItem.paths,
          fileNames: fullItem.fileNames,
          ageLabel,
        })
      }
    } catch {
      host.showToast(t('error.returnFailed'), 'error')
    }
  }, [host, repository, t])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.defaultPrevented || titleDialog) return
    if (combining) {
      if (imeKeyDown.shouldIgnoreKeyDown(e)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelMerge()
        return
      }
      // Focused controls retain native keyboard activation. Enter in search/the list
      // selects a text item; it never invokes the ordinary paste shortcut.
      if (e.target instanceof HTMLElement && e.target.closest('button, .clipboard-history-merge-panel')) return
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        if (selectedItem && !e.metaKey && !e.ctrlKey && !e.altKey) toggleMergeItem(selectedItem)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') return
    }
    const focus = readClipboardHistoryShortcutFocus(e.currentTarget as HTMLElement, e.target instanceof Element ? e.target : null, document.activeElement)
    if (focus.nativeButton) return
    if (!selectedItem) return
    const shortcuts = getClipboardHistoryShortcuts({
      hasSelection: true,
      loading,
      enabled: settings.enabled,
      blocked: combining || Boolean(titleDialog),
      focus,
    })
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      if (!shortcuts.returnToLauncher) return
      if (imeKeyDown.shouldIgnoreKeyDown(e)) return
      e.preventDefault()
      void handleReturnToLauncher(selectedItem)
    } else if (e.key === 'Enter') {
      if (!shortcuts.paste) return
      if (imeKeyDown.shouldIgnoreKeyDown(e)) return
      e.preventDefault()
      void handlePaste(selectedItem)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!shortcuts.delete) return
      e.preventDefault()
      handleDelete(selectedItem.id)
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      const selectedText = readDomSelectedText()
      e.preventDefault()
      if (selectedText) {
        void host.clipboard.writeText(selectedText)
          .then(() => host.showMessage(t('message.copied'), 'success'))
          .catch(() => host.showMessage(t('error.copyFailed'), 'error'))
        return
      }
      void handleCopy(selectedItem)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const idx = filteredItems.findIndex((i) => i.id === selectedId)
      if (idx < filteredItems.length - 1) {
        const nextId = filteredItems[idx + 1].id
        setSelectedId(nextId)
        const flatIndex = flatRows.findIndex((r) => r.type === 'item' && r.item.id === nextId)
        if (flatIndex >= 0) virtualizer.scrollToIndex(flatIndex, { align: 'auto' })
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const idx = filteredItems.findIndex((i) => i.id === selectedId)
      if (idx > 0) {
        const prevId = filteredItems[idx - 1].id
        setSelectedId(prevId)
        const flatIndex = flatRows.findIndex((r) => r.type === 'item' && r.item.id === prevId)
        if (flatIndex >= 0) virtualizer.scrollToIndex(flatIndex, { align: 'auto' })
      }
    }
  }, [selectedItem, selectedId, filteredItems, flatRows, virtualizer, handlePaste, handleReturnToLauncher, handleDelete, handleCopy, host, t, imeKeyDown, combining, cancelMerge, toggleMergeItem, titleDialog, loading, settings.enabled])

  const renderContent = () => {
    if (loading) {
      return (
        <div className="clipboard-history-main">
          <div className="clipboard-history-list-pane">
            <div className="clipboard-history-list-toolbar">
              <div className="clipboard-history-skeleton-bar clipboard-history-skeleton-filter" />
            </div>
            <div className="clipboard-history-list" style={{ overflow: 'hidden', flex: 1 }}>
              {Array.from({ length: 7 }, (_, i) => (
                <div key={i} className="clipboard-history-skeleton-item" style={{ animationDelay: `${i * 80}ms` }} />
              ))}
            </div>
          </div>
          <div className="clipboard-history-skeleton-preview">
            <div className="clipboard-history-skeleton-bar clipboard-history-skeleton-preview-title" />
            <div className="clipboard-history-skeleton-bar clipboard-history-skeleton-preview-body" />
          </div>
        </div>
      )
    }

    if (!settings.enabled) {
      return (
        <div className="clipboard-history-state">
          <span>{t('state.disabled')}</span>
          <ToolbarButton type="button" onClick={() => host.openSettings({ preserveSurface: true })}>
            {t('action.openSettings')}
          </ToolbarButton>
        </div>
      )
    }

    return (
      <>
        <div className="clipboard-history-main">
          <div className="clipboard-history-list-pane">
            <div className="clipboard-history-list-toolbar">
              {combining ? (
                <div className="clipboard-history-merge-instruction">
                  <strong>{t('merge.chooseText')}</strong>
                  <span>{t('merge.instruction', { min: CLIPBOARD_TEXT_MERGE_MIN_ITEMS, max: CLIPBOARD_TEXT_MERGE_MAX_ITEMS })}</span>
                </div>
              ) : <SegmentedControl
                className="clipboard-history-filter"
                value={filter}
                onChange={(value) => setFilter(value as FilterKind)}
                disabled={loading || !settings.enabled}
                aria-label={t('filter.label')}
                options={[
                  { value: 'all', label: t('filter.all') },
                  { value: 'favorite', label: t('filter.favorite') },
                  { value: 'frequent', label: t('filter.frequent') },
                  { value: 'text', label: t('filter.text') },
                  { value: 'image', label: t('filter.image') },
                  { value: 'files', label: t('filter.files') },
                ]}
              />}
            </div>
            <div ref={listRef} className="clipboard-history-list" data-launcher-scrollable aria-busy={fullTextSearchState === 'loading'} style={{ overflow: 'auto', flex: 1 }}>
              <SurfaceList aria-label={t('surface.main.title')} data-launcher-scrollable>
                {filteredItems.length === 0 ? (
                  <SurfaceEmptyState>
                    {fullTextSearchState === 'loading'
                      ? t('state.loading')
                      : fullTextSearchState === 'error'
                        ? t('error.loadFailed')
                      : filter === 'frequent'
                      ? t('state.emptyFrequent')
                      : filter === 'favorite'
                        ? t('state.emptyFavorite')
                        : t('state.empty')}
                  </SurfaceEmptyState>
                ) : (
                  <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const row = flatRows[virtualRow.index]
                      if (row.type === 'group-header') {
                        return (
                          <div
                            key={`group:${row.label}`}
                            className="clipboard-history-group-title"
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: `${virtualRow.size}px`,
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                          >
                            {row.label}
                          </div>
                        )
                      }
                      return (
                        <div
                          key={row.item.id}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: `${virtualRow.size}px`,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <ClipboardHistoryItemRow
                            item={row.item}
                            query={query}
                            selected={row.item.id === selectedId}
                            locale={locale}
                            t={t}
                            storage={host.storage}
                            onSelect={setSelectedId}
                            onPaste={handlePaste}
                            onDelete={handleDelete}
                            onFavorite={handleFavoriteClick}
                            menuItems={combining ? [] : itemContextMenuItems(row.item)}
                            combining={combining}
                            mergePosition={mergeIds.indexOf(row.item.id)}
                            mergeLimitReached={mergeIds.length >= CLIPBOARD_TEXT_MERGE_MAX_ITEMS}
                            onToggleMerge={toggleMergeItem}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </SurfaceList>
            </div>
          </div>

          {combining ? (
            <ClipboardTextMergePanel
              ids={mergeIds}
              items={mergeItemsRef.current}
              separator={mergeSeparator}
              preview={mergePreview}
              error={mergeError}
              loading={mergeLoading}
              t={t}
              onMove={moveMergeItem}
              onRemove={removeMergeItem}
              onSeparatorChange={changeMergeSeparator}
              onRetry={() => {
                invalidateMerge()
                setMergeRetry((current) => current + 1)
              }}
            />
          ) : <ContextMenu
            disabled={!selectedItem}
            items={previewItem ? itemContextMenuItems(previewItem) : []}
            trigger={
              <SurfacePreview className="clipboard-history-preview" data-launcher-scrollable>
                {!previewItem ? (
                  <SurfaceEmptyState>
                    {t('preview.empty')}
                  </SurfaceEmptyState>
                ) : (
                  <>
                    <ClipboardHistoryPreviewContent item={previewItem} query={query} t={t} storage={host.storage} />
                    {previewItem.isFavorite && (
                      <div className="clipboard-history-favorite-title-bar">
                        <span className="clipboard-history-favorite-title-label">
                          {previewItem.favoriteTitle || t('favorite.untitled')}
                        </span>
                        <ToolbarButton
                          type="button"
                          onClick={() => openFavoriteTitleDialog(previewItem, 'edit')}
                        >
                          {t('action.editFavoriteTitle')}
                        </ToolbarButton>
                      </div>
                    )}
                    <ClipboardHistoryMetadata key={previewItem.id} item={previewItem} locale={locale} t={t} />
                  </>
                )}
              </SurfacePreview>
            }
          />}
        </div>

        {!combining && <SurfaceFooterHints className="clipboard-history-footer">
          {pasteNotice ? <span role="status" style={{ color: 'var(--text-1, var(--hiven-color-text-primary))' }}>{pasteNotice}</span> : <>
            {shortcutHints.paste && <span>↵ {t('hint.paste')}</span>}
            {shortcutHints.returnToLauncher && <span>{typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}↵ {t('hint.returnToLauncher')}</span>}
            {shortcutHints.delete && <span>⌫ {t('hint.delete')}</span>}
          </>}
        </SurfaceFooterHints>}
      </>
    )
  }

  useEffect(() => {
    if (!titleDialog) return
    const frame = requestAnimationFrame(() => titleInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [titleDialog])

  const surfaceContent = (
    <div
      ref={containerRef}
      className={`clipboard-history-surface${combining ? ' is-combining' : ''}`}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="clipboard-history-topbar">
        {!combining && <IconButton
          type="button"
          label={t('action.back')}
          onClick={() => {
            setQuery('')
            host.requestBack()
          }}
        >
          <BackIcon size={18} />
        </IconButton>}
        <SearchField
          ref={searchRef}
          data-plugin-surface-autofocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onCompositionStart={imeKeyDown.onCompositionStart}
          onCompositionEnd={imeKeyDown.onCompositionEnd}
          placeholder={t('search.placeholder')}
          disabled={loading || !settings.enabled}
        />
        {!combining && settings.enabled && !loading && (
          <Button type="button" onClick={startMerge}>
            {t('merge.start')}
          </Button>
        )}
        {!combining && <Button
          type="button"
          variant="primary"
          disabled={!selectedItem || loading || !settings.enabled}
          onClick={() => selectedItem && void handlePaste(selectedItem)}
        >
          {t('action.paste')}
        </Button>}
        {!combining && <IconButton
          type="button"
          label={t('action.openSettings')}
          onClick={() => host.openSettings({ preserveSurface: true })}
        >
          <SettingsIcon size={17} />
        </IconButton>}
        {!combining && <IconButton
          type="button"
          label={t('action.close')}
          onClick={() => {
            mergeReader.invalidate()
            setQuery('')
            host.close()
          }}
        >
          <CloseIcon size={18} />
        </IconButton>}
      </div>

      {renderContent()}

      {combining && (
        <SurfaceFooterHints className="clipboard-history-footer clipboard-history-merge-footer">
          <div className="clipboard-history-merge-footer-hints">
            <span>↵ {t('merge.toggleSelection')}</span>
            <span>Esc {t('merge.cancel')}</span>
          </div>
          <div className="clipboard-history-merge-footer-actions">
            <Button type="button" onClick={cancelMerge}>{t('merge.cancel')}</Button>
            <Button
              type="button"
              variant="primary"
              disabled={!mergePreview || mergeLoading || mergeSuspended || !settings.enabled}
              onClick={continueMerge}
            >
              {t('merge.continue')}
            </Button>
          </div>
        </SurfaceFooterHints>
      )}

      <Dialog
        open={Boolean(titleDialog)}
        onOpenChange={(open) => { if (!open) setTitleDialog(null) }}
        title={t('favorite.titleDialog')}
      >
        {titleDialog && (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !imeKeyDown.shouldIgnoreKeyDown(event as unknown as KeyboardEvent)) {
                event.preventDefault()
                confirmFavoriteTitleDialog()
              }
            }}
          >
            <input
              ref={titleInputRef}
              className="clipboard-history-title-dialog-input"
              value={titleDialog.draft}
              onChange={(event) => setTitleDialog({ ...titleDialog, draft: event.target.value })}
              onCompositionStart={imeKeyDown.onCompositionStart}
              onCompositionEnd={imeKeyDown.onCompositionEnd}
              placeholder={t('favorite.titlePlaceholder')}
              maxLength={80}
            />
            <div className="clipboard-history-title-dialog-actions">
              <ToolbarButton type="button" onClick={confirmFavoriteTitleDialog}>
                {titleDialog.mode === 'create' ? t('action.confirmFavorite') : t('action.saveFavoriteTitle')}
              </ToolbarButton>
              <ToolbarButton type="button" onClick={() => setTitleDialog(null)}>
                {t('action.cancel')}
              </ToolbarButton>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )

  // A real modal owns focus and Escape through the shared surface contract in
  // both Launcher and independent windows. The history underneath is unchanged.
  return combining ? (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) cancelMerge() }}
      title={t('merge.dialogTitle')}
      className="clipboard-history-merge-dialog"
    >
      {surfaceContent}
    </Dialog>
  ) : surfaceContent
}

const ClipboardHistoryItemRow = memo(function ClipboardHistoryItemRow({
  item,
  query,
  selected,
  locale,
  t,
  storage,
  onSelect,
  onPaste,
  onDelete,
  onFavorite,
  menuItems,
  combining,
  mergePosition,
  mergeLimitReached,
  onToggleMerge,
}: {
  item: ClipboardHistoryItem
  query: string
  selected: boolean
  locale: string
  t: (key: string) => string
  storage: SurfaceStorage
  onSelect: (id: string) => void
  onPaste: (item: ClipboardHistoryItem) => Promise<void>
  onDelete: (id: string) => void
  onFavorite: (item: ClipboardHistoryItem) => void
  menuItems: MenuItemSpec[]
  combining: boolean
  mergePosition: number
  mergeLimitReached: boolean
  onToggleMerge: (item: ClipboardHistoryItem) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])

  const pasteCount = item.pasteCount ?? 0
  const matchSnippet = useMemo(
    () => item.kind === 'text' ? getClipboardHistoryMatchSnippet(item.text || item.preview, query) : null,
    [item, query],
  )
  const hasCustomTitle = Boolean(item.favoriteTitle?.trim())
  const title = !hasCustomTitle && matchSnippet ? matchSnippet : getItemTitle(item, t)

  return (
    <ContextMenu
      disabled={combining}
      items={menuItems}
      trigger={
        <div
          ref={ref}
          className={`clipboard-history-item-row${selected ? ' is-selected' : ''}${item.isFavorite ? ' is-favorite' : ''}${combining ? ' is-merge-option' : ''}${mergePosition >= 0 ? ' is-merge-selected' : ''}`}
        >
          <SurfaceListItem
            type="button"
            selected={selected}
            className="clipboard-history-item"
            aria-pressed={combining ? mergePosition >= 0 : undefined}
            aria-disabled={combining && mergeLimitReached && mergePosition < 0 ? true : undefined}
            onClick={(event) => {
              onSelect(item.id)
              if (combining && event.detail < 2) onToggleMerge(item)
            }}
            onDoubleClick={() => { if (!combining) void onPaste(item) }}
          >
            {combining ? (
              <span className="clipboard-history-merge-check" aria-hidden="true">
                {mergePosition >= 0 ? mergePosition + 1 : ''}
              </span>
            ) : renderItemMedia(item, storage)}
            <span className="clipboard-history-item-text">
              <span className="clipboard-history-item-title"><ClipboardHistoryHighlightedText text={title} query={query} /></span>
              <span className="clipboard-history-item-subtitle">
                {hasCustomTitle && matchSnippet ? <>
                  <ClipboardHistoryHighlightedText text={matchSnippet} query={query} />
                  {` · ${getContentTypeLabel(item, t)} · ${formatBytes(item.byteSize)} · ${formatDateTime(item.lastCopiedAt, locale)}`}
                </> : getItemSubtitle(item, locale, t)}
                {pasteCount > 0 ? ` · ×${pasteCount}` : ''}
              </span>
            </span>
          </SurfaceListItem>
          {!combining && <>
          <IconButton
            type="button"
            label={item.isFavorite ? t('action.unfavorite') : t('action.favorite')}
            className={`clipboard-history-item-favorite${item.isFavorite ? ' is-active' : ''}`}
            onClick={() => onFavorite(item)}
          >
            <StarIcon size={14} fill={item.isFavorite ? 'currentColor' : 'none'} />
          </IconButton>
          <IconButton
            type="button"
            label={t('action.delete')}
            className="clipboard-history-item-delete"
            onClick={() => onDelete(item.id)}
          >
            <CloseIcon size={14} />
          </IconButton>
          </>}
        </div>
      }
    />
  )
})

function ClipboardImageThumbnail({ item, storage }: { item: ImageHistoryItem, storage: SurfaceStorage }) {
  const [imageUrl, setImageUrl] = useState('')

  useEffect(() => {
    let disposed = false
    void storage.blob.url(item.previewBlobId).then((url) => {
      if (!disposed) setImageUrl(url)
    })
    return () => {
      disposed = true
      setImageUrl('')
    }
  }, [item.previewBlobId, storage])

  if (!imageUrl) {
    return (
      <span className="clipboard-history-item-icon" aria-hidden="true">
        <ImageIcon size={20} />
      </span>
    )
  }

  return (
    <span className="clipboard-history-item-thumb" aria-hidden="true">
      <img src={imageUrl} alt="" />
    </span>
  )
}

function renderItemMedia(item: ClipboardHistoryItem, storage: SurfaceStorage) {
  if (item.kind === 'image') return <ClipboardImageThumbnail item={item} storage={storage} />
  return (
    <span className="clipboard-history-item-icon" aria-hidden="true">
      {renderItemIcon(item)}
    </span>
  )
}

function renderItemIcon(item: ClipboardHistoryItem) {
  if (item.kind === 'text') return <FileTextIcon size={20} />
  if (item.kind === 'image') return <ImageIcon size={20} />
  return <ClipboardIcon size={20} />
}

function ClipboardImagePreview({ item, storage, t }: { item: ImageHistoryItem, storage: SurfaceStorage, t: (key: string) => string }) {
  const [imageUrl, setImageUrl] = useState('')

  useEffect(() => {
    let disposed = false
    void storage.blob.url(item.previewBlobId).then((url) => {
      if (!disposed) setImageUrl(url)
    })
    return () => {
      disposed = true
      setImageUrl('')
    }
  }, [item.previewBlobId, storage])

  if (!imageUrl) {
    return (
      <div className="clipboard-history-preview-asset is-empty">
        <ImageIcon size={36} />
        <span>{getItemTitle(item, t)}</span>
      </div>
    )
  }

  return (
    <figure className="clipboard-history-preview-image">
      <img src={imageUrl} alt={getItemTitle(item, t)} />
      <figcaption>{getItemTitle(item, t)}</figcaption>
    </figure>
  )
}

function ClipboardHistoryHighlightedText({ text, query }: { text: string, query: string }) {
  const { segments } = useMemo(() => getClipboardHistoryMatchContext(text, query), [text, query])
  return <>{segments.map((segment) => segment.match
    ? <mark key={segment.start} className="clipboard-history-search-match">{segment.text}</mark>
    : segment.text)}</>
}

function ClipboardHistoryPreviewContent({ item, query, t, storage }: {
  item: ClipboardHistoryItem
  query: string
  t: (key: string) => string
  storage: SurfaceStorage
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const alignedRef = useRef<{ id: string, query: string, fullText: boolean } | null>(null)
  const normalizedQuery = query.trim().toLowerCase()
  const fullText = item.kind === 'text' && Boolean(item.text)

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    const previous = alignedRef.current
    const sameSearch = previous?.id === item.id && previous.query === normalizedQuery
    // Loading the full record gets one alignment. Re-reads and background index
    // refreshes must not move a reader who has since scrolled through the text.
    if (sameSearch && (previous.fullText || !fullText)) return
    alignedRef.current = { id: item.id, query: normalizedQuery, fullText }
    const firstMatch = content.querySelector<HTMLElement>('.clipboard-history-search-match')
    if (firstMatch) {
      const matchTop = firstMatch.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop
      content.scrollTop = Math.max(0, matchTop - Math.max(16, content.clientHeight * 0.3))
    } else if (!sameSearch) {
      content.scrollTop = 0
    }
  }, [item.id, normalizedQuery, fullText])

  return (
    <div ref={contentRef} className="clipboard-history-preview-content" data-launcher-scrollable>
      {renderPreview(item, t, storage, query)}
    </div>
  )
}

function ClipboardHistoryMetadata({ item, locale, t }: {
  item: ClipboardHistoryItem
  locale: string
  t: (key: string) => string
}) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  return (
    <div className={`clipboard-history-meta${expanded ? ' is-expanded' : ''}`}>
      <button
        type="button"
        className="clipboard-history-meta-summary"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="clipboard-history-meta-summary-text">
          {`${getContentTypeLabel(item, t)} · ${formatBytes(item.byteSize)} · ${formatDateTime(item.lastCopiedAt, locale)}`}
        </span>
        <span className="clipboard-history-meta-toggle">{t(expanded ? 'meta.hideDetails' : 'meta.showDetails')}</span>
        <span className="clipboard-history-meta-chevron" aria-hidden="true">⌃</span>
      </button>
      <div id={detailsId} className="clipboard-history-meta-details" hidden={!expanded}>
        {getMetaRows(item, locale, t).map((row) => (
          <div key={row.label} className="clipboard-history-meta-row">
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

function renderPreview(item: ClipboardHistoryItem, t: (key: string) => string, storage: SurfaceStorage, query: string) {
  if (item.kind === 'text') {
    // Show preview text while full item is loading
    const displayText = item.text || item.preview
    return (
      <pre className="clipboard-history-preview-text">
        <ClipboardHistoryHighlightedText text={displayText} query={query} />
      </pre>
    )
  }
  if (item.kind === 'image') {
    return <ClipboardImagePreview item={item} storage={storage} t={t} />
  }
  if (item.paths.length === 0 && item.fileNames.length > 0) {
    // List item from index — show fileNames as fallback
    return (
      <div className="clipboard-history-preview-files">
        {item.fileNames.map((name, index) => (
          <div key={`${name}-${index}`} className="clipboard-history-preview-path">
            {name}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="clipboard-history-preview-files">
      {item.paths.map((path, index) => (
        <div key={`${path}-${index}`} className="clipboard-history-preview-path">
          {path}
        </div>
      ))}
    </div>
  )
}

function getItemTitle(item: ClipboardHistoryItem, t: (key: string) => string) {
  if (item.favoriteTitle?.trim()) return item.favoriteTitle.trim()
  if (item.kind === 'text') return item.preview || item.text
  if (item.kind === 'image') {
    const dimensions = item.width && item.height ? ` (${item.width}×${item.height})` : ''
    return `${t('filter.image')}${dimensions}`
  }
  return item.fileNames.join(', ')
}

function getItemSubtitle(item: ClipboardHistoryItem, locale: string, t: (key: string) => string) {
  const base = `${getContentTypeLabel(item, t)} · ${formatBytes(item.byteSize)} · ${formatDateTime(item.lastCopiedAt, locale)}`
  if (item.favoriteTitle?.trim() && item.kind === 'text' && item.preview) {
    return `${item.preview} · ${base}`
  }
  return base
}

function getMetaRows(item: ClipboardHistoryItem, locale: string, t: (key: string) => string): MetaRow[] {
  const rows: MetaRow[] = [
    { label: t('meta.contentType'), value: getContentTypeLabel(item, t) },
    { label: t('meta.byteSize'), value: formatBytes(item.byteSize) },
    { label: t('meta.firstCopied'), value: formatDateTime(item.firstCopiedAt, locale) },
    { label: t('meta.lastCopied'), value: formatDateTime(item.lastCopiedAt, locale) },
  ]
  if ((item.pasteCount ?? 0) > 0) {
    rows.push({ label: t('meta.timesPasted'), value: String(item.pasteCount) })
  }
  if (item.isFavorite) {
    rows.push({ label: t('meta.favorite'), value: item.favoriteTitle?.trim() || t('favorite.untitled') })
  }

  if (item.kind === 'text' && item.text) {
    rows.splice(1, 0, { label: t('meta.characters'), value: String(item.text.length) })
    rows.splice(2, 0, { label: t('meta.words'), value: String(countWords(item.text)) })
  }
  if (item.kind === 'image' && item.width && item.height) {
    rows.splice(1, 0, { label: t('meta.dimensions'), value: `${item.width}×${item.height}` })
  }
  if (item.kind === 'files') {
    rows.splice(1, 0, { label: t('meta.files'), value: String(item.paths.length) })
  }
  if (item.sourceApp) {
    rows.splice(rows.length - 2, 0, { label: t('meta.sourceApp'), value: item.sourceApp })
  }

  return rows
}

function getContentTypeLabel(item: ClipboardHistoryItem, t: (key: string) => string) {
  if (item.kind === 'text') return t('filter.text')
  if (item.kind === 'image') return item.contentType
  return t('filter.files')
}

function groupItemsByDay(items: ClipboardHistoryItem[], locale: string, t: (key: string) => string) {
  const groups: Array<{ label: string; items: ClipboardHistoryItem[] }> = []
  const dateFormat = new Intl.DateTimeFormat(resolveIntlLocale(locale), { month: 'short', day: 'numeric' })
  for (const item of items) {
    const label = formatGroupLabel(item.lastCopiedAt, dateFormat, t)
    const group = groups.find((entry) => entry.label === label)
    if (group) {
      group.items.push(item)
    } else {
      groups.push({ label, items: [item] })
    }
  }
  return groups
}

function formatGroupLabel(timestamp: number, dateFormat: Intl.DateTimeFormat, t: (key: string) => string) {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (isSameDay(date, today)) return t('group.today')
  if (isSameDay(date, yesterday)) return t('group.yesterday')
  return dateFormat.format(date)
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

function formatDateTime(timestamp: number, locale: string) {
  return new Intl.DateTimeFormat(resolveIntlLocale(locale), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function resolveIntlLocale(locale: string) {
  const intlLocales: Record<string, string> = {
    zh: 'zh-CN',
    en: 'en-US',
  }
  return intlLocales[locale] ?? 'en-US'
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Read non-empty text selection from inputs or the document (preview pane). */
function readDomSelectedText(): string {
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart
    const end = active.selectionEnd
    if (start != null && end != null && end > start) {
      return active.value.slice(start, end)
    }
    return ''
  }
  return window.getSelection()?.toString() ?? ''
}
