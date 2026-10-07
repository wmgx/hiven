import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store'
import { useShallow } from 'zustand/react/shallow'
import { t, pickLocale } from '../../i18n'
import { usePluginRegistryVersion } from '../../workspace/pluginRegistry'
import { usePluginSettingsStore } from '../../workspace/pluginSettingsStore'
import { useGlobalLauncherResultFrame } from '../../components/launcher/GlobalLauncherResults'
import { buildGlobalLauncherItems, type GlobalLauncherItem } from '../../components/launcher/GlobalLauncherItems'
import { buildGlobalLauncherPanelStyle } from '../../components/launcher/GlobalLauncherLayout'
import { usePluginPermissionStore } from '../../workspace/pluginPermissions'
import { useLauncherSession } from '../../workspace/launcher/useLauncherSession'
import { useGlobalLauncherSurfaceRegistry } from '../../components/launcher/GlobalLauncherSurfaceRegistry'
import { useAutoCloseStandaloneLauncherOnBackgroundIdle, useCloseStandaloneLauncherOnBlur, useFocusGlobalLauncherSurfaceShell, useGlobalLauncherNativeDrag, useStandaloneLauncherResize } from '../../components/launcher/GlobalLauncherWindowLifecycle'
import { isStandaloneLauncherWindow, useGlobalLauncherCollectInputPreview, useGlobalLauncherFocusSession, useGlobalLauncherHostEscape, useGlobalLauncherImeComposition } from '../../components/launcher/GlobalLauncherHostLifecycle'
import { closeGlobalLauncherWindow } from '../../components/launcher/GlobalLauncherClose'
import { isWorkflowObjectLauncherItem } from '../../components/launcher/GlobalLauncherSelection'
import { useGlobalLauncherSurfaceFrame } from '../../components/launcher/GlobalLauncherSurfaceFrame'
import { readLauncherClipboard } from '../clipboard/readLauncherClipboard'
import { GlobalLauncherPanel } from '../../components/launcher/GlobalLauncherPanel'
import { useGlobalLauncherSelectionController } from '../../components/launcher/useGlobalLauncherSelectionController'
import { useClipboardObjectBlock } from '../clipboard/useClipboardObjectBlock'
import { getObjectBlockRecommendationText } from '../clipboard/objectBlock'
import { subscribePendingObjectBlock } from '../clipboard/pendingObjectBlock'
import { executeRecommendedAction } from '../clipboard/actionExecutor'
import { recommendActionsForBlock, type RecommendedAction, type RecommendedOutputTarget } from '../clipboard/actionRecommendation'
import { createPluginClipboard, writeClipboardText } from '../../workspace/pluginClipboard'
import { createGlobalLauncherPluginApi } from '../clipboard/globalLauncherApi'
import type { LauncherExecuteResult } from '../../workspace/launcher/types'
import { createPluginPaste } from '../../workspace/pluginPaste'
import { createPluginPrivateStorage } from '../../workspace/pluginStorage'
import { createQuickEditorPane } from '../../workspace/quickEditor/quickEditorRequests'
import { openExternalUrl } from '../../workspace/effectRunner'
import type { PluginSettingsSource } from '../../workspace/pluginSettingsStore'
import { restoreLauncherInputSource } from '../../workspace/windowManager/launcherWindow'
import { getHostSurfaceShell } from '../../components/launcher/hostSurfaceShell'
import { endLauncherPerfOpenSession, logLauncherPerf } from '../../workspace/launcher/perf'
import {
  TelemetryEvents,
  createDebouncedTracker,
  queryTelemetryProps,
  trackBehavior,
  trackLatencyFrom,
  telemetryNow,
} from '../../workspace/telemetry'
import type { LauncherItem } from '../../workspace/launcher/types'
import { getPluginPermissionSnapshot } from '../../workspace/pluginPermissions'
import { showToast } from '../../workspace/toast'
import { selectLauncherVisibleItems } from '../../workspace/launcher/visibleItems'

export function GlobalLauncherHost() {
  const {
    open,
    overlay,
    locale,
    pluginSurfaceToolTarget,
    launcherHostSurfaceTarget,
  } = useAppStore(useShallow((s) => ({
    open: s.globalLauncherOpen,
    overlay: s.globalLauncherOverlay,
    locale: s.locale,
    pluginSurfaceToolTarget: s.pluginSurfaceToolTarget,
    launcherHostSurfaceTarget: s.launcherHostSurfaceTarget,
  })))
  const setOpen = useAppStore((s) => s.setGlobalLauncherOpen)
  const clearPluginSurfaceTool = useAppStore((s) => s.clearPluginSurfaceTool)
  const clearLauncherHostSurface = useAppStore((s) => s.clearLauncherHostSurface)
  const pluginRegistryVersion = usePluginRegistryVersion()
  const grantPluginPermissions = usePluginPermissionStore((s) => s.grantPermissions)
  const settingsDialogTarget = usePluginSettingsStore((s) => s.settingsDialogTarget)
  const closeSettingsDialog = usePluginSettingsStore((s) => s.closeSettingsDialog)
  const closeAfterActionRef = useRef<() => void>(() => {})
  const focusSearchInputAfterBackRef = useRef<() => void>(() => {})
  const isKeyboardNavRef = useRef(false)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const visibleSelectionItemsRef = useRef<readonly LauncherItem[]>([])
  const [selectedObjectActionIndex, setSelectedObjectActionIndex] = useState(0)
  const [browsingActions, setBrowsingActions] = useState(false)
  const launcherFavoriteKeys = useAppStore((s) => s.launcherFavoriteKeys)
  const objectActionControllerRef = useRef<{ expand: () => void; execute: (keepOpen?: boolean) => void } | null>(null)
  const { isImeComposingRef, handleCompositionStart, handleCompositionEnd } = useGlobalLauncherImeComposition()
  const standaloneLauncher = isStandaloneLauncherWindow()
  const launcherSettingsTarget = settingsDialogTarget?.presentation === 'global-launcher'
    ? settingsDialogTarget
    : null
  const hostSurfaceTarget = launcherHostSurfaceTarget

  // Live query for suppress gate (session is declared below; ref stays current each render).
  const liveQueryRef = useRef('')
  const clipboardBlock = useClipboardObjectBlock({
    open,
    readClipboard: readLauncherClipboard,
    // Do not replace an in-progress query with clipboard suggestions.
    suppressAutoAttach: () => (
      Boolean(liveQueryRef.current.trim())
      || Boolean(inputRef.current?.value?.trim())
    ),
  })
  // Recommendations while block is mounted (exit keeps mode stable to avoid ranking jank).
  const objectBlockText = getObjectBlockRecommendationText(clipboardBlock.block)
  const [foregroundApp, setForegroundApp] = useState<string | undefined>()

  const {
    query,
    rankingQuery,
    setQuery,
    selectedIndex,
    setSelectedIndex,
    controller,
    controllerRef,
    controllerState,
    rankedItems: rankedLauncherItems,
    availableItems: availableLauncherItems,
    nearbySaveItem: nearbySaveDomainItem,
    syncSelection,
    reset: resetSession,
  } = useLauncherSession({
    hostId: 'global-launcher',
    open,
    requestClose: () => closeAfterActionRef.current(),
    collectDynamicWhenEmpty: true,
    objectBlockText,
    foregroundApp,
    makeApi: createGlobalLauncherPluginApi,
    visibleSelectionItemsRef,
  })
  const nearbySaveItem = useMemo(() => nearbySaveDomainItem ? buildGlobalLauncherItems({
    rankedLauncherItems: [nearbySaveDomainItem], query: '', locale,
  })[0] : undefined, [nearbySaveDomainItem, locale])
  liveQueryRef.current = query
  const editMaterial = () => {
    const active = controllerRef.current
    if (!useAppStore.getState().globalLauncherOpen || !active || active.getState().busy || active.getState().frames.length > 1) return
    const draft = clipboardBlock.beginTextEdit()
    if (!draft) return
    const item: LauncherItem = {
      systemKey: 'host:object-block:edit-text',
      kind: 'host',
      display: { title: t(locale, 'palette.objectBlockEdit') },
      behavior: { type: 'collect-input', input: { allowEmptyInput: true } },
      initialInputText: draft.text,
      materialTextEdit: true,
      experienceRecord: false,
      recordUsage: false,
      execute: ({ input }) => {
        if (!useAppStore.getState().globalLauncherOpen || !draft.commit(input?.text ?? '')) {
          return { ok: false, message: t(locale, 'palette.objectBlockEditExpired') }
        }
        return { ok: true, keepOpen: true }
      },
    }
    void active.selectItem(item, { recordUsage: false })
  }
  // An explicit content handoff starts a new command search; ordinary Back keeps it.
  useEffect(() => subscribePendingObjectBlock(() => {
    setQuery('')
    setBrowsingActions(false)
  }), [setQuery])
  const trackQueryChangeRef = useRef(
    createDebouncedTracker(TelemetryEvents.launcherQueryChange, 280),
  )
  useEffect(() => {
    if (!open) {
      trackQueryChangeRef.current.cancel()
      return
    }
    // Debounced typing signal for behavior funnel (not every keystroke).
    trackQueryChangeRef.current(queryTelemetryProps(query))
  }, [open, query])

  const objectActions = useMemo(() => {
    if (!clipboardBlock.block) return []
    return recommendActionsForBlock(clipboardBlock.block)
  }, [clipboardBlock.block])

  // Keep the panel tree warm after the first open so later hotkeys do not pay a
  // full remount (was ~190–300ms open:event-to-first-paint on every show).
  // Adjust during render (not useEffect) so the first open mounts in the same commit.
  const [panelMounted, setPanelMounted] = useState(false)
  if (open && !panelMounted) {
    setPanelMounted(true)
  }

  useEffect(() => {
    if (!open) {
      // Close ends the perf open session so agents can bound NDJSON by openId.
      endLauncherPerfOpenSession({ reason: 'launcher-closed' })
      return
    }
    trackBehavior(TelemetryEvents.launcherOpen, { host: 'global-launcher' })
    // Measure in the next task after the first render opportunity. Avoid a
    // second rAF: hidden-to-visible WKWebViews can throttle it for ~500ms even
    // after the launcher is accepting input. This is not a pixel-present probe.
    let paintTimer = 0
    const raf = requestAnimationFrame(() => {
      paintTimer = window.setTimeout(() => {
        const t0 = (window as unknown as { __hivenLauncherOpenT0?: number }).__hivenLauncherOpenT0
        if (typeof t0 !== 'number') return
        ;(window as unknown as { __hivenLauncherOpenT0?: number }).__hivenLauncherOpenT0 = undefined
        const durationMs = Math.round((performance.now() - t0) * 10) / 10
        logLauncherPerf('open:event-to-first-paint', {
          kind: 'latency',
          durationMs,
        })
        trackLatencyFrom(TelemetryEvents.launcherFirstPaint, t0)
      }, 0)
    })
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(paintTimer)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setForegroundApp(undefined)
      return
    }
    // Defer after first paint — AppKit foreground lookup must not delay show.
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
            if (!cancelled) setForegroundApp(undefined)
            return
          }
          const { invoke } = await import('@tauri-apps/api/core')
          const foreground = await invoke<{ appName?: string | null } | null>('current_foreground_app_context')
          if (cancelled) return
          const name = foreground?.appName?.trim()
          setForegroundApp(name || undefined)
        } catch {
          if (!cancelled) setForegroundApp(undefined)
        }
      })()
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open])

  useEffect(() => {
    // Native show_launcher already switches to English IME before show.
    // Frontend must NOT call prepare again (duplicate TIS on main thread).
    // Restore previous input source only when leaving the open state.
    if (!open) return
    return () => {
      void restoreLauncherInputSource().catch((error) => {
        console.warn('[hiven] Failed to restore launcher input source:', error)
      })
    }
  }, [open])

  useEffect(() => {
    setSelectedObjectActionIndex((index) => Math.min(index, Math.max(0, objectActions.length - 1)))
  }, [objectActions.length])

  const {
    surfaceFrame,
    setSurfaceFrame,
    activeSurfaceFrame,
    surfaceFocusVersion,
    openPluginSurface,
    leaveSurface,
    requestSurfaceBack,
    requestSurfaceClose,
  } = useGlobalLauncherSurfaceFrame({
    open,
    pluginRegistryVersion,
    pluginSurfaceToolTarget,
    closeLauncher: () => closeAfterActionRef.current(),
    // ESC/back pops the tool surface; keep the launcher open and refocus search.
    onReturnedToList: () => focusSearchInputAfterBackRef.current(),
  })

  // Root list + collect-input keep the caret; result/param/surface own their own focus.
  const retainSearchFocus = useMemo(() => {
    if (surfaceFrame || launcherSettingsTarget || hostSurfaceTarget) return false
    const top = controllerState?.frames[controllerState.frames.length - 1]
    if (!top || top.kind === 'list') return true
    if (top.kind === 'collect-input') return true
    return false
  }, [controllerState, hostSurfaceTarget, launcherSettingsTarget, surfaceFrame])

  const { restoreFocus, focusSearchInputAfterBack, bindSearchInputRef } = useGlobalLauncherFocusSession({
    open,
    inputRef,
    setQuery,
    setSelectedIndex,
    retainSearchFocus,
  })

  useEffect(() => {
    focusSearchInputAfterBackRef.current = focusSearchInputAfterBack
  }, [focusSearchInputAfterBack])

  useGlobalLauncherSurfaceRegistry({
    open,
    standaloneLauncher,
    launcherSettingsTarget,
    hostSurfaceTarget: hostSurfaceTarget as never,
    surfaceFrame,
    activeSurfaceFrame,
    controllerReset: useCallback(() => {
      setSurfaceFrame(null)
      controllerRef.current?.reset()
    }, [controllerRef]),
  })

  // Ranking and execution share the live query snapshot.
  const rankedVisible = useMemo(() => {
    void pluginRegistryVersion
    return buildGlobalLauncherItems({
      rankedLauncherItems,
      query: rankingQuery,
      locale,
    })
  }, [locale, pluginRegistryVersion, rankingQuery, rankedLauncherItems])

  /**
   * Object Block host rows pinned near the top of the composed list.
   *
   * Ranking / textMatch no longer shows static recommendActionsForBlock entries
   * (RecommendedActionRow UI is disabled). History keeps paste/copy/open rows;
   * any other text-bearing block always pins "Open in Quick Editor" so overwrite
   * is one Enter away.
   */
  const pinnedObjectActionItems = useMemo((): GlobalLauncherItem[] => {
    const block = clipboardBlock.block
    if (!block) return []

    const q = rankingQuery.trim().toLowerCase()
    const hasText = Boolean((block.payloadText ?? block.preview)?.length)
    const isMedia = block.kind === 'image' || block.kind === 'files'

    let actions: RecommendedAction[]
    if (block.source === 'history-item') {
      actions = objectActions
    } else if (hasText && !isMedia) {
      // Prefer catalog open-editor actions; fall back to a host-owned pin.
      const openEditorActions = objectActions.filter((action) => action.defaultOutput === 'open-editor')
      actions = openEditorActions.length > 0
        ? openEditorActions
        : [{
            id: 'open-in-quick-editor',
            title: 'Open in Quick Editor',
            titleZh: '打开到快捷编辑器',
            provider: 'Quick Editor',
            defaultOutput: 'open-editor',
          }]
    } else {
      return []
    }

    const kindLabel =
      block.kind === 'image'
        ? { en: 'Image', zh: '图片' }
        : block.kind === 'files'
          ? { en: 'Files', zh: '文件' }
          : block.source === 'history-item'
            ? { en: 'History', zh: '历史' }
            : block.source === 'tool-result'
              ? { en: 'Result', zh: '结果' }
              : { en: 'Clipboard', zh: '剪贴板' }

    return actions
      .filter((action) => {
        if (!q) return true
        return (
          action.title.toLowerCase().includes(q) ||
          action.titleZh.toLowerCase().includes(q) ||
          action.id.toLowerCase().includes(q)
        )
      })
      .map((action) => {
        const title = pickLocale(locale, action.titleZh, action.title)
        const domainItem: LauncherItem = {
          systemKey: `object-action:${action.id}`,
          kind: 'host',
          display: {
            title,
            titleI18n: { en: action.title, zh: action.titleZh },
            subtitle: action.provider,
            kindLabel: kindLabel.en,
            kindLabelI18n: kindLabel,
          },
          behavior: { type: 'perform' },
          execute: async () => ({ ok: true }),
        }
        return {
          kind: 'domain' as const,
          id: domainItem.systemKey,
          title,
          subtitle: action.provider ?? '',
          domainItem,
        }
      })
  }, [clipboardBlock.block, locale, objectActions, rankingQuery])

  const composedRankedItems = useMemo(() => {
    if (
      !objectBlockText
      || clipboardBlock.block?.source === 'history-item'
      || rankedVisible.length === 0
    ) {
      return [...pinnedObjectActionItems, ...rankedVisible]
    }
    // The best content-aware recommendation should beat the generic editor fallback.
    return [rankedVisible[0], ...pinnedObjectActionItems, ...rankedVisible.slice(1)]
  }, [clipboardBlock.block?.source, objectBlockText, pinnedObjectActionItems, rankedVisible])
  const availableItems = useMemo(() => [
    ...pinnedObjectActionItems,
    ...buildGlobalLauncherItems({ rankedLauncherItems: availableLauncherItems, query: rankingQuery, locale }),
  ], [availableLauncherItems, locale, pinnedObjectActionItems, rankingQuery])
  const availableItemKeys = useMemo(() => new Set(availableItems.map((item) => item.id)), [availableItems])
  const visibleFiltered = useMemo(() => selectLauncherVisibleItems({
    rankedItems: composedRankedItems,
    availableItems,
    favoriteKeys: launcherFavoriteKeys,
    query: rankingQuery,
    browse: browsingActions,
    keyOf: (item: GlobalLauncherItem) => item.id,
  }), [availableItems, browsingActions, composedRankedItems, launcherFavoriteKeys, rankingQuery])
  const visibleSelectionItems = useMemo(
    () => visibleFiltered.map((item) => item.domainItem),
    [visibleFiltered],
  )
  visibleSelectionItemsRef.current = visibleSelectionItems
  useEffect(() => syncSelection(), [syncSelection, visibleSelectionItems])

  /**
   * Primitive resize trigger — controllerState object identity changes every setState.
   * For collect-input live preview: only signal empty vs has-preview (not each keystroke /
   * each preview text), so native window does not thrash while results replace in place.
   */
  const controllerResizeKey = useMemo(() => {
    if (!controllerState) return 'idle'
    const top = controllerState.frames[controllerState.frames.length - 1]
    const topKind = top?.kind ?? 'none'
    const previewSignal = top?.kind === 'collect-input'
      ? `:${top.inputText.trim() ? 1 : 0}:${top.previewOutput?.choices?.length ? 1 : 0}`
      : ''
    return `${controllerState.busy ? 1 : 0}:${controllerState.frames.length}:${topKind}:${controllerState.error ?? ''}${previewSignal}`
  }, [controllerState])

  // Guard duplicate dismissals while the native window is hiding.
  const closingRef = useRef(false)
  // Native paste closes/reset the launcher before its outcome arrives. Retain
  // feedback for that closed session, only until another controller state/open.
  const previewPasteCloseRef = useRef<{
    isCurrent: () => boolean
    isClosedCurrent?: () => boolean
  } | null>(null)

  const resetLauncherSession = useCallback(() => {
    clipboardBlock.markBlockConsumed()
    clearPluginSurfaceTool()
    clearLauncherHostSurface()
    // Drop any suspended host (e.g. quick-editor under Diff) when fully closing.
    useAppStore.setState({ previousLauncherHostSurfaceTarget: null })
    setSurfaceFrame(null)
    setItemPermissionFrame(null)
    if (usePluginSettingsStore.getState().settingsDialogTarget?.presentation === 'global-launcher') {
      closeSettingsDialog()
    }
    setSelectedObjectActionIndex(0)
    setBrowsingActions(false)
    isImeComposingRef.current = false
    resetSession()
  }, [clipboardBlock.markBlockConsumed, clearLauncherHostSurface, clearPluginSurfaceTool, closeSettingsDialog, isImeComposingRef, resetSession])

  const closeSession = useCallback((reason: 'esc-or-overlay' | 'blur' | 'after-action') => {
    const completed = reason === 'after-action'
    if (closingRef.current) return
    closingRef.current = true
    trackBehavior(TelemetryEvents.launcherClose, {
      reason,
      ...queryTelemetryProps(inputRef.current?.value ?? query),
    })
    resetLauncherSession()
    void closeGlobalLauncherWindow({
      standaloneLauncher,
      overlay,
      hideOverlayWindow: !completed,
      restoreFocus,
      setOpen,
      restoreForeground: reason === 'blur' ? 'never' : 'auto',
    }).finally(() => {
      // Validation stays visible, so there is no false→true open edge to reset this guard.
      if (window.__HIVEN_WEB_NATIVE_BRIDGE__) closingRef.current = false
    })
  }, [overlay, query, resetLauncherSession, restoreFocus, setOpen, standaloneLauncher])

  const closeLauncher = useCallback(() => closeSession('esc-or-overlay'), [closeSession])
  const closeLauncherOnBlur = useCallback(() => closeSession('blur'), [closeSession])
  const closeLauncherAfterAction = useCallback(() => closeSession('after-action'), [closeSession])

  const leaveHostSurface = useCallback(() => {
    clearLauncherHostSurface()
    focusSearchInputAfterBack()
  }, [clearLauncherHostSurface, focusSearchInputAfterBack])

  const closeHostSurface = closeLauncher

  useEffect(() => {
    closeAfterActionRef.current = closeLauncherAfterAction
  }, [closeLauncherAfterAction])

  useCloseStandaloneLauncherOnBlur({
    open,
    standaloneLauncher,
    closeOnBlur: getHostSurfaceShell(launcherHostSurfaceTarget)?.closeOnBlur
      ?? activeSurfaceFrame?.surface.shell?.closeOnBlur,
    closeLauncher: closeLauncherOnBlur,
  })

  // Surfaces with closeOnBlur:false can stay open after app switch; exit if
  // the standalone window has not been foreground for STANDALONE_SURFACE_BACKGROUND_IDLE_MS.
  useAutoCloseStandaloneLauncherOnBackgroundIdle({
    open,
    standaloneLauncher,
    closeLauncher,
  })

  // -1 focuses the recent-clipboard hint row (30s–2 min) above the command list.
  const hasClipboardHint = Boolean(clipboardBlock.hint && !clipboardBlock.block)
  const minSelectedIndex = hasClipboardHint ? -1 : 0
  const maxSelectedIndex = Math.max(0, visibleFiltered.length - 1)
  const clampedSelectedIndex = Math.min(Math.max(selectedIndex, minSelectedIndex), maxSelectedIndex)
  const selectedItem = clampedSelectedIndex < 0
    ? undefined
    : visibleFiltered.length === 1
      ? visibleFiltered[0]
      : visibleFiltered[clampedSelectedIndex]
  const activeResultFrame = controllerState?.frames.length
    ? controllerState.frames[controllerState.frames.length - 1]
    : null
  const {
    resultSelectedIndex,
    setResultSelectedIndex,
    selectedResultChoiceIds,
    activateResultChoice,
    activateSecondaryAction,
    toggleResultChoice,
  } = useGlobalLauncherResultFrame({
    controller,
    activeResultFrame: activeResultFrame?.kind === 'result' ? activeResultFrame : null,
  })

  useEffect(() => {
    if (activeResultFrame?.kind === 'result') {
      requestAnimationFrame(() => panelRef.current?.focus())
    }
  }, [activeResultFrame?.kind])

  useGlobalLauncherCollectInputPreview({
    open,
    controllerState,
    controllerRef,
    inputRef,
  })

  useStandaloneLauncherResize({
    open,
    standaloneLauncher,
    panelRef,
    hostSurfaceTarget: hostSurfaceTarget as never,
    launcherSettingsTarget,
    surfaceShell: activeSurfaceFrame?.surface.shell,
    visibleFilteredLength: visibleFiltered.length,
    controllerResizeKey,
  })

  const {
    itemPermissionFrame,
    setItemPermissionFrame,
    selectItem,
    grantItemPermissionsAndRun,
    cancelItemPermissionPrompt,
  } = useGlobalLauncherSelectionController({
    controllerRef,
    standaloneLauncher,
    overlay,
    restoreFocus,
    setOpen,
    clearPluginSurfaceTool,
    openPluginSurface,
    grantPluginPermissions: grantPluginPermissions as never,
    focusSearchInputAfterBack,
    objectBlockText: clipboardBlock.block?.payloadText ?? undefined,
    locale,
  })

  // Reset synchronously on external closes, before the hidden WebView can throttle React.
  useEffect(() => useAppStore.subscribe((state, previous) => {
    if (!previous.globalLauncherOpen && state.globalLauncherOpen) {
      closingRef.current = false
    } else if (previous.globalLauncherOpen && !state.globalLauncherOpen && !closingRef.current) {
      closingRef.current = true
      const pendingPaste = previewPasteCloseRef.current
      const wasCurrentPaste = pendingPaste?.isCurrent()
      resetLauncherSession()
      if (pendingPaste && wasCurrentPaste) {
        const closedController = controllerRef.current
        const closedState = closedController?.getState()
        pendingPaste.isClosedCurrent = () => !useAppStore.getState().globalLauncherOpen &&
          controllerRef.current === closedController && closedController?.getState() === closedState
      }
    }
  }), [controllerRef, resetLauncherSession])

  const leaveActionBrowser = useCallback(() => {
    if (!browsingActions) return false
    setBrowsingActions(false)
    setSelectedIndex(0, { pin: false })
    focusSearchInputAfterBack()
    return true
  }, [browsingActions, focusSearchInputAfterBack, setSelectedIndex])

  useGlobalLauncherHostEscape({
    open,
    isImeComposingRef,
    controllerRef,
    closeLauncher,
    focusSearchInputAfterBack,
    onRootBack: leaveActionBrowser,
  })


  const executeObjectAction = useCallback(async (action: RecommendedAction, target: RecommendedOutputTarget) => {
    const block = clipboardBlock.block
    if (!block) return
    const startedAt = telemetryNow()
    trackBehavior(TelemetryEvents.objectActionExecute, {
      actionId: action.id,
      target,
      blockKind: block.kind,
      blockSource: block.source,
    })

    // History image/files blobs live in clipboard-history private storage
    const historyPermissions = getPluginPermissionSnapshot('builtin', 'clipboard-history', [
      'clipboard.write',
      'clipboard.image',
      'clipboard.files',
      'storage.private',
      'storage.blob',
      'accessibility.paste',
    ])
    const historyStorage = createPluginPrivateStorage('builtin', 'clipboard-history', historyPermissions)
    const historyClipboard = createPluginClipboard('clipboard-history', historyPermissions, historyStorage)
    const historyPaste = createPluginPaste(historyPermissions, historyStorage)

    const result = await executeRecommendedAction({ block, action, target }, {
      copyText: writeClipboardText,
      copyAndKeepOpen: writeClipboardText,
      openInEditor: async (text, options) => {
        const { overwriteQuickEditorText } = await import('../../workspace/quickEditor/quickEditorRequests')
        await overwriteQuickEditorText(text, {
          language: options?.language,
          source: block.source,
        })
      },
      openPluginSurface: async (pluginId, options) => {
        await openPluginSurface({
          source: 'builtin' as PluginSettingsSource,
          pluginId,
          surfaceId: 'main',
          initialText: options?.initialText,
        })
      },
      readLocalFileText: async (path) => {
        const { invoke } = await import('@tauri-apps/api/core')
        return invoke<string>('read_file', { path })
      },
      openUrl: async (url) => {
        await openExternalUrl(url)
      },
      replaceSelection: async (text) => {
        await createQuickEditorPane({ text })
      },
      newPane: async (text, options) => {
        await createQuickEditorPane({ text, language: options?.language })
      },
      insertBelow: async (text) => {
        await createQuickEditorPane({ text })
      },
      openBottomPanel: async (actionId, text) => {
        await createQuickEditorPane({ text: `${actionId}\n\n${text}` })
      },
      setRenderer: async (actionId, text) => {
        await createQuickEditorPane({ text: `${actionId}\n\n${text}` })
      },
      pasteText: async (text) => {
        const pasteResult = await historyPaste.pasteText(text)
        if (!pasteResult.ok) {
          if (pasteResult.fallback === 'copied') {
            showToast(pasteResult.message || pickLocale(locale, '已复制到剪贴板', 'Copied to clipboard'), 'info')
            return
          }
          throw new Error(pasteResult.message || 'Paste text failed')
        }
      },
      pasteImage: async (blobId) => {
        const pasteResult = await historyPaste.pasteImage(blobId)
        if (!pasteResult.ok) {
          if (pasteResult.fallback === 'copied') {
            showToast(pasteResult.message || pickLocale(locale, '已复制到剪贴板', 'Copied to clipboard'), 'info')
            return
          }
          throw new Error(pasteResult.message || 'Paste image failed')
        }
      },
      writeImage: async (blobId) => {
        await historyClipboard.writeImage(blobId)
      },
      pasteFiles: async (paths) => {
        const pasteResult = await historyPaste.pasteFiles(paths)
        if (!pasteResult.ok) {
          if (pasteResult.fallback === 'copied') {
            showToast(pasteResult.message || pickLocale(locale, '已复制到剪贴板', 'Copied to clipboard'), 'info')
            return
          }
          throw new Error(pasteResult.message || 'Paste files failed')
        }
      },
    })

    trackLatencyFrom(TelemetryEvents.objectActionLatency, startedAt, {
      actionId: action.id,
      target,
      ok: result.ok,
      blockKind: block.kind,
    })

    if (!result.ok) {
      showToast(result.error, 'error')
      return
    }

    if (result.ok && target !== 'copy-and-keep-open') {
      // Navigation into another Launcher surface is continuation, not completion.
      if (target === 'open-plugin-surface' || useAppStore.getState().launcherHostSurfaceTarget) {
        clipboardBlock.markBlockConsumed()
        setQuery('')
      } else {
        closeLauncherAfterAction()
      }
    }
  }, [clipboardBlock.block, clipboardBlock.markBlockConsumed, closeLauncherAfterAction, locale, openPluginSurface, setQuery])

  const selectItemWithObjectActions = useCallback((item: GlobalLauncherItem) => {
    // Support both current prefix and the retired history-only prefix.
    const objectActionId = item.id.startsWith('object-action:')
      ? item.id.slice('object-action:'.length)
      : item.id.startsWith('history-object-action:')
        ? item.id.slice('history-object-action:'.length)
        : null
    if (objectActionId != null) {
      const fromCatalog = objectActions.find((entry) => entry.id === objectActionId)
      const action: RecommendedAction = fromCatalog ?? {
        id: objectActionId,
        title: 'Open in Quick Editor',
        titleZh: '打开到快捷编辑器',
        provider: 'Quick Editor',
        defaultOutput: 'open-editor',
      }
      void executeObjectAction(action, action.defaultOutput)
      return
    }
    selectItem(item)
  }, [executeObjectAction, objectActions, selectItem])

  const pastePreviewText = useCallback(async (text: string, isCurrent: () => boolean): Promise<LauncherExecuteResult> => {
    const startedAt = telemetryNow()
    trackBehavior(TelemetryEvents.pasteText, { textLength: text.length, via: 'result-preview' })
    const pendingPaste: { isCurrent: () => boolean; isClosedCurrent?: () => boolean } = { isCurrent }
    previewPasteCloseRef.current = pendingPaste
    try {
      const result = await createPluginPaste().pasteText(text)
      trackLatencyFrom(TelemetryEvents.pasteLatency, startedAt, {
        ok: result.ok,
        textLength: text.length,
        via: 'result-preview',
      })
      if (!result.ok) {
        const message = result.message || t(locale, 'palette.quickEntryError')
        if (result.fallback !== 'copied') return { ok: false, message }
        if (isCurrent() || pendingPaste.isClosedCurrent?.()) showToast(message, 'info')
      }
      return { ok: true }
    } finally {
      if (previewPasteCloseRef.current === pendingPaste) previewPasteCloseRef.current = null
    }
  }, [locale])

  const beginDrag = useGlobalLauncherNativeDrag(standaloneLauncher)

  // The launcher is always horizontally centered. In the standalone window the
  // window itself is positioned natively (see `center_launcher_window`); here
  // the panel just centers within whatever window renders it.
  const panelStyle = buildGlobalLauncherPanelStyle({
    hostSurfaceTarget: hostSurfaceTarget as never,
    launcherSettingsTarget,
    surfaceShell: activeSurfaceFrame?.surface.shell,
    standaloneLauncher,
  })

  useFocusGlobalLauncherSurfaceShell({
    panelRef,
    surfaceFrame,
    launcherSettingsTarget,
    hostSurfaceTarget,
    surfaceFocusVersion,
  })

  // Cold start: stay unmounted until first open. After that, hide with CSS so
  // the next hotkey reuses the React tree (input, list rows, icons).
  if (!panelMounted) return null

  return (
    <div
      className={`fixed inset-0 palette-overlay global-launcher-overlay${open ? ' open' : ''}`}
      style={{
        pointerEvents: open ? 'auto' : 'none',
        visibility: open ? 'visible' : 'hidden',
        zIndex: 1100,
      }}
      aria-hidden={!open}
      onClick={(event) => {
        if (!open) return
        if (event.target === event.currentTarget) closeLauncher()
      }}
    >
      <GlobalLauncherPanel
        panelRef={panelRef}
        inputRef={inputRef}
        bindSearchInputRef={bindSearchInputRef}
        controllerRef={controllerRef}
        isImeComposingRef={isImeComposingRef}
        isKeyboardNavRef={isKeyboardNavRef}
        busy={controllerState?.busy ?? false}
        panelStyle={panelStyle}
        beginDrag={beginDrag as never}
        launcherSettingsTarget={launcherSettingsTarget}
        closeSettingsDialog={closeSettingsDialog}
        focusSearchInputAfterBack={focusSearchInputAfterBack}
        surfaceFrame={surfaceFrame}
        activeSurfaceFrame={activeSurfaceFrame}
        leaveSurface={leaveSurface}
        itemPermissionFrame={itemPermissionFrame}
        cancelItemPermissionPrompt={cancelItemPermissionPrompt}
        grantItemPermissionsAndRun={grantItemPermissionsAndRun}
        controllerState={controllerState}
        resultSelectedIndex={resultSelectedIndex}
        setResultSelectedIndex={setResultSelectedIndex}
        selectedResultChoiceIds={selectedResultChoiceIds}
        activateResultChoice={activateResultChoice}
        activateSecondaryAction={activateSecondaryAction}
        pastePreviewText={pastePreviewText}
        toggleResultChoice={toggleResultChoice}
        closeLauncher={closeLauncher}
        visibleFiltered={visibleFiltered}
        nearbySaveItem={nearbySaveItem}
        selectedItem={selectedItem}
        selectedIndex={clampedSelectedIndex}
        setSelectedIndex={setSelectedIndex}
        isWorkflowObjectLauncherItem={isWorkflowObjectLauncherItem}
        selectItem={selectItemWithObjectActions as never}
        hostSurfaceTarget={hostSurfaceTarget}
        clearLauncherHostSurface={clearLauncherHostSurface}
        query={query}
        setQuery={(value) => {
          setBrowsingActions(false)
          setQuery(value)
        }}
        browsingActions={browsingActions}
        onBrowseActions={() => {
          setQuery('')
          setSelectedIndex(0, { pin: false })
          setBrowsingActions(true)
          focusSearchInputAfterBack()
        }}
        onLeaveActionBrowser={leaveActionBrowser}
        availableItemKeys={availableItemKeys}
        locale={locale}
        searchPlaceholder={t(locale, 'palette.globalPlaceholder')}
        requestSurfaceBack={hostSurfaceTarget ? leaveHostSurface : requestSurfaceBack}
        requestSurfaceClose={hostSurfaceTarget ? closeHostSurface : requestSurfaceClose}
        handleCompositionStart={handleCompositionStart}
        handleCompositionEnd={handleCompositionEnd}
        clipboardBlock={clipboardBlock}
        onEditMaterial={editMaterial}
        onExecuteObjectAction={executeObjectAction}
        objectActionCount={objectActions.length}
        selectedActionIndex={selectedObjectActionIndex}
        setSelectedActionIndex={(value) => setSelectedObjectActionIndex(value)}
        onObjectActionController={(controller) => { objectActionControllerRef.current = controller }}
        expandSelectedObjectAction={() => objectActionControllerRef.current?.expand()}
        executeSelectedObjectAction={(keepOpen) => objectActionControllerRef.current?.execute(keepOpen)}
      />
    </div>
  )
}
