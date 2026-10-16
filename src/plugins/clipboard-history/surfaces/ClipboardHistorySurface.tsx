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
  ConfirmDialog,
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
import { ArrowDown, ArrowUp } from 'lucide-react'
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
import { createHistoryPointerIntent } from './historyPointerIntent'
import { createHistoryOpenSession, resetHistoryOpenSession } from './historyOpenSession'
import { createHistoryCopyLifecycle } from './historyCopyLifecycle'
import { createHistoryImageSaveLifecycle, saveClipboardHistoryImage } from './historyImageSave'
import {
  createHistoryQuickEditorLifecycle,
  openHistoryQuickEditorSnapshot,
  readHistoryQuickEditorSnapshot,
  type HistoryQuickEditorSnapshot,
} from './historyQuickEditorOpen'
import {
  CLIPBOARD_TEXT_MERGE_MIN_ITEMS,
  CLIPBOARD_TEXT_MERGE_MAX_ITEMS,
  createClipboardTextMergeReader,
  copyClipboardTextBundle,
  toggleClipboardTextMergeSelection,
  removeClipboardTextMergeSelection,
  moveClipboardTextMergeSelection,
  type ClipboardTextMergePreview,
  type ClipboardTextMergeError,
  type ClipboardTextMergeSeparator,
} from '../merge/clipboardTextMerge'
import { readHistoryCompareSnapshots } from '../merge/clipboardTextCompare'
import { readClipboardQueueSnapshots } from '../queue/readClipboardQueueSnapshots'
import { ClipboardTextMergePanel } from './ClipboardTextMergePanel'
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

type FilterKind = 'all' | 'text' | 'image' | 'files' | 'frequent' | 'favorite' | 'trash'
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

type QueueStatus = Awaited<ReturnType<NonNullable<PluginSurfaceProps<ClipboardHistorySettings>['host']['historyPasteQueue']>['getStatus']>>

type TextEditState = {
  id: string
  original: string
  draft: string
  busy: boolean
  error: string | null
}

type FavoriteTitleDialogState = {
  id: string
  draft: string
  mode: 'create' | 'edit'
}

type QuickEditorOpenState = {
  snapshot: HistoryQuickEditorSnapshot
  busy: boolean
  error: string | null
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
  const [query, setQuery] = useState('')
  const [searchMatchMode, setSearchMatchMode] = useState<ClipboardHistorySearchMatchMode>('literal')
  const [pasteNotice, setPasteNotice] = useState<string | null>(null)
  const pasteNoticeGenerationRef = useRef(0)
  const [copyLifecycle] = useState(createHistoryCopyLifecycle)
  const [imageSaveLifecycle] = useState(createHistoryImageSaveLifecycle)
  const [quickEditorLifecycle] = useState(createHistoryQuickEditorLifecycle)
  const [quickEditorOpen, setQuickEditorOpen] = useState<QuickEditorOpenState | null>(null)
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
  const [loading, setLoading] = useState(true)
  const [fullTextSearchState, setFullTextSearchState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null)
  const editGeneration = useRef(0)
  const editInputRef = useRef<HTMLTextAreaElement>(null)
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
      setQuickEditorOpen(null)
    }
    const unsubscribeOwner = host.deliveryFeedbackOwner?.subscribeInvalidation(invalidate)
    const unsubscribeLeave = host.subscribeLeaveIntent?.(invalidate)
    return () => {
      quickEditorLifecycle.cancel()
      unsubscribeOwner?.()
      unsubscribeLeave?.()
    }
  }, [host.deliveryFeedbackOwner, host.subscribeLeaveIntent, quickEditorLifecycle])
  useEffect(() => {
    const invalidate = () => {
      editGeneration.current += 1
      setTextEdit((current) => current?.busy ? { ...current, busy: false, error: t('edit.error.failed') } : current)
    }
    const unsubscribe = host.deliveryFeedbackOwner?.subscribeInvalidation(invalidate)
    return () => { invalidate(); unsubscribe?.() }
  }, [host, t])
  useEffect(() => {
    if (!textEdit) return
    editInputRef.current?.focus()
  }, [textEdit?.id])
  useLayoutEffect(() => {
    if (!textEdit) editGeneration.current += 1
  }, [selectedId, query, filter, timeRange, textEdit?.id])
  const reportUnsavedChanges = host.setUnsavedChanges
  useLayoutEffect(() => {
    reportUnsavedChanges?.(Boolean(textEdit && (textEdit.busy || textEdit.draft !== textEdit.original)))
  }, [textEdit, reportUnsavedChanges])
  useLayoutEffect(() => () => reportUnsavedChanges?.(false), [reportUnsavedChanges])
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
  const pendingDeleteRef = useRef<{ timerId: ReturnType<typeof setTimeout>; id: string; toastId: string } | null>(null)
  const frequentThreshold = settings.frequentPasteThreshold ?? 3
  const [mergeReader] = useState(createClipboardTextMergeReader)
  const [combining, setCombining] = useState(false)
  useLayoutEffect(() => {
    pasteNoticeGenerationRef.current += 1
    setPasteNotice(null)
    return () => { pasteNoticeGenerationRef.current += 1 }
  }, [query, selectedId, filter, timeRange, combining, host, settings.enabled])
  const [mergeIds, setMergeIds] = useState<readonly string[]>([])
  // The selection owns its order and labels; searches and background index refreshes do not.
  const mergeItemsRef = useRef(new Map<string, ClipboardHistoryItem>())
  const [mergeSeparator, setMergeSeparator] = useState<ClipboardTextMergeSeparator>('newline')
  const [customMergeSeparator, setCustomMergeSeparator] = useState('')
  const [mergePreview, setMergePreview] = useState<ClipboardTextMergePreview | null>(null)
  const [mergeError, setMergeError] = useState<ClipboardTextMergeError | null>(null)
  const [mergeLoading, setMergeLoading] = useState(false)
  const [mergeRetry, setMergeRetry] = useState(0)
  const [mergeSuspended, setMergeSuspended] = useState(false)
  const mergeSuspendedRef = useRef(false)
  const [comparing, setComparing] = useState(false)
  const [compareBusy, setCompareBusy] = useState(false)
  const [compareNotice, setCompareNotice] = useState<string | null>(null)
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null)
  const [queueBusy, setQueueBusy] = useState(false)
  const [queueCancelling, setQueueCancelling] = useState(false)
  const [queueNotice, setQueueNotice] = useState<string | null>(null)
  const [queueObserved, setQueueObserved] = useState(false)
  const [queueReadState, setQueueReadState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const queueSubmissionRef = useRef<AbortController | null>(null)
  const queueStatusEpochRef = useRef(0)
  const queueShortcut = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌃⇧V' : 'Ctrl+Shift+V'
  const queueApi = host.historyPasteQueue
  const [queueAvailability, setQueueAvailability] = useState<'loading' | 'can-attempt' | 'unsupported' | 'unknown'>('loading')
  useEffect(() => {
    if (!queueApi) return
    let active = true
    let epoch = 0
    const owner = host.deliveryFeedbackOwner
    const refresh = () => {
      const ticket = ++epoch
      setQueueAvailability('loading')
      // Unknown/loading never enables delivery; late replies cannot revive an owner.
      void queueApi.getAvailability().then((value) => {
        if (active && ticket === epoch && owner?.isCurrent() !== false) setQueueAvailability(value)
      }).catch(() => {
        if (active && ticket === epoch && owner?.isCurrent() !== false) setQueueAvailability('unknown')
      })
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { active = false; epoch += 1; window.removeEventListener('focus', refresh) }
  }, [queueApi, host.deliveryFeedbackOwner])
  useEffect(() => {
    if (!queueApi) return
    let active = true
    let observed = false
    const owner = host.deliveryFeedbackOwner
    const isCurrent = () => active && owner?.isCurrent() !== false
    setQueueReadState('loading')
    setQueueObserved(false)
    const unsubscribe = queueApi.subscribe((status) => {
      observed = true
      queueStatusEpochRef.current += 1
      if (isCurrent()) {
        setQueueObserved(true)
        setQueueReadState('ready')
        setQueueStatus(status)
        if (status.busy || status.completed > 0 || status.phase === 'failed' || status.phase === 'cancelled') setQueueNotice(null)
      }
    })
    void Promise.resolve(queueApi.getStatus()).then((status) => {
      if (isCurrent() && !observed) {
        setQueueStatus(status)
        setQueueReadState('ready')
      }
    }).catch(() => {
      // Native visibility can replace the owner before React cleans up this effect.
      // Its cancelled read cannot mark the new owner's loading/ready state as failed.
      if (isCurrent() && !observed) setQueueReadState('failed')
    })
    return () => { active = false; unsubscribe() }
  }, [queueApi, host.deliveryFeedbackOwner])
  const compareSubmissionRef = useRef<AbortController | null>(null)
  const mergeSubmissionRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const surface = containerRef.current
    if (surface) return observeClipboardHistoryShortcutFocus(surface, setShortcutFocus)
  }, [combining])

  const invalidateMerge = useCallback((cancelSubmission = true) => {
    if (cancelSubmission) {
      queueSubmissionRef.current?.abort()
      queueSubmissionRef.current = null
      setQueueBusy(false)
      setQueueNotice(null)
      compareSubmissionRef.current?.abort()
      compareSubmissionRef.current = null
      setCompareBusy(false)
      setComparing(false)
      setCompareNotice(null)
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
    setCustomMergeSeparator('')
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
    if (!combining || mergeSuspended || mergeSuspendedRef.current || mergeIds.length < CLIPBOARD_TEXT_MERGE_MIN_ITEMS) {
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
    }, customMergeSeparator)
    return () => mergeReader.invalidate()
  }, [combining, settings.enabled, mergeIds, mergeSeparator, customMergeSeparator, mergeReader, repository, mergeRetry, mergeSuspended])

  useEffect(() => () => {
    queueSubmissionRef.current?.abort()
    queueSubmissionRef.current = null
    compareSubmissionRef.current?.abort()
    compareSubmissionRef.current = null
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
      if (!mergeSubmissionRef.current && !compareSubmissionRef.current && !queueSubmissionRef.current) {
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
    if (queueSubmissionRef.current || compareSubmissionRef.current || mergeSubmissionRef.current || !combining || mergeSuspended || mergeSuspendedRef.current || !mergePreview || !mergeReader.isCurrent(mergePreview)) return
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

  const copyMerge = useCallback(async () => {
    if (queueSubmissionRef.current || compareSubmissionRef.current || mergeSubmissionRef.current || !combining || mergeSuspendedRef.current || !mergePreview || !mergeReader.isCurrent(mergePreview)) return
    const submission = new AbortController()
    mergeSubmissionRef.current = submission
    setMergeLoading(true)
    setCompareNotice(null)
    const isCurrent = () => mergeSubmissionRef.current === submission && !submission.signal.aborted && !mergeSuspendedRef.current
    try {
      await copyClipboardTextBundle(repository,
        mergeIds.map((id) => ({ id, hash: mergeItemsRef.current.get(id)?.hash ?? '' })),
        mergeSeparator, customMergeSeparator, isCurrent,
        (text) => host.clipboard.writeText(text, { recordInHistory: false }))
      if (isCurrent()) setCompareNotice(t('merge.copied'))
    } catch (error) {
      if (isCurrent()) setCompareNotice(t(error instanceof Error && error.message === 'too-large' ? 'merge.tooLarge' : 'merge.copyFailed'))
    } finally {
      if (mergeSubmissionRef.current === submission) {
        mergeSubmissionRef.current = null
        setMergeLoading(false)
      }
    }
  }, [settings.enabled, combining, mergePreview, mergeReader, repository, mergeIds, mergeSeparator, customMergeSeparator, host, t])

  const compareHistory = useCallback(async () => {
    if (queueSubmissionRef.current || compareSubmissionRef.current || mergeSubmissionRef.current || mergeIds.length !== 2 || !host.compareHistoryTexts) return
    const submission = new AbortController()
    compareSubmissionRef.current = submission
    const owner = host.deliveryFeedbackOwner
    const isCurrent = () => compareSubmissionRef.current === submission && !submission.signal.aborted && owner?.isCurrent() !== false
    setCompareBusy(true)
    setCompareNotice(null)
    try {
      const selection = mergeIds.map((id, index) => {
        const item = mergeItemsRef.current.get(id)
        return { id, hash: item?.hash ?? '', title: t('compare.source', {
          position: index + 1,
          title: (item?.favoriteTitle || (item?.kind === 'text' ? item.preview : '') || t('merge.emptyText')).slice(0, 200),
        }) }
      })
      const snapshots = await readHistoryCompareSnapshots(repository, selection, isCurrent)
      if (!isCurrent()) return
      setComparing(true)
      const accepted = await host.compareHistoryTexts(snapshots, { signal: submission.signal })
      if (isCurrent() && !accepted) setCompareNotice(t('compare.failed'))
    } catch (error) {
      if (isCurrent()) setCompareNotice(t(error instanceof Error && error.message === 'TextTooLargeError' ? 'compare.tooLarge' : 'compare.failed'))
    } finally {
      if (compareSubmissionRef.current === submission) {
        compareSubmissionRef.current = null
        setComparing(false)
        setCompareBusy(false)
        setMergeRetry((current) => current + 1)
        requestAnimationFrame(() => searchRef.current?.focus())
      }
    }
  }, [mergeIds, settings.enabled, host, repository, t])

  const startQueue = useCallback(async () => {
    if (!queueApi || queueAvailability !== 'can-attempt' || queueSubmissionRef.current || compareSubmissionRef.current || mergeSubmissionRef.current || !combining || mergeSuspendedRef.current || mergeIds.length === 0) return
    const submission = new AbortController()
    queueSubmissionRef.current = submission
    const owner = host.deliveryFeedbackOwner
    const isCurrent = () => queueSubmissionRef.current === submission && !submission.signal.aborted && owner?.isCurrent() !== false
    const unsubscribe = owner?.subscribeInvalidation(() => submission.abort())
    setQueueBusy(true)
    setQueueNotice(null)
    try {
      const availability = await queueApi.getAvailability()
      if (!isCurrent()) return
      setQueueAvailability(availability)
      if (availability !== 'can-attempt') throw new Error('QueuePlatformUnavailableError')
      const selection = mergeIds.map((id) => ({ id, hash: mergeItemsRef.current.get(id)?.hash ?? '' }))
      const snapshots = await readClipboardQueueSnapshots(repository, selection, isCurrent)
      if (!isCurrent()) return
      const accepted = await queueApi.start(snapshots, { signal: submission.signal })
      if (!isCurrent()) return
      if (accepted) {
        const epoch = queueStatusEpochRef.current
        const status = await queueApi.getStatus()
        if (isCurrent() && epoch === queueStatusEpochRef.current) {
          setQueueStatus(status)
          if (status.phase === 'ready' && status.completed === 0 && !status.busy) setQueueNotice(t('queue.ready', { shortcut: queueShortcut }))
        }
      } else setQueueNotice(t('queue.startFailed'))
    } catch (error) {
      if (isCurrent()) {
        const message = error instanceof Error ? error.message : ''
        const key = message === 'QueueSizeError' ? 'queue.tooLarge'
          : message === 'QueuePlatformUnavailableError' ? 'queue.platformUnavailable'
          : message === 'QueueShortcutConflictError' ? 'queue.shortcutConflict'
          : 'queue.startFailed'
        setQueueNotice(t(key, { shortcut: queueShortcut }))
      }
    } finally {
      unsubscribe?.()
      if (queueSubmissionRef.current === submission) {
        queueSubmissionRef.current = null
        setQueueBusy(false)
      }
    }
  }, [queueApi, queueAvailability, settings.enabled, combining, mergeIds, repository, host, t, queueShortcut])

  const cancelQueue = useCallback(async () => {
    if (!queueApi || queueCancelling) return
    queueSubmissionRef.current?.abort()
    queueSubmissionRef.current = null
    setQueueBusy(false)
    setQueueCancelling(true)
    setQueueNotice(null)
    const owner = host.deliveryFeedbackOwner
    const isCurrent = () => owner?.isCurrent() !== false
    try {
      await queueApi.cancel()
      const epoch = queueStatusEpochRef.current
      const status = await queueApi.getStatus()
      if (isCurrent() && epoch === queueStatusEpochRef.current) setQueueStatus(status)
    } catch { if (isCurrent()) setQueueNotice(t('queue.cancelFailed')) }
    finally { setQueueCancelling(false) }
  }, [queueApi, queueCancelling, host, t])

  const [refreshEpoch, setRefreshEpoch] = useState(0)
  const [pagePath, setPagePath] = useState<{ key: string; cursors: (string | undefined)[] }>({ key: '', cursors: [undefined] })
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [scannedCount, setScannedCount] = useState(0)
  const [retentionStatus, setRetentionStatus] = useState<{ legacyProtectedCount: number; trashCount: number; migrationComplete: boolean } | null>(null)
  const [legacyDialog, setLegacyDialog] = useState(false)
  const [retentionBusy, setRetentionBusy] = useState(false)
  const criteriaKey = JSON.stringify([
    query.trim(), searchMatchMode, combining ? 'text' : filter, frequentThreshold, copiedSince ?? null,
  ])
  const cursors = pagePath.key === criteriaKey ? pagePath.cursors : [undefined]
  const pageCursor = cursors.at(-1)
  const pageIndex = cursors.length - 1
  const pageGeneration = useRef(0)
  const refreshPage = useCallback(() => setRefreshEpoch((value) => value + 1), [])
  const clearPage = useCallback(() => {
    pageGeneration.current += 1
    setPagePath({ key: '', cursors: [undefined] })
    setNextCursor(undefined)
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
    resetPage()
    setQuery(value)
  }, [resetPage])
  const toggleSearchMatchMode = useCallback(() => {
    resetPage()
    setSearchMatchMode((current) => current === 'literal' ? 'all-terms' : 'literal')
  }, [resetPage])
  const changeFilter = useCallback((value: string) => {
    const next = value as FilterKind
    resetPage()
    if (next === 'trash') setTimeRange('all')
    setFilter(next)
  }, [resetPage])
  const changeTimeRange = useCallback((value: string) => {
    if (filter === 'trash') return
    resetPage()
    setTimeRange(value as ClipboardHistoryTimeRange)
  }, [filter, resetPage])
  const changePage = useCallback((direction: 'previous' | 'next') => {
    if (syncLocalDay()) {
      clearPage()
      return
    }
    if (direction === 'previous') setPagePath({ key: criteriaKey, cursors: cursors.slice(0, -1) })
    else if (nextCursor) setPagePath({ key: criteriaKey, cursors: [...cursors, nextCursor] })
  }, [clearPage, criteriaKey, cursors, nextCursor, syncLocalDay])

  useLayoutEffect(() => {
    const generation = ++pageGeneration.current
    suspendPointerHover()
    const controller = new AbortController()
    const owner = host.deliveryFeedbackOwner
    const current = () => generation === pageGeneration.current && !controller.signal.aborted && owner?.isCurrent() !== false
    setLoading(true)
    setFullTextSearchState('loading')
    setNextCursor(undefined)
    setScannedCount(0)
    setItems([])
    const timer = window.setTimeout(() => {
      void readMatchingHistoryPage((cursor) => repository.getPage({
        query: query.trim(), matchMode: searchMatchMode,
        filter: combining ? 'text' : filter === 'favorite' ? 'favorites' : filter,
        frequentThreshold, copiedSince, cursor, limit: 100, signal: controller.signal,
      }), pageCursor, controller.signal, (count) => { if (current()) setScannedCount(count) })
        .then((page) => {
          if (!current()) return
          setItems(page.items)
          setNextCursor(page.nextCursor)
          setSelectedId((selected) => page.items.some((item) => item.id === selected) ? selected : page.items[0]?.id ?? null)
          setLoading(false)
          setFullTextSearchState('idle')
        }).catch(() => {
          if (!current()) return
          setLoading(false)
          setFullTextSearchState('error')
        })
    }, query.trim() ? 120 : 0)
    const unsubscribe = owner?.subscribeInvalidation(() => controller.abort())
    return () => { controller.abort(); window.clearTimeout(timer); unsubscribe?.() }
  }, [repository, criteriaKey, pageCursor, refreshEpoch, settings.enabled, host.deliveryFeedbackOwner, suspendPointerHover])

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

  const restoreExpired = async () => {
    const owner = host.deliveryFeedbackOwner
    if (!selectedId || retentionBusy || filter !== 'trash' || owner?.isCurrent() === false) return
    setRetentionBusy(true)
    try {
      const restored = await repository.restoreItem(selectedId)
      if (owner?.isCurrent() === false) return
      if (!restored) throw new Error('unavailable')
      setPasteNotice(t('retention.restored'))
      refreshPage()
    } catch { if (owner?.isCurrent() !== false) setPasteNotice(t('retention.failed')) }
    finally { setRetentionBusy(false) }
  }

  const enableLegacy = async () => {
    const owner = host.deliveryFeedbackOwner
    if (retentionBusy || !legacyDialog || owner?.isCurrent() === false) return
    setRetentionBusy(true)
    try {
      await repository.enableLegacyRetention(resolveClipboardHistoryRetentionMonths(settings.retentionMonths))
      if (owner?.isCurrent() === false) return
      setLegacyDialog(false)
      setPasteNotice(t('retention.legacyEnabled'))
      refreshPage()
    } catch { if (owner?.isCurrent() !== false) setPasteNotice(t('retention.failed')) }
    finally { setRetentionBusy(false) }
  }

  useEffect(() => {
    if (loading) return
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

  // Repository pages already apply the complete query and category. Never scan
  // every historical body into UI memory or filter only a local preview.
  const filteredItems = items

  useEffect(() => {
    setSelectedId((current) => {
      if (loading) return current
      if (filteredItems.length === 0) return null
      if (current && filteredItems.some((item) => item.id === current)) return current
      return filteredItems[0].id
    })
  }, [filteredItems, loading])

  const selectedItem = useMemo(
    () => filteredItems.find((i) => i.id === selectedId) ?? null,
    [filteredItems, selectedId]
  )

  const shortcutHints = getClipboardHistoryShortcuts({
    hasSelection: Boolean(selectedItem),
    loading,
    enabled: true,
    blocked: combining || filter === 'trash' || legacyDialog || Boolean(titleDialog) || Boolean(textEdit),
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
    void (filter === 'trash' ? repository.getTrashItem(selectedId) : repository.getItem(selectedId)).then((item) => {
      if (!cancelled && owner?.isCurrent() !== false && item) {
        setSelectedFullItem(item)
      }
    }).catch(() => { /* The current row can still be retried by its explicit action. */ })
    return () => { cancelled = true; unsubscribe?.() }
  }, [selectedId, repository, filter, selectedItem?.hash, host.deliveryFeedbackOwner])

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
  const [openSession] = useState(() => createHistoryOpenSession(document.visibilityState))
  useEffect(() => {
    let focusFrame: number | undefined
    const onVisibilityChange = () => {
      if (!openSession.visibilityChanged(document.visibilityState)) return
      // A standalone surface window is retained while hidden. A genuine reopen
      // starts a fresh browsing session without treating ordinary blur, dialogs,
      // or an internal preview return as a new open.
      setSearchMatchMode('literal')
      resetHistoryOpenSession({
        invalidatePasteNotice: () => { pasteNoticeGenerationRef.current += 1 },
        clearPasteNotice: () => setPasteNotice(null),
        clearSelection: () => setSelectedId(null),
        resetPage: () => setPagePath({ key: '', cursors: [undefined] }),
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
  const selectListItem = useCallback((id: string) => {
    setSelectedId(id)
    // Rows are virtualized. Their button must not own keyboard focus when a
    // subsequent native scroll unmounts it and sends focus back to the body.
    containerRef.current?.focus({ preventScroll: true })
  }, [])

  const resetBrowser = useCallback(() => {
    setQuery('')
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

  const handlePaste = useCallback(async (item: ClipboardHistoryItem, plainTextOnly = false) => {
    if (combining || textEdit || (plainTextOnly && item.kind !== 'text')) return
    const generation = ++pasteNoticeGenerationRef.current
    setPasteNotice(null)
    try {
      // Always re-read: a loaded preview can have been edited or deleted elsewhere.
      const fullItem = await repository.getItem(item.id)
      if (!fullItem) {
        if (generation === pasteNoticeGenerationRef.current) setPasteNotice(t('error.pasteFailed'))
        return
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
  }, [host, t, repository, resetBrowser, combining, textEdit])

  const resolveFullItem = useCallback(async (item: ClipboardHistoryItem) => {
    if ((item.kind === 'text' && !item.text) || (item.kind === 'image' && !item.blobId) || (item.kind === 'files' && item.paths.length === 0)) {
      return repository.getItem(item.id)
    }
    return item
  }, [repository])

  const handleCopy = useCallback(async (item: ClipboardHistoryItem) => {
    pasteNoticeGenerationRef.current += 1
    setPasteNotice(null)
    const submission = copyLifecycle.begin(() => host.deliveryFeedbackOwner?.isCurrent() !== false)
    try {
      const fullItem = await resolveFullItem(item)
      if (!submission.isCurrent()) return
      if (!fullItem) {
        host.showMessage(t('error.copyFailed'), 'error')
        return
      }
      if (fullItem.kind === 'text') {
        await host.clipboard.writeText(fullItem.text, { signal: submission.signal })
      } else if (fullItem.kind === 'image') {
        await host.clipboard.writeImage(fullItem.blobId, { signal: submission.signal })
      } else {
        await host.clipboard.writeFiles(fullItem.paths, { signal: submission.signal })
      }
      if (!submission.isCurrent()) return
      submission.commit()
      host.showMessage(t('message.copied'), 'success')
      resetBrowser()
      host.complete()
    } catch {
      if (submission.isCurrent()) host.showMessage(t('error.copyFailed'), 'error')
    } finally {
      submission.finish()
    }
  }, [copyLifecycle, host, resetBrowser, resolveFullItem, t])

  const handleSaveImage = useCallback(async (item: ClipboardHistoryItem) => {
    if (item.kind !== 'image') return
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
      if (result.status === 'saved') setPasteNotice(t('imageSave.saved'))
      else if (result.status === 'cancelled') setPasteNotice(t('imageSave.cancelled'))
      else if (result.status === 'unavailable') setPasteNotice(t('imageSave.unavailable'))
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
    if (item.kind !== 'text' || quickEditorOpen) return
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
      setQuickEditorOpen({ snapshot: result.snapshot, busy: false, error: null })
    } catch {
      if (submission.isCurrent()) setPasteNotice(t('quickEditor.error.failed'))
    } finally {
      submission.finish()
    }
  }, [host.deliveryFeedbackOwner, quickEditorLifecycle, quickEditorOpen, repository, t])

  const confirmQuickEditorOpen = useCallback(async () => {
    if (!quickEditorOpen || quickEditorOpen.busy) return
    const submission = quickEditorLifecycle.begin(host.deliveryFeedbackOwner)
    if (!submission) return
    setQuickEditorOpen({ ...quickEditorOpen, busy: true, error: null })
    try {
      const open = host.openHistoryTextInQuickEditor
      const result = open
        ? await openHistoryQuickEditorSnapshot(repository, quickEditorOpen.snapshot, open, submission)
        : { status: 'failed' as const }
      if (result.status === 'opened') {
        if (imageSaveMountedRef.current) setQuickEditorOpen(null)
        return
      }
      if (!submission.isCurrent()) return
      const errorKey = result.status === 'changed'
        ? 'quickEditor.error.changed'
        : result.status === 'unavailable'
          ? 'quickEditor.error.unavailable'
          : 'quickEditor.error.failed'
      setQuickEditorOpen({ ...quickEditorOpen, busy: false, error: t(errorKey) })
    } finally {
      submission.finish()
    }
  }, [host.deliveryFeedbackOwner, host.openHistoryTextInQuickEditor, quickEditorLifecycle, quickEditorOpen, repository, t])

  const cancelQuickEditorOpen = useCallback(() => {
    quickEditorLifecycle.cancel()
    setQuickEditorOpen(null)
  }, [quickEditorLifecycle])

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

  const openTextEdit = useCallback(async (item: ClipboardHistoryItem) => {
    if (item.kind !== 'text' || textEdit) return
    const generation = ++editGeneration.current
    pasteNoticeGenerationRef.current += 1
    try {
      const full = await repository.getItem(item.id)
      if (generation !== editGeneration.current || host.deliveryFeedbackOwner?.isCurrent() === false) return
      if (full?.kind !== 'text') throw new Error('missing')
      setTextEdit({ id: full.id, original: full.text, draft: full.text, busy: false, error: null })
    } catch {
      if (generation === editGeneration.current) setPasteNotice(t('edit.error.missing'))
    }
  }, [repository, host, textEdit, t])

  const saveTextEdit = useCallback(async () => {
    if (!textEdit || textEdit.busy || host.deliveryFeedbackOwner?.isCurrent() === false) return
    const generation = ++editGeneration.current
    setTextEdit({ ...textEdit, busy: true, error: null })
    try {
      const updated = await repository.updateText(textEdit.id, textEdit.original, textEdit.draft, settings.maxTextBytes, () => generation === editGeneration.current && host.deliveryFeedbackOwner?.isCurrent() !== false)
      if (generation !== editGeneration.current || host.deliveryFeedbackOwner?.isCurrent() === false) return
      applyItemUpdate(updated)
      setTextEdit(null)
      setPasteNotice(t('edit.saved'))
      requestAnimationFrame(() => searchRef.current?.focus())
    } catch (error) {
      if (generation !== editGeneration.current) return
      const code = error instanceof Error && ['missing', 'changed', 'tooLarge', 'duplicate'].includes(error.message) ? error.message : 'failed'
      setTextEdit({ ...textEdit, busy: false, error: t(`edit.error.${code}`) })
    }
  }, [textEdit, repository, settings.maxTextBytes, applyItemUpdate, host, t])

  const toggleQuickFavorite = useCallback(async (item: ClipboardHistoryItem) => {
    try {
      const updated = await repository.toggleFavorite(item.id)
      if (updated) applyItemUpdate(updated)
      else setPasteNotice(t('error.favoriteFailed'))
    } catch { setPasteNotice(t('error.favoriteFailed')) }
  }, [repository, applyItemUpdate, t])

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
    ...(item.kind === 'text' ? [
      { key: 'plainPaste', label: t('action.pastePlain'), onSelect: () => void handlePaste(item, true) },
      { key: 'openQuickEditor', label: t('quickEditor.action'), onSelect: () => void prepareQuickEditorOpen(item) },
      { key: 'editText', label: t('edit.action'), onSelect: () => void openTextEdit(item) },
    ] : []),
    { key: 'copy', label: t('action.copy'), onSelect: () => void handleCopy(item) },
    ...(item.kind === 'image' ? [
      { key: 'saveImage', label: t('imageSave.action'), description: `${primaryModifierLabel}S`, disabled: imageSaveBusy, onSelect: () => void handleSaveImage(item) },
    ] : []),
    { key: 'delete', label: t('action.delete'), danger: true, onSelect: () => handleDelete(item.id) },
  ], [handlePaste, handleCopy, handleSaveImage, handleDelete, imageSaveBusy, openTextEdit, prepareQuickEditorOpen, primaryModifierLabel, t])

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
    if (e.defaultPrevented || titleDialog || legacyDialog || quickEditorOpen) return
    if (textEdit) { e.stopPropagation(); return }
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
    if (filter === 'trash' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    if (!selectedItem) return
    const shortcuts = getClipboardHistoryShortcuts({
      hasSelection: true,
      loading,
      enabled: true,
      blocked: combining || filter === 'trash' || legacyDialog || Boolean(titleDialog) || Boolean(textEdit),
      focus,
    })
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.code === 'KeyP' || e.key.toLowerCase() === 'p')) {
      if (!shortcuts.paste || imeKeyDown.shouldIgnoreKeyDown(e)) return
      e.preventDefault()
      void toggleQuickFavorite(selectedItem)
    } else if (e.key === 'Enter' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      if (!shortcuts.paste || imeKeyDown.shouldIgnoreKeyDown(e)) return
      e.preventDefault()
      if (selectedItem.kind === 'text') void handlePaste(selectedItem, true)
    } else if (e.key === 'Enter' && !e.altKey && (e.metaKey || e.ctrlKey)) {
      if (!shortcuts.returnToLauncher) return
      if (imeKeyDown.shouldIgnoreKeyDown(e)) return
      e.preventDefault()
      void handleReturnToLauncher(selectedItem)
    } else if (e.key === 'Enter' && !e.altKey && !e.shiftKey) {
      if (!shortcuts.paste) return
      if (imeKeyDown.shouldIgnoreKeyDown(e)) return
      e.preventDefault()
      void handlePaste(selectedItem)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!shortcuts.delete) return
      e.preventDefault()
      handleDelete(selectedItem.id)
    } else if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
      if (!shortcuts.paste || selectedItem.kind !== 'image') return
      e.preventDefault()
      void handleSaveImage(selectedItem)
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
  }, [selectedItem, selectedId, filteredItems, flatRows, virtualizer, handlePaste, handleReturnToLauncher, handleDelete, handleCopy, handleSaveImage, host, t, imeKeyDown, combining, cancelMerge, toggleMergeItem, titleDialog, textEdit, toggleQuickFavorite, loading, settings.enabled, filter, legacyDialog, quickEditorOpen])

  const queueActive = Boolean(queueStatus && queueStatus.remaining > 0 && (queueStatus.phase === 'ready' || queueStatus.phase === 'failed'))
  const queueReadNotice = queueReadState === 'failed' ? t('queue.statusFailed') : queueReadState === 'loading' ? t('queue.statusLoading') : null
  const queueFeedback = queueApi && (queueNotice || queueActive || (queueObserved && (queueStatus?.phase === 'completed' || queueStatus?.phase === 'cancelled'))) ? (
    <div className="clipboard-history-queue-status">
      <span role="status">
        {queueNotice || (queueActive ? queueReadNotice : null) || (queueStatus?.phase === 'cancelled' ? t('queue.cancelled') : queueStatus?.phase === 'completed' ? t('queue.completed') : queueStatus?.phase === 'failed' ? t('queue.failed', { shortcut: queueShortcut, position: (queueStatus?.completed ?? 0) + 1, remaining: queueStatus?.remaining ?? 0 }) : t('queue.progress', {
          position: (queueStatus?.completed ?? 0) + 1,
          total: queueStatus?.total ?? 0,
          remaining: queueStatus?.remaining ?? 0,
          shortcut: queueShortcut,
        }))}
      </span>
      {queueActive && <>
        <span>{t('queue.snapshot')}</span>
        <Button type="button" disabled={queueCancelling} onClick={() => void cancelQueue()}>{t('queue.cancel')}</Button>
        <Button type="button" disabled={queueBusy || Boolean(textEdit)} onClick={() => host.close()}>{t('queue.returnExternal')}</Button>
      </>}
    </div>
  ) : null

  const renderContent = () => {
    if (loading) {
      return (
        <div className="clipboard-history-main">
          <div className="clipboard-history-list-pane" {...(textEdit ? { inert: true } : {})}>
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
          <div className="clipboard-history-list-pane" {...(textEdit ? { inert: true } : {})}>
            <div className="clipboard-history-list-toolbar">
              {combining ? (
                <div className="clipboard-history-merge-instruction">
                  <strong>{t('merge.chooseText')}</strong>
                </div>
              ) : <div className="clipboard-history-filter-stack">
                <SegmentedControl
                  className="clipboard-history-filter"
                  value={filter}
                  onChange={changeFilter}
                  disabled={loading || Boolean(textEdit)}
                  aria-label={t('filter.label')}
                  options={[
                    { value: 'all', label: t('filter.all') },
                    { value: 'favorite', label: t('filter.favorite') },
                    { value: 'frequent', label: t('filter.frequent') },
                    { value: 'text', label: t('filter.text') },
                    { value: 'image', label: t('filter.image') },
                    { value: 'files', label: t('filter.files') },
                    { value: 'trash', label: t('filter.trash') },
                  ]}
                />
                {filter !== 'trash' && <SegmentedControl
                  className="clipboard-history-filter clipboard-history-time-filter"
                  value={timeRange}
                  onChange={changeTimeRange}
                  disabled={loading || Boolean(textEdit)}
                  aria-label={t('filter.timeLabel')}
                  options={[
                    { value: 'all', label: t('filter.timeAll') },
                    { value: 'today', label: t('filter.today') },
                    { value: 'last7Days', label: t('filter.last7Days') },
                  ]}
                />}
              </div>}
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
                      : filter === 'frequent'
                      ? t('state.emptyFrequent')
                      : filter === 'favorite'
                        ? t('state.emptyFavorite')
                        : filter === 'trash'
                          ? t('retention.empty')
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
                            matchMode={searchMatchMode}
                            selected={row.item.id === selectedId}
                            locale={locale}
                            t={t}
                            storage={host.storage}
                            onSelect={selectListItem}
                            onPaste={handlePaste}
                            onDelete={handleDelete}
                            onFavorite={handleFavoriteClick}
                            menuItems={combining || filter === 'trash' ? [] : itemContextMenuItems(row.item)}
                            readOnly={filter === 'trash'}
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
            <SurfaceFooterHints className="clipboard-history-footer">
              <span role="status">{t('paging.page', { page: pageIndex + 1, count: items.length })}</span>
              <Button type="button" disabled={loading || pageIndex === 0 || Boolean(textEdit)} onClick={() => changePage('previous')}>{t('paging.previous')}</Button>
              <Button type="button" disabled={loading || !nextCursor || Boolean(textEdit)} onClick={() => changePage('next')}>
                {t(query.trim() && nextCursor ? 'paging.searchOlder' : 'paging.next')}
              </Button>
              {fullTextSearchState === 'error' && <Button type="button" onClick={refreshPage}>{t('paging.retry')}</Button>}
            </SurfaceFooterHints>
          </div>

          {combining ? (
            <ClipboardTextMergePanel
              ids={mergeIds}
              items={mergeItemsRef.current}
              separator={mergeSeparator}
              customSeparator={customMergeSeparator}
              onCustomSeparatorChange={(value) => { invalidateMerge(); setCustomMergeSeparator(value) }}
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
            disabled={!selectedItem || Boolean(textEdit) || filter === 'trash'}
            items={previewItem ? itemContextMenuItems(previewItem) : []}
            trigger={
              <SurfacePreview className="clipboard-history-preview" data-launcher-scrollable>
                {textEdit ? (
                  <div className="clipboard-history-text-edit">
                    <strong>{t('edit.title')}</strong>
                    <p>{t('edit.description')}</p>
                    <textarea ref={editInputRef} aria-label={t('edit.title')} value={textEdit.draft}
                      disabled={textEdit.busy} spellCheck={false}
                      onChange={(event) => setTextEdit({ ...textEdit, draft: event.target.value, error: null })}
                      onCompositionStart={imeKeyDown.onCompositionStart} onCompositionEnd={imeKeyDown.onCompositionEnd} />
                    {textEdit.error && <p role="alert">{textEdit.error}</p>}
                    <div className="clipboard-history-title-dialog-actions">
                      <Button type="button" disabled={textEdit.busy} onClick={() => void saveTextEdit()}>{t(textEdit.busy ? 'edit.saving' : 'edit.save')}</Button>
                      <Button type="button" disabled={textEdit.busy} onClick={() => { editGeneration.current += 1; setTextEdit(null); requestAnimationFrame(() => searchRef.current?.focus()) }}>{t('action.cancel')}</Button>
                    </div>
                  </div>
                ) : !previewItem ? (
                  <SurfaceEmptyState>
                    {t('preview.empty')}
                  </SurfaceEmptyState>
                ) : (
                  <>
                    {previewItem.kind === 'text' && filter !== 'trash' && <div className="clipboard-history-text-actions">
                      <ToolbarButton type="button" onClick={() => void openTextEdit(previewItem)}>{t('edit.action')}</ToolbarButton>
                      <ToolbarButton type="button" onClick={() => void handlePaste(previewItem, true)}>{t('action.pastePlain')}</ToolbarButton>
                    </div>}
                    <ClipboardHistoryPreviewContent
                      item={previewItem}
                      query={query}
                      matchMode={searchMatchMode}
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
          {queueFeedback}
          {pasteNotice ? <span role="status" style={{ color: 'var(--text-1, var(--hiven-color-text-primary))' }}>{pasteNotice}</span> : <>
            {/* Keep hint slots in layout when button focus temporarily disables shortcuts. */}
            <span style={{ visibility: shortcutHints.paste ? 'visible' : 'hidden' }} aria-hidden={!shortcutHints.paste}>↵ {t('hint.paste')}</span>
            <span style={{ visibility: shortcutHints.paste && selectedItem?.kind === 'text' ? 'visible' : 'hidden' }} aria-hidden={!shortcutHints.paste || selectedItem?.kind !== 'text'}>{modifierLabel}↵ {t('hint.pastePlain')}</span>
            <span style={{ visibility: shortcutHints.paste ? 'visible' : 'hidden' }} aria-hidden={!shortcutHints.paste}>{modifierLabel}P {t('hint.favorite')}</span>
            <span style={{ visibility: shortcutHints.returnToLauncher ? 'visible' : 'hidden' }} aria-hidden={!shortcutHints.returnToLauncher}>{typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}↵ {t('hint.returnToLauncher')}</span>
            <span style={{ visibility: shortcutHints.delete ? 'visible' : 'hidden' }} aria-hidden={!shortcutHints.delete}>⌫ {t('hint.delete')}</span>
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
      className={`clipboard-history-surface${combining ? ' is-combining' : ''}${pointerHover ? ' has-pointer-hover' : ''}`}
      onPointerMoveCapture={(event) => setPointerHover(pointerIntent.move(event.screenX, event.screenY, event.pointerType))}
      onPointerLeave={suspendPointerHover}
      onWheelCapture={suspendPointerHover}
      onKeyDownCapture={suspendPointerHover}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="clipboard-history-topbar">
        {!combining && <IconButton
          type="button"
          label={t('action.back')}
          disabled={Boolean(textEdit)}
          onClick={() => {
            setQuery('')
            setSearchMatchMode('literal')
            host.requestBack()
          }}
        >
          <BackIcon size={18} />
        </IconButton>}
        <SearchField
          ref={searchRef}
          data-plugin-surface-autofocus
          value={query}
          onChange={(e) => changeSearchQuery(e.target.value)}
          onCompositionStart={imeKeyDown.onCompositionStart}
          onCompositionEnd={imeKeyDown.onCompositionEnd}
          placeholder={t('search.placeholder')}
          disabled={Boolean(textEdit)}
        />
        <Button
          type="button"
          className="clipboard-history-search-mode"
          aria-pressed={searchMatchMode === 'all-terms'}
          disabled={Boolean(textEdit)}
          onClick={toggleSearchMatchMode}
        >
          {t('search.allTerms')}
        </Button>
        {!combining && !loading && (
          <Button type="button" disabled={Boolean(textEdit) || filter === 'trash' || retentionBusy} onClick={startMerge}>
            {t('merge.start')}
          </Button>
        )}
        {!combining && <Button
          type="button"
          variant="primary"
          disabled={!selectedItem || loading || Boolean(textEdit) || retentionBusy}
          onClick={() => filter === 'trash' ? void restoreExpired() : selectedItem && void handlePaste(selectedItem)}
        >
          {t(filter === 'trash' ? 'retention.restore' : 'action.paste')}
        </Button>}
        {!combining && <IconButton
          type="button"
          label={t('action.openSettings')}
          disabled={Boolean(textEdit)}
          onClick={() => host.openSettings({ preserveSurface: true })}
        >
          <SettingsIcon size={17} />
        </IconButton>}
        {!combining && <IconButton
          type="button"
          label={t('action.close')}
          disabled={Boolean(textEdit)}
          onClick={() => {
            mergeReader.invalidate()
            setQuery('')
            setSearchMatchMode('literal')
            host.close()
          }}
        >
          <CloseIcon size={18} />
        </IconButton>}
      </div>

      {!combining && (filter === 'trash' || (retentionStatus?.legacyProtectedCount ?? 0) > 0 || fullTextSearchState === 'loading') && <SurfaceFooterHints className="clipboard-history-footer">
        {filter === 'trash' && <span>{t('retention.trashHint')}</span>}
        {retentionStatus && retentionStatus.legacyProtectedCount > 0 && <>
          <span>{t('retention.legacyProtected', { count: retentionStatus.legacyProtectedCount })}</span>
          <Button type="button" disabled={retentionBusy || !retentionStatus.migrationComplete || Boolean(textEdit)} onClick={() => setLegacyDialog(true)}>{t('retention.enableLegacy')}</Button>
        </>}
        {fullTextSearchState === 'loading' && <span role="status">{t('paging.scanning', { count: scannedCount })}</span>}
      </SurfaceFooterHints>}

      {renderContent()}

      {combining && (
        <SurfaceFooterHints className="clipboard-history-footer clipboard-history-merge-footer">
          {queueFeedback}
          <div className="clipboard-history-merge-footer-hints">
            {compareNotice ? <span role="status">{compareNotice}</span> : <span>↵ {t('merge.toggleSelection')}</span>}
            <span>Esc {t('merge.cancel')}</span>
          </div>
          <div className="clipboard-history-merge-footer-actions">
            <Button type="button" onClick={cancelMerge}>{t('merge.cancel')}</Button>
            <Button type="button" disabled={queueBusy || mergeIds.length !== 2 || compareBusy || mergeLoading || mergeSuspended || !host.compareHistoryTexts} onClick={() => void compareHistory()}>
              {t(compareBusy ? 'compare.loading' : 'compare.action')}
            </Button>
            {queueApi && queueAvailability === 'can-attempt' && <Button type="button" disabled={queueBusy || queueCancelling || mergeIds.length === 0 || compareBusy || mergeSuspended} onClick={() => void startQueue()}>
              {t(queueBusy ? 'queue.starting' : queueActive ? 'queue.replace' : 'queue.start')}
            </Button>}
            <Button type="button" variant="primary" disabled={queueBusy || !mergePreview || mergeLoading || compareBusy || mergeSuspended} onClick={() => void copyMerge()}>
              {t('merge.copy')}
            </Button>
            <Button
              type="button"
              disabled={queueBusy || !mergePreview || mergeLoading || compareBusy || mergeSuspended}
              onClick={continueMerge}
            >
              {t('merge.continue')}
            </Button>
          </div>
        </SurfaceFooterHints>
      )}

      <ConfirmDialog
        open={Boolean(quickEditorOpen)}
        title={t('quickEditor.confirmTitle')}
        message={quickEditorOpen?.error ?? t('quickEditor.confirmMessage')}
        confirmLabel={t(quickEditorOpen?.busy ? 'quickEditor.opening' : 'quickEditor.confirm')}
        cancelLabel={t('action.cancel')}
        defaultFocus="cancel"
        onConfirm={() => { void confirmQuickEditorOpen() }}
        onCancel={() => { if (!quickEditorOpen?.busy) cancelQuickEditorOpen() }}
      />

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

  // A real modal owns focus and Escape through the shared surface contract in
  // both Launcher and independent windows. The history underneath is unchanged.
  if (comparing) return null
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
  combining,
  mergePosition,
  mergeLimitReached,
  onToggleMerge,
  readOnly,
}: {
  item: ClipboardHistoryItem
  query: string
  matchMode: ClipboardHistorySearchMatchMode
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
  readOnly: boolean
  mergePosition: number
  mergeLimitReached: boolean
  onToggleMerge: (item: ClipboardHistoryItem) => void
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
      disabled={combining || readOnly}
      items={menuItems}
      trigger={
        <div
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
            onDoubleClick={() => { if (!combining && !readOnly) void onPaste(item) }}
          >
            {combining ? (
              <span className="clipboard-history-merge-check" aria-hidden="true">
                {mergePosition >= 0 ? mergePosition + 1 : ''}
              </span>
            ) : renderItemMedia(item, storage)}
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
          {!combining && !readOnly && <>
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
    rows.push({ label: t('retention.label'), value: t('retention.favoriteExempt') })
  }
  if (item.legacyProtected) rows.push({ label: t('retention.label'), value: t('retention.protectedItem') })
  if (item.purgeAfter) rows.push({ label: t('retention.restoreUntil'), value: new Intl.DateTimeFormat(resolveIntlLocale(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.purgeAfter)) })

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
