/**
 * Clipboard History Plugin — Main Surface
 *
 * Host-openable custom-view surface providing:
 * - Top bar: plugin-owned back, search, type filter, settings, close
 * - Left panel: grouped clipboard history list
 * - Right panel: preview and metadata for the selected item
 * - Keyboard shortcuts: Enter=paste, Cmd/Ctrl+C=copy selection in preview, Delete=remove
 */

import { useState, useEffect, useLayoutEffect, useCallback, useDeferredValue, useMemo, useRef, useId, memo, type CompositionEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { PluginSurfaceProps } from '@hiven/plugin'
import {
  Button,
  ContextMenu,
  Dialog,
  Menu,
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
import { ArrowDown, ArrowUp, Check, ListFilter } from 'lucide-react'
import { resolveClipboardHistoryRetentionMonths, type ClipboardHistorySettings } from '../settings/model'
import type { ClipboardHistoryItem } from '../storage/clipboardHistoryTypes'
import type { ClipboardHistorySearchMatchMode } from '../storage/clipboardHistorySearch'
import {
  getClipboardHistoryCopiedSince,
  getClipboardHistoryLocalDayKey,
  type ClipboardHistoryTimeRange,
} from '../storage/clipboardHistoryTimeRange'
import { subscribeCachedIndex } from '../storage/clipboardHistoryCache'
import { createClipboardHistoryRepository } from '../storage/clipboardHistoryRepository'
import { readMatchingHistoryPage } from './clipboardHistoryPageReader'
import {
  getClipboardHistorySearchDebounceMs,
  getClipboardHistorySearchPresentation,
  type ClipboardHistorySearchLoadState,
} from './clipboardHistorySearchPresentation'
import { createHistoryPointerIntent } from './historyPointerIntent'
import { createHistoryOpenSession, resetHistoryOpenSession } from './historyOpenSession'
import { createHistoryCopyLifecycle } from './historyCopyLifecycle'
import { createHistoryImageSaveLifecycle, saveClipboardHistoryImage } from './historyImageSave'
import {
  createHistoryQuickEditorLifecycle,
  openHistoryQuickEditorSnapshot,
  readHistoryQuickEditorSnapshot,
} from './historyQuickEditorOpen'
import {
  getClipboardHistoryMatchContext,
  getClipboardHistoryMatchNavigationIndex,
  getClipboardHistoryMatchSnippet,
} from './clipboardHistoryMatchContext'
import {
  getClipboardHistoryShortcuts,
  observeClipboardHistoryShortcutFocus,
  readClipboardHistoryShortcutFocus,
  type ClipboardHistoryShortcutFocus,
} from './clipboardHistoryShortcuts'

const HISTORY_PAGE_SIZE = 100
const LOAD_MORE_THRESHOLD_ROWS = 12

function appendNewItems(existing: ClipboardHistoryItem[], incoming: ClipboardHistoryItem[]): ClipboardHistoryItem[] {
  if (existing.length === 0) return incoming
  const seen = new Set(existing.map((item) => item.id))
  return [...existing, ...incoming.filter((item) => !seen.has(item.id))]
}

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

type AppliedHistorySearch = {
  key: string
  query: string
  matchMode: ClipboardHistorySearchMatchMode
  filter: FilterKind
}

type ClipboardHistoryMatchNavigator = {
  move: (direction: -1 | 1) => boolean
}

export function ClipboardHistorySurface(props: PluginSurfaceProps<ClipboardHistorySettings>) {
  const { host, locale, t, settings } = props

  const repository = useMemo(
    () => createClipboardHistoryRepository(host.storage),
    [host.storage]
  )

  const [items, setItems] = useState<ClipboardHistoryItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectionAnchor = useRef<string | null>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState('')
  // Telemetry: when this browsing session opened (mount or a genuine reopen); cleared once the first list lands.
  const openStartedAtRef = useRef<number | null>(performance.now())
  // IME: while composing, keep searching with the text from before composition started.
  const [composingFrom, setComposingFrom] = useState<string | null>(null)
  const [searchMatchMode, setSearchMatchMode] = useState<ClipboardHistorySearchMatchMode>('literal')
  const [pasteNotice, setPasteNotice] = useState<string | null>(null)
  const pasteNoticeGenerationRef = useRef(0)
  const [copyLifecycle] = useState(createHistoryCopyLifecycle)
  const [imageSaveLifecycle] = useState(createHistoryImageSaveLifecycle)
  const [quickEditorLifecycle] = useState(createHistoryQuickEditorLifecycle)
  const matchNavigatorRef = useRef<ClipboardHistoryMatchNavigator | null>(null)
  const [imageSaveBusy, setImageSaveBusy] = useState(false)
  const imageSaveMountedRef = useRef(true)
  const [filter, setFilter] = useState<FilterKind>(() => initialFilter(props.surfaceId))
  const [timeRange, setTimeRange] = useState<ClipboardHistoryTimeRange>('all')
  const [localDayAnchor, setLocalDayAnchor] = useState(() => Date.now())
  const copiedSince = useMemo(
    () => getClipboardHistoryCopiedSince(timeRange, localDayAnchor),
    [timeRange, localDayAnchor],
  )
  const [fullTextSearchState, setFullTextSearchState] = useState<ClipboardHistorySearchLoadState>('loading')
  const [appliedSearch, setAppliedSearch] = useState<AppliedHistorySearch | null>(null)
  const isApplePlatform = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const modifierLabel = isApplePlatform ? '⌥' : 'Alt+'
  const primaryModifierLabel = isApplePlatform ? '⌘' : 'Ctrl+'
  useLayoutEffect(() => {
    const unsubscribeOwner = host.deliveryFeedbackOwner?.subscribeInvalidation(copyLifecycle.cancel)
    const unsubscribeLeave = host.subscribeLeaveIntent?.(copyLifecycle.cancel)
    return () => {
      copyLifecycle.cancel()
      unsubscribeOwner?.()
      unsubscribeLeave?.()
    }
  }, [copyLifecycle, host.deliveryFeedbackOwner, host.subscribeLeaveIntent])
  useLayoutEffect(() => {
    imageSaveMountedRef.current = true
    return () => {
      imageSaveMountedRef.current = false
      imageSaveLifecycle.invalidate()
    }
  }, [imageSaveLifecycle])
  useLayoutEffect(() => {
    const invalidate = () => {
      quickEditorLifecycle.cancel()
    }
    const unsubscribeOwner = host.deliveryFeedbackOwner?.subscribeInvalidation(invalidate)
    const unsubscribeLeave = host.subscribeLeaveIntent?.(invalidate)
    return () => {
      quickEditorLifecycle.cancel()
      unsubscribeOwner?.()
      unsubscribeLeave?.()
    }
  }, [host.deliveryFeedbackOwner, host.subscribeLeaveIntent, quickEditorLifecycle])
  const [titleDialog, setTitleDialog] = useState<FavoriteTitleDialogState | null>(null)
  const [shortcutFocus, setShortcutFocus] = useState<ClipboardHistoryShortcutFocus>({
    withinSurface: false, nativeButton: false, editing: false,
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const [pointerIntent] = useState(createHistoryPointerIntent)
  const [pointerHover, setPointerHover] = useState(false)
  const suspendPointerHover = useCallback(() => { pointerIntent.suspend(); setPointerHover(false) }, [pointerIntent])
  useEffect(() => {
    window.addEventListener('focus', suspendPointerHover)
    window.addEventListener('blur', suspendPointerHover)
    window.addEventListener('pageshow', suspendPointerHover)
    document.addEventListener('visibilitychange', suspendPointerHover)
    return () => {
      window.removeEventListener('focus', suspendPointerHover)
      window.removeEventListener('blur', suspendPointerHover)
      window.removeEventListener('pageshow', suspendPointerHover)
      document.removeEventListener('visibilitychange', suspendPointerHover)
    }
  }, [suspendPointerHover])
  const searchRef = useRef<HTMLInputElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const imeKeyDown = useImeKeyboard()
  const [pendingDelete, setPendingDelete] = useState<{ id: string; undo: () => void } | null>(null)
  const pendingDeletesRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const frequentThreshold = settings.frequentPasteThreshold ?? 3
  useLayoutEffect(() => {
    pasteNoticeGenerationRef.current += 1
    setPasteNotice(null)
    return () => { pasteNoticeGenerationRef.current += 1 }
  }, [query, searchMatchMode, selectedId, selectedIds, filter, timeRange, host, settings.enabled])
  useEffect(() => {
    const surface = containerRef.current
    if (surface) return observeClipboardHistoryShortcutFocus(surface, setShortcutFocus)
  }, [])

  const [refreshEpoch, setRefreshEpoch] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  /** Pages already appended to the list; a refresh re-reads this many so scrolling is not lost. */
  const pagesLoadedRef = useRef(1)
  const loadMoreAbortRef = useRef<AbortController | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreFailed, setLoadMoreFailed] = useState(false)
  const [scannedCount, setScannedCount] = useState(0)
  const [retentionStatus, setRetentionStatus] = useState<{ legacyProtectedCount: number; trashCount: number; migrationComplete: boolean } | null>(null)
  const [legacyDialog, setLegacyDialog] = useState(false)
  const [retentionBusy, setRetentionBusy] = useState(false)
  // Deferred so typing stays responsive while the list re-reads.
  const desiredQuery = useDeferredValue(composingFrom ?? query).trim()
  const desiredFilter = filter
  const criteriaKey = JSON.stringify([
    desiredQuery, searchMatchMode, desiredFilter, frequentThreshold, copiedSince ?? null,
  ])
  const requestKey = JSON.stringify([criteriaKey])
  const searchPresentation = getClipboardHistorySearchPresentation({
    desiredKey: requestKey,
    appliedKey: appliedSearch?.key,
    loadState: fullTextSearchState,
  })
  const resultsActionBlocked = searchPresentation.actionsBlocked
  const resultsActionableRef = useRef(false)
  resultsActionableRef.current = !resultsActionBlocked
  const appliedQuery = appliedSearch?.query ?? ''
  const appliedSearchMatchMode = appliedSearch?.matchMode ?? 'literal'
  const appliedFilter = appliedSearch?.filter ?? desiredFilter
  const pageGeneration = useRef(0)
  const lastSettledCriteriaKeyRef = useRef<string | undefined>(undefined)
  const lastRequestedCriteriaKeyRef = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    copyLifecycle.cancel()
    quickEditorLifecycle.cancel()
  }, [requestKey, refreshEpoch, selectedId, selectedIds, copyLifecycle, quickEditorLifecycle])
  const refreshPage = useCallback(() => {
    setLoadMoreFailed(false)
    setFullTextSearchState('loading')
    setScannedCount(0)
    setRefreshEpoch((value) => value + 1)
  }, [])
  const clearPage = useCallback(() => {
    setSelectedIds([])
    selectionAnchor.current = null
    pageGeneration.current += 1
    pagesLoadedRef.current = 1
    setLoadMoreFailed(false)
    setFullTextSearchState('loading')
    setScannedCount(0)
    setRefreshEpoch((value) => value + 1)
  }, [])
  const syncLocalDay = useCallback(() => {
    const now = Date.now()
    if (getClipboardHistoryLocalDayKey(now) !== getClipboardHistoryLocalDayKey(localDayAnchor)) {
      setLocalDayAnchor(now)
      return true
    }
    return false
  }, [localDayAnchor])
  const resetPage = useCallback(() => {
    syncLocalDay()
    clearPage()
  }, [clearPage, syncLocalDay])
  const changeSearchQuery = useCallback((value: string) => {
    if (composingFrom === null && value.trim() !== desiredQuery) resetPage()
    setQuery(value)
  }, [composingFrom, desiredQuery, resetPage])
  const startSearchComposition = useCallback((event: CompositionEvent<HTMLInputElement>) => {
    imeKeyDown.onCompositionStart()
    setComposingFrom(event.currentTarget.value)
  }, [imeKeyDown])
  const endSearchComposition = useCallback((event: CompositionEvent<HTMLInputElement>) => {
    imeKeyDown.onCompositionEnd()
    const value = event.currentTarget.value
    setComposingFrom(null)
    if (value.trim() !== desiredQuery) resetPage()
    setQuery(value)
  }, [desiredQuery, imeKeyDown, resetPage])
  const toggleSearchMatchMode = useCallback(() => {
    resetPage()
    setSearchMatchMode((current) => current === 'literal' ? 'all-terms' : 'literal')
  }, [resetPage])
  const changeFilter = useCallback((value: string) => {
    const next = value as FilterKind
    resetPage()
    setFilter(next)
  }, [resetPage])
  const changeTimeRange = useCallback((value: string) => {
    resetPage()
    setTimeRange(value as ClipboardHistoryTimeRange)
  }, [filter, resetPage])
  useLayoutEffect(() => {
    const generation = ++pageGeneration.current
    suspendPointerHover()
    loadMoreAbortRef.current?.abort()
    loadMoreAbortRef.current = null
    setLoadingMore(false)
    const controller = new AbortController()
    const owner = host.deliveryFeedbackOwner
    const current = () => generation === pageGeneration.current && !controller.signal.aborted && owner?.isCurrent() !== false
    setFullTextSearchState('loading')
    setScannedCount(0)
    const requestedQuery = desiredQuery
    const requestedMatchMode = searchMatchMode
    const requestedFilter = desiredFilter
    const requestedKey = requestKey
    // A refresh re-reads every page already on screen; new criteria start from the first page.
    const depth = pagesLoadedRef.current
    const debounceMs = getClipboardHistorySearchDebounceMs(
      lastSettledCriteriaKeyRef.current,
      lastRequestedCriteriaKeyRef.current,
      criteriaKey,
    )
    lastRequestedCriteriaKeyRef.current = criteriaKey
    const timer = window.setTimeout(() => {
      const searchStartedAt = performance.now()
      void (async () => {
        let cursor: string | undefined
        let loaded: ClipboardHistoryItem[] = []
        let pages = 0
        let scanned = 0
        do {
          const page = await readMatchingHistoryPage((next) => repository.getPage({
            query: requestedQuery, matchMode: requestedMatchMode,
            filter: requestedFilter === 'favorite' ? 'favorites' : requestedFilter,
            frequentThreshold, copiedSince, cursor: next, limit: HISTORY_PAGE_SIZE, signal: controller.signal,
          }), cursor, controller.signal, (count) => { if (current()) setScannedCount(scanned + count) })
          scanned += page.scanned
          loaded = appendNewItems(loaded, page.items)
          cursor = page.nextCursor
          pages += 1
        } while (cursor && pages < depth)
        return { items: loaded, nextCursor: cursor, pages }
      })()
        .then((page) => {
          if (!current()) return
          const settledAt = performance.now()
          const telemetryDetails = { pages: page.pages, items: page.items.length, hasQuery: Boolean(requestedQuery), filter: requestedFilter }
          host.telemetry?.trackLatency(requestedQuery ? 'search' : 'list.read', settledAt - searchStartedAt, telemetryDetails)
          if (openStartedAtRef.current !== null) {
            host.telemetry?.trackLatency('open.first-list', settledAt - openStartedAtRef.current, telemetryDetails)
            openStartedAtRef.current = null
          }
          pagesLoadedRef.current = page.pages
          setItems(page.items)
          setNextCursor(page.nextCursor)
          lastSettledCriteriaKeyRef.current = criteriaKey
          setAppliedSearch({
            key: requestedKey,
            query: requestedQuery,
            matchMode: requestedMatchMode,
            filter: requestedFilter,
          })
          setSelectedId((selected) => page.items.some((item) => item.id === selected) ? selected : page.items[0]?.id ?? null)
          setFullTextSearchState('idle')
        }).catch(() => {
          if (!current()) return
          setFullTextSearchState('error')
        })
    }, debounceMs)
    const unsubscribe = owner?.subscribeInvalidation(() => controller.abort())
    return () => { controller.abort(); window.clearTimeout(timer); unsubscribe?.() }
  }, [repository, requestKey, criteriaKey, refreshEpoch, settings.enabled, host.deliveryFeedbackOwner, suspendPointerHover, desiredQuery, searchMatchMode, desiredFilter, frequentThreshold, copiedSince])

  const loadMore = useCallback(() => {
    if (!nextCursor || loadMoreAbortRef.current || fullTextSearchState !== 'idle' || resultsActionBlocked) return
    const generation = pageGeneration.current
    const owner = host.deliveryFeedbackOwner
    const controller = new AbortController()
    loadMoreAbortRef.current = controller
    setLoadingMore(true)
    setLoadMoreFailed(false)
    const current = () => generation === pageGeneration.current && !controller.signal.aborted && owner?.isCurrent() !== false
    void readMatchingHistoryPage((cursor) => repository.getPage({
      query: appliedQuery, matchMode: appliedSearchMatchMode,
      filter: appliedFilter === 'favorite' ? 'favorites' : appliedFilter,
      frequentThreshold, copiedSince, cursor, limit: HISTORY_PAGE_SIZE, signal: controller.signal,
    }), nextCursor, controller.signal, () => {})
      .then((page) => {
        if (!current()) return
        pagesLoadedRef.current += 1
        setItems((previous) => appendNewItems(previous, page.items))
        setNextCursor(page.nextCursor)
      })
      .catch(() => { if (current()) setLoadMoreFailed(true) })
      .finally(() => {
        if (loadMoreAbortRef.current !== controller) return
        loadMoreAbortRef.current = null
        setLoadingMore(false)
      })
  }, [appliedFilter, appliedQuery, appliedSearchMatchMode, copiedSince, frequentThreshold, fullTextSearchState, host.deliveryFeedbackOwner, nextCursor, repository, resultsActionBlocked])

  useEffect(() => {
    let active = true
    void repository.getRetentionStatus().then((status) => { if (active) setRetentionStatus(status) }).catch(() => {})
    return () => { active = false }
  }, [repository, refreshEpoch, settings.enabled])

  useEffect(() => {
    const refreshVisibleDay = () => {
      if (syncLocalDay()) clearPage()
      else refreshPage()
    }
    const unsubscribe = subscribeCachedIndex(refreshVisibleDay)
    const onFocus = () => refreshVisibleDay()
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onFocus)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onFocus)
    }
  }, [clearPage, refreshPage, syncLocalDay])

  const enableLegacy = async () => {
    const owner = host.deliveryFeedbackOwner
    if (retentionBusy || !legacyDialog || owner?.isCurrent() === false) return
    setRetentionBusy(true)
    try {
      await repository.enableLegacyRetention(resolveClipboardHistoryRetentionMonths(settings.retentionMonths))
      if (owner?.isCurrent() === false) return
      setLegacyDialog(false)
      refreshPage()
    } catch { if (owner?.isCurrent() !== false) setPasteNotice(t('retention.failed')) }
    finally { setRetentionBusy(false) }
  }

  useEffect(() => {
    if (searchPresentation.showInitialSkeleton) return
    const frame = requestAnimationFrame(() => searchRef.current?.focus())
    // WKWebView does not always flip visibilityState when the window is hidden and
    // shown again, so also recover focus whenever the window becomes key with
    // nothing focused (dialogs and editors keep their own focus).
    const onWindowFocus = () => {
      const active = document.activeElement
      if (!active || active === document.body) searchRef.current?.focus()
    }
    window.addEventListener('focus', onWindowFocus)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('focus', onWindowFocus)
    }
  }, [searchPresentation.showInitialSkeleton, settings.enabled])

  // Repository pages already apply the complete query and category. Never scan
  // every historical body into UI memory or filter only a local preview.
  const filteredItems = items

  useEffect(() => {
    setSelectedId((current) => {
      if (resultsActionBlocked) return current
      if (filteredItems.length === 0) return null
      if (current && filteredItems.some((item) => item.id === current)) return current
      return filteredItems[0].id
    })
  }, [filteredItems, resultsActionBlocked])

  const selectedItem = useMemo(
    () => filteredItems.find((i) => i.id === selectedId) ?? null,
    [filteredItems, selectedId]
  )

  const shortcutHints = getClipboardHistoryShortcuts({
    hasSelection: Boolean(selectedItem),
    loading: resultsActionBlocked,
    enabled: true,
    blocked: legacyDialog || Boolean(titleDialog),
    focus: shortcutFocus,
  })

  const [selectedFullItem, setSelectedFullItem] = useState<ClipboardHistoryItem | null>(null)
  // A selection change renders before the previous read's effect is cleaned up.
  const matchingFullItem = selectedFullItem?.id === selectedItem?.id && selectedFullItem?.hash === selectedItem?.hash
    ? selectedFullItem : null
  const previewItem = selectedItem?.kind === 'text' && selectedItem.text
    ? selectedItem : matchingFullItem && selectedItem
      ? { ...matchingFullItem, deletedAt: selectedItem.deletedAt, purgeAfter: selectedItem.purgeAfter, legacyProtected: selectedItem.legacyProtected }
      : selectedItem

  useEffect(() => {
    if (!selectedId) {
      setSelectedFullItem(null)
      return
    }
    let cancelled = false
    const owner = host.deliveryFeedbackOwner
    const unsubscribe = owner?.subscribeInvalidation(() => { cancelled = true })
    setSelectedFullItem(null)
    void repository.getItem(selectedId).then((item) => {
      if (!cancelled && owner?.isCurrent() !== false && item) {
        setSelectedFullItem(item)
      }
    }).catch(() => { /* The current row can still be retried by its explicit action. */ })
    return () => { cancelled = true; unsubscribe?.() }
  }, [selectedId, repository, appliedFilter, selectedItem?.hash, host.deliveryFeedbackOwner])

  const groupedItems = useMemo(() => {
    // Frequent / favorite use their own sort; do not re-bucket by day.
    if (appliedFilter === 'frequent' || appliedFilter === 'favorite') {
      return [{ label: '', items: filteredItems }]
    }
    return groupItemsByDay(filteredItems, locale, t)
  }, [filteredItems, appliedFilter, locale, t])

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
  const [openSession] = useState(() => createHistoryOpenSession(document.visibilityState))
  useEffect(() => {
    let focusFrame: number | undefined
    const onVisibilityChange = () => {
      if (!openSession.visibilityChanged(document.visibilityState)) return
      // A standalone surface window is retained while hidden. A genuine reopen
      // starts a fresh browsing session without treating ordinary blur, dialogs,
      // or an internal preview return as a new open.
      setSearchMatchMode('literal')
      openStartedAtRef.current = performance.now()
      resetHistoryOpenSession({
        invalidatePasteNotice: () => { pasteNoticeGenerationRef.current += 1 },
        clearPasteNotice: () => setPasteNotice(null),
        clearSelection: () => { setSelectedId(null); setSelectedIds([]); selectionAnchor.current = null },
        resetPage: () => { pagesLoadedRef.current = 1 },
        clearNextCursor: () => setNextCursor(undefined),
        resetScroll: () => listRef.current?.scrollTo({ top: 0 }),
        clearDomSelection: () => window.getSelection()?.removeAllRanges(),
        suspendPointerHover,
        refreshPage,
        focusSearch: () => { focusFrame = requestAnimationFrame(() => searchRef.current?.focus()) },
      })
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    }
  }, [openSession, refreshPage, suspendPointerHover])
  const selectRange = useCallback((id: string) => {
    const anchor = selectionAnchor.current ?? selectedId ?? id
    selectionAnchor.current = anchor
    const from = filteredItems.findIndex((item) => item.id === anchor)
    const to = filteredItems.findIndex((item) => item.id === id)
    if (from >= 0 && to >= 0) setSelectedIds(filteredItems.slice(Math.min(from, to), Math.max(from, to) + 1).map((item) => item.id))
    setSelectedId(id)
  }, [filteredItems, selectedId])
  const selectListItem = useCallback((id: string, event: MouseEvent) => {
    if (event.shiftKey) selectRange(id)
    else if (event.metaKey || event.ctrlKey) {
      setSelectedIds((current) => {
        const ids = current.length ? current : selectedId ? [selectedId] : []
        return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]
      })
      selectionAnchor.current = id
      setSelectedId(id)
    } else {
      setSelectedIds([])
      selectionAnchor.current = id
      setSelectedId(id)
    }
    containerRef.current?.focus({ preventScroll: true })
  }, [selectRange, selectedId])

  const resetBrowser = useCallback(() => {
    setQuery('')
    setSelectedIds([])
    selectionAnchor.current = null
    setSearchMatchMode('literal')
    setFilter('all')
    setTimeRange('all')
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

  // Scroll loading: ask for the next page once the viewport nears the end of the list.
  const lastVisibleRow = virtualizer.getVirtualItems().at(-1)?.index ?? -1
  useEffect(() => {
    if (lastVisibleRow >= 0 && lastVisibleRow >= flatRows.length - LOAD_MORE_THRESHOLD_ROWS) loadMore()
  }, [flatRows.length, lastVisibleRow, loadMore])

  const actionItems = useCallback((item: ClipboardHistoryItem) => selectedIds.length > 1 && selectedIds.includes(item.id)
    ? filteredItems.filter((entry) => selectedIds.includes(entry.id)) : [item], [filteredItems, selectedIds])
  const selectedItems = selectedItem ? actionItems(selectedItem) : []
  const multiple = selectedItems.length > 1
  const selectionHasNonText = multiple && selectedItems.some((item) => item.kind !== 'text')
  const readActionItems = useCallback(async (item: ClipboardHistoryItem, isCurrent: () => boolean) => {
    const selection = actionItems(item)
    if (selection.length > 1 && selection.some((entry) => entry.kind !== 'text')) throw new Error('selection.textOnly')
    const full = await Promise.all(selection.map(async (entry) => {
      const value = await repository.getItem(entry.id)
      if (!value || value.hash !== entry.hash) throw new Error('error.loadFailed')
      return value
    }))
    if (!isCurrent() || !resultsActionableRef.current) throw new Error('cancelled')
    return full
  }, [actionItems, repository])
  const joinedText = (full: ClipboardHistoryItem[]) => {
    const text = full.map((item) => item.kind === 'text' ? item.text : '').join('\n')
    if (new TextEncoder().encode(text).byteLength > 1024 * 1024) throw new Error('selection.tooLarge')
    return text
  }
  const actionError = (error: unknown, fallback: string) => t(error instanceof Error &&
    ['selection.textOnly', 'selection.tooLarge', 'error.loadFailed'].includes(error.message) ? error.message : fallback)

  const handlePaste = useCallback(async (item: ClipboardHistoryItem, plainTextOnly = false) => {
    if (!resultsActionableRef.current || (plainTextOnly && item.kind !== 'text')) return
    const generation = ++pasteNoticeGenerationRef.current
    setPasteNotice(null)
    try {
      const fullItems = await readActionItems(item, () => generation === pasteNoticeGenerationRef.current && host.deliveryFeedbackOwner?.isCurrent() !== false)
      const fullItem = fullItems[0]
      let result
      if (fullItem.kind === 'text') {
        result = await host.paste.pasteText(fullItems.length > 1 ? joinedText(fullItems) : fullItem.text)
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
      for (const entry of fullItems) void repository.recordPaste(entry.id).catch(() => {})
      resetBrowser()
      host.complete()
    } catch (error) {
      if (generation === pasteNoticeGenerationRef.current) setPasteNotice(actionError(error, 'error.pasteFailed'))
    }
  }, [host, t, repository, resetBrowser, readActionItems])

  const handleCopy = useCallback(async (item: ClipboardHistoryItem) => {
    if (!resultsActionableRef.current) return
    pasteNoticeGenerationRef.current += 1
    setPasteNotice(null)
    const submission = copyLifecycle.begin(() => host.deliveryFeedbackOwner?.isCurrent() !== false)
    try {
      const fullItems = await readActionItems(item, submission.isCurrent)
      const fullItem = fullItems[0]
      if (fullItem.kind === 'text') {
        await host.clipboard.writeText(fullItems.length > 1 ? joinedText(fullItems) : fullItem.text, { signal: submission.signal })
      } else if (fullItem.kind === 'image') {
        await host.clipboard.writeImage(fullItem.blobId, { signal: submission.signal })
      } else {
        await host.clipboard.writeFiles(fullItem.paths, { signal: submission.signal })
      }
      if (!submission.isCurrent()) return
      submission.commit()
      resetBrowser()
      host.complete()
    } catch (error) {
      if (submission.isCurrent()) host.showMessage(actionError(error, 'error.copyFailed'), 'error')
    } finally {
      submission.finish()
    }
  }, [copyLifecycle, host, resetBrowser, readActionItems, t])

  const handleSaveImage = useCallback(async (item: ClipboardHistoryItem) => {
    if (!resultsActionableRef.current || item.kind !== 'image') return
    const ownerCurrent = () => host.deliveryFeedbackOwner?.isCurrent() !== false
    const submission = imageSaveLifecycle.begin(ownerCurrent)
    if (!submission) return

    const generation = ++pasteNoticeGenerationRef.current
    const focusTarget = document.activeElement instanceof HTMLElement && containerRef.current?.contains(document.activeElement)
      ? document.activeElement
      : null
    setPasteNotice(null)
    setImageSaveBusy(true)
    try {
      const result = await saveClipboardHistoryImage(repository, host.storage, item.id, submission.isCurrent)
      if (!submission.isCurrent() || generation !== pasteNoticeGenerationRef.current) return
      if (result.status === 'unavailable') setPasteNotice(t('imageSave.unavailable'))
    } catch {
      if (submission.isCurrent() && generation === pasteNoticeGenerationRef.current) {
        setPasteNotice(t('imageSave.failed'))
      }
    } finally {
      const restoreFocus = submission.isCurrent()
      submission.finish()
      if (imageSaveMountedRef.current) setImageSaveBusy(false)
      if (restoreFocus && imageSaveMountedRef.current) {
        requestAnimationFrame(() => {
          if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true })
          else containerRef.current?.focus({ preventScroll: true })
        })
      }
    }
  }, [host, imageSaveLifecycle, repository, t])

  const prepareQuickEditorOpen = useCallback(async (item: ClipboardHistoryItem) => {
    if (!resultsActionableRef.current || item.kind !== 'text') return
    pasteNoticeGenerationRef.current += 1
    setPasteNotice(null)
    const submission = quickEditorLifecycle.begin(host.deliveryFeedbackOwner)
    if (!submission) return
    try {
      const result = await readHistoryQuickEditorSnapshot(repository, item.id, submission.isCurrent)
      if (!submission.isCurrent()) return
      if (result.status !== 'ready') {
        setPasteNotice(t('quickEditor.error.unavailable'))
        return
      }
      const open = host.openHistoryTextInQuickEditor
      const opened = open
        ? await openHistoryQuickEditorSnapshot(repository, result.snapshot, open, submission)
        : { status: 'failed' as const }
      if (opened.status === 'opened' || !submission.isCurrent()) return
      setPasteNotice(t(opened.status === 'changed'
        ? 'quickEditor.error.changed'
        : opened.status === 'unavailable'
          ? 'quickEditor.error.unavailable'
          : 'quickEditor.error.failed'))
    } catch {
      if (submission.isCurrent()) setPasteNotice(t('quickEditor.error.failed'))
    } finally {
      submission.finish()
    }
  }, [host.deliveryFeedbackOwner, host.openHistoryTextInQuickEditor, quickEditorLifecycle, repository, t])

  const applyItemUpdate = useCallback((updated: ClipboardHistoryItem) => {
    setItems((current) =>
      current.map((entry) => {
        if (entry.id !== updated.id) return entry
        // Keep list-friendly payloads (preview / empty text) when full item is loaded.
        if (entry.kind === 'text' && updated.kind === 'text') {
          return {
            ...updated,
            text: '',
            preview: updated.preview,
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

  const toggleQuickFavorite = useCallback(async (item: ClipboardHistoryItem) => {
    if (!resultsActionableRef.current) return
    try {
      const updated = await repository.toggleFavorite(item.id)
      if (updated) applyItemUpdate(updated)
      else setPasteNotice(t('error.favoriteFailed'))
    } catch { setPasteNotice(t('error.favoriteFailed')) }
  }, [repository, applyItemUpdate, t])

  const openFavoriteTitleDialog = useCallback((item: ClipboardHistoryItem, mode: 'create' | 'edit') => {
    if (!resultsActionableRef.current) return
    const fallback =
      item.favoriteTitle
      || (item.kind === 'text' ? item.preview : item.kind === 'files' ? item.fileNames.join(', ') : '')
    setTitleDialog({ id: item.id, draft: mode === 'edit' ? (item.favoriteTitle ?? '') : fallback.slice(0, 80), mode })
  }, [])

  const handleFavoriteClick = useCallback((item: ClipboardHistoryItem) => {
    if (!resultsActionableRef.current) return
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

  const handleDelete = useCallback(async (id: string) => {
    if (!resultsActionableRef.current || pendingDeletesRef.current.has(id)) return
    try {
      await repository.deleteItem(id)
      refreshPage()
      const timer = setTimeout(() => {
        pendingDeletesRef.current.delete(id)
        setPendingDelete((current) => current?.id === id ? null : current)
        void repository.purgeTrashItem(id).catch(() => host.showMessage(t('retention.failed'), 'error'))
      }, 5000)
      pendingDeletesRef.current.set(id, timer)
      setPendingDelete({ id, undo: () => {
        const timer = pendingDeletesRef.current.get(id)
        if (timer === undefined) return
        clearTimeout(timer)
        pendingDeletesRef.current.delete(id)
        setPendingDelete(null)
        void repository.restoreItem(id).then((restored) => {
          if (!restored) throw new Error('unavailable')
          refreshPage()
          setSelectedId(id)
        }).catch(() => host.showMessage(t('retention.failed'), 'error'))
      } })
    } catch { host.showMessage(t('retention.failed'), 'error') }
  }, [repository, refreshPage, host, t])

  const itemContextMenuItems = useCallback((item: ClipboardHistoryItem): MenuItemSpec[] => [
    { key: 'paste', label: t('action.paste'), onSelect: () => void handlePaste(item) },
    ...(item.kind === 'text' ? [
      { key: 'plainPaste', label: t('action.pastePlain'), onSelect: () => void handlePaste(item, true) },
      { key: 'openQuickEditor', label: t('quickEditor.action'), onSelect: () => void prepareQuickEditorOpen(item) },
    ] : []),
    { key: 'copy', label: t('action.copy'), onSelect: () => void handleCopy(item) },
    ...(item.kind === 'image' ? [
      { key: 'saveImage', label: t('imageSave.action'), description: `${primaryModifierLabel}S`, disabled: imageSaveBusy, onSelect: () => void handleSaveImage(item) },
    ] : []),
    { key: 'delete', label: t('action.delete'), danger: true, onSelect: () => handleDelete(item.id) },
  ], [handlePaste, handleCopy, handleSaveImage, handleDelete, imageSaveBusy, prepareQuickEditorOpen, primaryModifierLabel, t])

  const handleReturnToLauncher = useCallback(async (item: ClipboardHistoryItem) => {
    if (!resultsActionableRef.current) return
    const generation = ++pasteNoticeGenerationRef.current
    setPasteNotice(null)
    try {
      const full = await readActionItems(item, () => generation === pasteNoticeGenerationRef.current && host.deliveryFeedbackOwner?.isCurrent() !== false)
      const first = full[0]
      const object = first.kind === 'text' ? { kind: 'text' as const, text: joinedText(full) }
        : first.kind === 'image' ? { kind: 'image' as const, blobId: first.blobId, contentType: first.contentType, width: first.width, height: first.height }
          : { kind: 'files' as const, paths: first.paths, fileNames: first.fileNames }
      if (!await host.returnToLauncherWithObject(object)) throw new Error('error.returnFailed')
    } catch (error) {
      if (generation === pasteNoticeGenerationRef.current) setPasteNotice(actionError(error, 'error.returnFailed'))
    }
  }, [host, readActionItems, t])
  const handleSave = async () => {
    if (!selectedItem || multiple || !resultsActionableRef.current) return
    if (selectedItem.kind === 'image') { await handleSaveImage(selectedItem); return }
    if (selectedItem.kind !== 'text' || !host.saveText) return
    const generation = ++pasteNoticeGenerationRef.current
    try {
      const full = await readActionItems(selectedItem, () => generation === pasteNoticeGenerationRef.current && host.deliveryFeedbackOwner?.isCurrent() !== false)
      if (full[0].kind === 'text') await host.saveText(full[0].text)
    } catch { if (generation === pasteNoticeGenerationRef.current) setPasteNotice(t('imageSave.failed')) }
  }
  const moreItems: MenuItemSpec[] = [
    { key: 'continue', label: t('action.continue'), disabled: !selectedItem || resultsActionBlocked || selectionHasNonText,
      description: selectionHasNonText ? t('selection.textOnly') : undefined, onSelect: () => { if (selectedItem) void handleReturnToLauncher(selectedItem) } },
    { key: 'quickEditor', label: t('quickEditor.action'), disabled: multiple || resultsActionBlocked || selectedItem?.kind !== 'text',
      onSelect: () => { if (selectedItem) void prepareQuickEditorOpen(selectedItem) } },
    { key: 'save', label: t('action.saveAs'), disabled: multiple || resultsActionBlocked || !selectedItem || selectedItem.kind === 'files' || imageSaveBusy,
      onSelect: () => { void handleSave() } },
  ]

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.defaultPrevented || titleDialog || legacyDialog || imeKeyDown.shouldIgnoreKeyDown(e)) return
    if (e.key === 'Escape' && selectedIds.length) {
      e.preventDefault()
      e.stopPropagation()
      setSelectedIds([])
      selectionAnchor.current = null
      return
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      e.stopPropagation()
      moreButtonRef.current?.click()
      return
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'g') {
      if (imeKeyDown.shouldIgnoreKeyDown(e)) return
      const target = e.target instanceof Element ? e.target : null
      // Search input focus is intentionally preserved. Editors and transient
      // overlays keep their own native/application key handling.
      if (target?.closest('textarea, [contenteditable]:not([contenteditable="false"]), .monaco-editor, [role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')) return
      if (matchNavigatorRef.current?.move(e.shiftKey ? -1 : 1)) {
        e.preventDefault()
        e.stopPropagation()
      }
      return
    }
    const focus = readClipboardHistoryShortcutFocus(e.currentTarget as HTMLElement, e.target instanceof Element ? e.target : null, document.activeElement)
    if (focus.nativeButton) return
    if (!selectedItem) return
    const shortcuts = getClipboardHistoryShortcuts({
      hasSelection: true,
      loading: resultsActionBlocked,
      enabled: true,
      blocked: legacyDialog || Boolean(titleDialog),
      focus,
    })
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.code === 'KeyP' || e.key.toLowerCase() === 'p')) {
      if (!shortcuts.paste || imeKeyDown.shouldIgnoreKeyDown(e)) return
      e.preventDefault()
      void toggleQuickFavorite(selectedItem)
    } else if (e.key === 'Enter' && !e.altKey) {
      if (!shortcuts.paste) return
      e.preventDefault()
      void handlePaste(selectedItem, e.shiftKey)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!shortcuts.delete) return
      e.preventDefault()
      handleDelete(selectedItem.id)
    } else if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
      if (!shortcuts.paste || selectedItem.kind !== 'image') return
      e.preventDefault()
      void handleSaveImage(selectedItem)
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      if ((!multiple && focus.editing) || !shortcuts.paste) return
      const selectedText = multiple ? '' : readDomSelectedText()
      e.preventDefault()
      if (selectedText) {
        void host.clipboard.writeText(selectedText)
          .then(() => host.showMessage(t('message.copied'), 'success'))
          .catch(() => host.showMessage(t('error.copyFailed'), 'error'))
        return
      }
      void handleCopy(selectedItem)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const index = filteredItems.findIndex((item) => item.id === selectedId)
      const next = filteredItems[Math.max(0, Math.min(filteredItems.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (!next) return
      if (e.shiftKey) selectRange(next.id)
      else { setSelectedIds([]); selectionAnchor.current = next.id; setSelectedId(next.id) }
      const row = flatRows.findIndex((entry) => entry.type === 'item' && entry.item.id === next.id)
      if (row >= 0) virtualizer.scrollToIndex(row, { align: 'auto' })
    }
  }, [selectedItem, selectedId, filteredItems, flatRows, virtualizer, handlePaste, handleReturnToLauncher, handleDelete, handleCopy, handleSaveImage, host, t, imeKeyDown, titleDialog, toggleQuickFavorite, resultsActionBlocked, settings.enabled, filter, legacyDialog, selectedIds, multiple, selectRange])

  const filterOptionLabel = (checked: boolean, text: string) => (
    <span className="clipboard-history-filter-option">
      <Check size={13} aria-hidden="true" style={{ visibility: checked ? 'visible' : 'hidden' }} />
      {text}
    </span>
  )
  const filterMenuItems: MenuItemSpec[] = [
      { key: 'time-all', label: filterOptionLabel(timeRange === 'all', t('filter.timeAll')), onSelect: () => changeTimeRange('all') },
      { key: 'time-today', label: filterOptionLabel(timeRange === 'today', t('filter.today')), onSelect: () => changeTimeRange('today') },
      { key: 'time-last7Days', label: filterOptionLabel(timeRange === 'last7Days', t('filter.last7Days')), onSelect: () => changeTimeRange('last7Days') },
    { key: 'all-terms', label: filterOptionLabel(searchMatchMode === 'all-terms', t('search.allTerms')), onSelect: toggleSearchMatchMode, closeOnClick: false },
  ]
  const filterActive = (timeRange !== 'all') || searchMatchMode === 'all-terms'
  const filterMenu = (
    <Menu
      items={filterMenuItems}
      trigger={<IconButton
        type="button"
        className="clipboard-history-filter-trigger"
        label={t('filter.options')}
        data-active={filterActive ? 'true' : undefined}
      ><ListFilter size={17} /></IconButton>}
    />
  )

  const renderContent = () => {
    if (searchPresentation.showInitialSkeleton) {
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

    return (
      <>
        <div className="clipboard-history-main">
          <div className="clipboard-history-list-pane">
            <div className="clipboard-history-list-toolbar">
              <div className="clipboard-history-filter-stack">
                <SegmentedControl
                  className="clipboard-history-filter"
                  value={filter}
                  onChange={changeFilter}
                  aria-label={t('filter.label')}
                  options={[
                    { value: 'all', label: t('filter.all') },
                    { value: 'favorite', label: t('filter.favorite') },
                    { value: 'frequent', label: t('filter.frequent') },
                    { value: 'text', label: t('filter.text') },
                    { value: 'image', label: t('filter.image') },
                    { value: 'files', label: t('filter.files') },
                  ]}
                />
              </div>
            </div>
            <div ref={listRef} className="clipboard-history-list" data-launcher-scrollable aria-busy={fullTextSearchState === 'loading'} style={{ overflow: 'auto', flex: 1 }}
              onScrollCapture={(event) => {
                if (event.target !== event.currentTarget) return
                // WebKit native scrolling can emit scroll without wheel.
                suspendPointerHover()
                if (event.currentTarget.contains(document.activeElement)) containerRef.current?.focus({ preventScroll: true })
              }}>
              <SurfaceList aria-label={t('surface.main.title')} data-launcher-scrollable>
                {filteredItems.length === 0 ? (
                  <SurfaceEmptyState>
                    {fullTextSearchState === 'loading'
                      ? t('state.loading')
                      : fullTextSearchState === 'error'
                        ? t('error.loadFailed')
                      : appliedFilter === 'frequent'
                      ? t('state.emptyFrequent')
                      : appliedFilter === 'favorite'
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
                            query={appliedQuery}
                            matchMode={appliedSearchMatchMode}
                            selected={selectedIds.length ? selectedIds.includes(row.item.id) : row.item.id === selectedId}
                            locale={locale}
                            t={t}
                            storage={host.storage}
                            onSelect={selectListItem}
                            onPaste={handlePaste}
                            onDelete={handleDelete}
                            onFavorite={handleFavoriteClick}
                            menuItems={itemContextMenuItems(row.item)}
                            actionsDisabled={resultsActionBlocked}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </SurfaceList>
            </div>
            <SurfaceFooterHints className="clipboard-history-footer">
              <span role="status">{t(loadingMore ? 'paging.loadingMore' : 'paging.loaded', { count: items.length })}</span>
              {loadMoreFailed && <>
                <span role="alert">{t('error.loadFailed')}</span>
                <Button type="button" onClick={loadMore}>{t('paging.retry')}</Button>
              </>}
              {fullTextSearchState === 'error' && <>
                <span role="alert">{t('error.loadFailed')}</span>
                <Button type="button" onClick={refreshPage}>{t('paging.retry')}</Button>
              </>}
            </SurfaceFooterHints>
          </div>

          <ContextMenu
            disabled={!selectedItem || resultsActionBlocked}
            items={previewItem ? itemContextMenuItems(previewItem) : []}
            trigger={
              <SurfacePreview className="clipboard-history-preview" data-launcher-scrollable>
                {!previewItem ? (
                  <SurfaceEmptyState>
                    {t('preview.empty')}
                  </SurfaceEmptyState>
                ) : (
                  <>
                    <ClipboardHistoryPreviewContent
                      item={previewItem}
                      query={appliedQuery}
                      matchMode={appliedSearchMatchMode}
                      t={t}
                      storage={host.storage}
                      matchNavigatorRef={matchNavigatorRef}
                    />
                    {previewItem.isFavorite && (
                      <div className="clipboard-history-favorite-title-bar">
                        <span className="clipboard-history-favorite-title-label">
                          {previewItem.favoriteTitle || t('favorite.untitled')}
                        </span>
                        <ToolbarButton
                          type="button"
                          disabled={resultsActionBlocked}
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
          />
        </div>

        <SurfaceFooterHints className="clipboard-history-footer">
          {multiple && <span role="status">{t('selection.count', { count: selectedItems.length })}</span>}
          {selectionHasNonText && <span role="status">{t('selection.textOnly')}</span>}
          {pendingDelete && <><span>{t('message.deleted.toast')}</span><Button type="button" onClick={pendingDelete.undo}>{t('message.undo')}</Button></>}
          {pasteNotice ? <span role="status" style={{ color: 'var(--text-1, var(--hiven-color-text-primary))' }}>{pasteNotice}</span> : <>
            {/* Keep hint slots in layout when button focus temporarily disables shortcuts. */}
            <span style={{ visibility: shortcutHints.paste ? 'visible' : 'hidden' }} aria-hidden={!shortcutHints.paste}>↵ {t('hint.paste')}</span>
            <span style={{ visibility: shortcutHints.paste && selectedItem?.kind === 'text' ? 'visible' : 'hidden' }} aria-hidden={!shortcutHints.paste || selectedItem?.kind !== 'text'}>⇧↵ {t('hint.pastePlain')}</span>
            <span style={{ visibility: shortcutHints.paste ? 'visible' : 'hidden' }} aria-hidden={!shortcutHints.paste}>{modifierLabel}P {t('hint.favorite')}</span>
            <span style={{ visibility: shortcutHints.returnToLauncher ? 'visible' : 'hidden' }} aria-hidden={!shortcutHints.returnToLauncher}>{primaryModifierLabel}K {t('action.more')}</span>
            <span>{primaryModifierLabel}C {t('action.copy')}</span>
            <span style={{ visibility: shortcutHints.delete ? 'visible' : 'hidden' }} aria-hidden={!shortcutHints.delete}>⌫ {t('hint.delete')}</span>
          </>}
        </SurfaceFooterHints>
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
      className={`clipboard-history-surface${pointerHover ? ' has-pointer-hover' : ''}`}
      onPointerMoveCapture={(event) => setPointerHover(pointerIntent.move(event.screenX, event.screenY, event.pointerType))}
      onPointerLeave={suspendPointerHover}
      onWheelCapture={suspendPointerHover}
      onKeyDownCapture={suspendPointerHover}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="clipboard-history-topbar">
        <IconButton
          type="button"
          label={t('action.back')}
          onClick={() => {
            setQuery('')
            setSearchMatchMode('literal')
            host.requestBack()
          }}
        >
          <BackIcon size={18} />
        </IconButton>
        <SearchField
          ref={searchRef}
          data-plugin-surface-autofocus
          value={query}
          onChange={(e) => changeSearchQuery(e.target.value)}
          onCompositionStart={startSearchComposition}
          onCompositionEnd={endSearchComposition}
          placeholder={t('search.placeholder')}
        />
        {filterMenu}
        <Menu items={moreItems} trigger={<Button ref={moreButtonRef} type="button" aria-label={t('action.more')}>{primaryModifierLabel}K</Button>} />
        <Button
          type="button"
          variant="primary"
          disabled={!selectedItem || resultsActionBlocked || retentionBusy}
          onClick={() => selectedItem && void handlePaste(selectedItem)}
        >
          {t('action.paste')}
        </Button>
        <IconButton
          type="button"
          label={t('action.openSettings')}
            onClick={() => host.openSettings({ preserveSurface: true })}
        >
          <SettingsIcon size={17} />
        </IconButton>
        <IconButton
          type="button"
          label={t('action.close')}
          onClick={() => {
            setQuery('')
            setSearchMatchMode('literal')
            host.close()
          }}
        >
          <CloseIcon size={18} />
        </IconButton>
      </div>

      {((retentionStatus?.legacyProtectedCount ?? 0) > 0 || fullTextSearchState === 'loading') && <SurfaceFooterHints className="clipboard-history-footer">
        {retentionStatus && retentionStatus.legacyProtectedCount > 0 && <>
          <span>{t('retention.legacyProtected', { count: retentionStatus.legacyProtectedCount })}</span>
          <Button type="button" disabled={retentionBusy || !retentionStatus.migrationComplete} onClick={() => setLegacyDialog(true)}>{t('retention.enableLegacy')}</Button>
        </>}
        {fullTextSearchState === 'loading' && <span role="status">{t('paging.scanning', { count: scannedCount })}</span>}
      </SurfaceFooterHints>}

      {renderContent()}

      <Dialog
        open={legacyDialog}
        onOpenChange={(open) => { if (!retentionBusy) setLegacyDialog(open) }}
        title={t('retention.legacyConfirmTitle')}
      >
        <p>{t('retention.legacyConfirm', { months: resolveClipboardHistoryRetentionMonths(settings.retentionMonths), count: retentionStatus?.legacyProtectedCount ?? 0 })}</p>
        <div className="clipboard-history-title-dialog-actions">
          <Button type="button" disabled={retentionBusy} onClick={() => void enableLegacy()}>{t('retention.enableLegacy')}</Button>
          <Button type="button" disabled={retentionBusy} onClick={() => setLegacyDialog(false)}>{t('action.cancel')}</Button>
        </div>
      </Dialog>

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

  return surfaceContent
}

const ClipboardHistoryItemRow = memo(function ClipboardHistoryItemRow({
  item,
  query,
  matchMode,
  selected,
  locale,
  t,
  storage,
  onSelect,
  onPaste,
  onDelete,
  onFavorite,
  menuItems,
  actionsDisabled,
}: {
  item: ClipboardHistoryItem
  query: string
  matchMode: ClipboardHistorySearchMatchMode
  selected: boolean
  locale: string
  t: (key: string) => string
  storage: SurfaceStorage
  onSelect: (id: string, event: MouseEvent) => void
  onPaste: (item: ClipboardHistoryItem) => Promise<void>
  onDelete: (id: string) => void
  onFavorite: (item: ClipboardHistoryItem) => void
  menuItems: MenuItemSpec[]
  actionsDisabled: boolean
}) {
  const pasteCount = item.pasteCount ?? 0
  const matchSnippet = useMemo(
    () => item.kind === 'text' ? getClipboardHistoryMatchSnippet(item.text || item.preview, query, matchMode) : null,
    [item, query, matchMode],
  )
  const hasCustomTitle = Boolean(item.favoriteTitle?.trim())
  const title = !hasCustomTitle && matchSnippet ? matchSnippet : getItemTitle(item, t)

  return (
    <ContextMenu
      disabled={actionsDisabled}
      items={menuItems}
      trigger={
        <div
          className={`clipboard-history-item-row${selected ? ' is-selected' : ''}${item.isFavorite ? ' is-favorite' : ''}`}
        >
          <SurfaceListItem
            type="button"
            selected={selected}
            className="clipboard-history-item"
            onClick={(event) => onSelect(item.id, event)}
            onDoubleClick={() => { if (!actionsDisabled) void onPaste(item) }}
          >
            {renderItemMedia(item, storage)}
            <span className="clipboard-history-item-text">
              <span className="clipboard-history-item-title"><ClipboardHistoryHighlightedText text={title} query={query} matchMode={matchMode} allTermsAlreadyValidated={!hasCustomTitle && Boolean(matchSnippet)} /></span>
              <span className="clipboard-history-item-subtitle">
                {hasCustomTitle && matchSnippet ? <>
                  <ClipboardHistoryHighlightedText text={matchSnippet} query={query} matchMode={matchMode} allTermsAlreadyValidated />
                  {` · ${getContentTypeLabel(item, t)} · ${formatBytes(item.byteSize)} · ${formatDateTime(item.lastCopiedAt, locale)}`}
                </> : getItemSubtitle(item, locale, t)}
                {pasteCount > 0 ? ` · ×${pasteCount}` : ''}
              </span>
            </span>
          </SurfaceListItem>
          <>
          <IconButton
            type="button"
            label={item.isFavorite ? t('action.unfavorite') : t('action.favorite')}
            className={`clipboard-history-item-favorite${item.isFavorite ? ' is-active' : ''}`}
            disabled={actionsDisabled}
            onClick={() => onFavorite(item)}
          >
            <StarIcon size={14} fill={item.isFavorite ? 'currentColor' : 'none'} />
          </IconButton>
          <IconButton
            type="button"
            label={t('action.delete')}
            className="clipboard-history-item-delete"
            disabled={actionsDisabled}
            onClick={() => onDelete(item.id)}
          >
            <CloseIcon size={14} />
          </IconButton>
          </>
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
  // Page rows only carry the list thumbnail; the full item adds the original.
  const blobId = item.blobId || item.previewBlobId

  useEffect(() => {
    let disposed = false
    void storage.blob.url(blobId).then((url) => {
      if (!disposed) setImageUrl(url)
    })
    return () => {
      disposed = true
    }
  }, [blobId, storage])

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

function ClipboardHistoryHighlightedText({ text, query, matchMode, allTermsAlreadyValidated = false }: {
  text: string
  query: string
  matchMode: ClipboardHistorySearchMatchMode
  allTermsAlreadyValidated?: boolean
}) {
  const { segments } = useMemo(
    () => getClipboardHistoryMatchContext(text, query, matchMode, allTermsAlreadyValidated),
    [text, query, matchMode, allTermsAlreadyValidated],
  )
  return <>{segments.map((segment) => segment.match
    ? <mark key={segment.start} className="clipboard-history-search-match">{segment.text}</mark>
    : segment.text)}</>
}

function ClipboardHistoryPreviewContent({ item, query, matchMode, t, storage, matchNavigatorRef }: {
  item: ClipboardHistoryItem
  query: string
  matchMode: ClipboardHistorySearchMatchMode
  t: (key: string) => string
  storage: SurfaceStorage
  matchNavigatorRef: { current: ClipboardHistoryMatchNavigator | null }
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  const alignedRef = useRef<{ id: string, query: string, matchMode: ClipboardHistorySearchMatchMode, bodyVersion: string, fullText: boolean } | null>(null)
  const normalizedQuery = query.trim().toLowerCase()
  const fullText = item.kind === 'text' && Boolean(item.text)
  const bodyVersion = `${item.hash}:${fullText ? 'full' : 'preview'}`
  const navigationIdentity = `${item.id}\u0000${normalizedQuery}\u0000${matchMode}\u0000${bodyVersion}`
  const navigationStateRef = useRef({ identity: '', count: 0, currentIndex: -1 })
  const [navigationState, setNavigationState] = useState({ identity: '', count: 0, currentIndex: -1 })

  const applyCurrentMatch = useCallback((matches: readonly HTMLElement[], currentIndex: number) => {
    matches.forEach((match, index) => {
      const current = index === currentIndex
      match.classList.toggle('is-current', current)
      if (current) match.setAttribute('aria-current', 'true')
      else match.removeAttribute('aria-current')
    })
  }, [])

  const alignMatch = useCallback((content: HTMLElement, match: HTMLElement) => {
    const matchTop = match.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop
    content.scrollTop = Math.max(0, matchTop - Math.max(16, content.clientHeight * 0.3))
  }, [])

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    const matches = Array.from(content.querySelectorAll<HTMLElement>('.clipboard-history-search-match'))
    const nextNavigationState = {
      identity: navigationIdentity,
      count: matches.length,
      currentIndex: matches.length > 0 ? 0 : -1,
    }
    navigationStateRef.current = nextNavigationState
    applyCurrentMatch(matches, nextNavigationState.currentIndex)
    setNavigationState(nextNavigationState)

    const previous = alignedRef.current
    const sameSearch = previous?.id === item.id
      && previous.query === normalizedQuery
      && previous.matchMode === matchMode
      && previous.bodyVersion === bodyVersion
    // Loading the full record gets one alignment. Re-reads and background index
    // refreshes must not move a reader who has since scrolled through the text.
    if (sameSearch && (previous.fullText || !fullText)) return
    alignedRef.current = { id: item.id, query: normalizedQuery, matchMode, bodyVersion, fullText }
    const firstMatch = matches[0]
    if (firstMatch) {
      alignMatch(content, firstMatch)
    } else if (!sameSearch) {
      content.scrollTop = 0
    }
  }, [item.id, normalizedQuery, matchMode, bodyVersion, fullText, navigationIdentity, applyCurrentMatch, alignMatch])

  const moveMatch = useCallback((direction: -1 | 1) => {
    const content = contentRef.current
    if (!content) return false
    const matches = Array.from(content.querySelectorAll<HTMLElement>('.clipboard-history-search-match'))
    if (matches.length === 0) return false
    const previous = navigationStateRef.current
    const currentIndex = previous.identity === navigationIdentity ? previous.currentIndex : -1
    const nextIndex = getClipboardHistoryMatchNavigationIndex(currentIndex, matches.length, direction)
    if (nextIndex < 0) return false
    const nextState = { identity: navigationIdentity, count: matches.length, currentIndex: nextIndex }
    navigationStateRef.current = nextState
    applyCurrentMatch(matches, nextIndex)
    alignMatch(content, matches[nextIndex])
    setNavigationState(nextState)
    return true
  }, [navigationIdentity, applyCurrentMatch, alignMatch])

  useLayoutEffect(() => {
    const navigator = { move: moveMatch }
    matchNavigatorRef.current = navigator
    return () => {
      if (matchNavigatorRef.current === navigator) matchNavigatorRef.current = null
    }
  }, [matchNavigatorRef, moveMatch])

  const showNavigation = Boolean(normalizedQuery)
    && navigationState.identity === navigationIdentity
    && navigationState.count > 0

  return (
    <div className="clipboard-history-preview-body">
      {showNavigation && <div className="clipboard-history-match-navigation">
        <span role="status" aria-live="polite">
          {navigationState.currentIndex + 1} / {navigationState.count}
        </span>
        <IconButton type="button" label={t('search.previousMatch')} onClick={() => moveMatch(-1)}>
          <ArrowUp size={13} />
        </IconButton>
        <IconButton type="button" label={t('search.nextMatch')} onClick={() => moveMatch(1)}>
          <ArrowDown size={13} />
        </IconButton>
      </div>}
      <div ref={contentRef} className="clipboard-history-preview-content" data-launcher-scrollable>
        {renderPreview(item, t, storage, query, matchMode)}
      </div>
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

function renderPreview(item: ClipboardHistoryItem, t: (key: string) => string, storage: SurfaceStorage, query: string, matchMode: ClipboardHistorySearchMatchMode) {
  if (item.kind === 'text') {
    // Show preview text while full item is loading
    const displayText = item.text || item.preview
    return (
      <pre className="clipboard-history-preview-text">
        <ClipboardHistoryHighlightedText text={displayText} query={query} matchMode={matchMode} />
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
  if (item.legacyProtected) rows.push({ label: t('retention.label'), value: t('retention.protectedItem') })

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
