import { isCurrentBundledDefinition } from '../../workspace/bundledPluginIdentity'
import { CURRENT_MATERIAL_COMPARE_ACTION, createMaterialComparison, type MaterialTextPair } from '../../currentMaterialCompare'
import { ensurePluginRuntimeReady } from '../../workspace/pluginRuntimeBootstrap'
import { openLauncherHostedPluginSurface } from '../../workspace/pluginSurfaceOpenRequest'
import { selectContextSuggestions, type Suggestion } from '../../workspace/launcher/contextSuggestions'
import { beginSuggestionSession, endSuggestionSession, getSuggestionSession, recordSuggestionSelected, recordSuggestionShown, useSuggestionSettings } from '../../workspace/launcher/contextSuggestionsStore'
import { filterAvailableLauncherItems, isObjectTextClaimedByPlugin } from '../../workspace/launcher/registry'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store'
import { useShallow } from 'zustand/react/shallow'
import { t, pickLocale } from '../../i18n'
import { pluginRegistry, usePluginRegistryVersion } from '../../workspace/pluginRegistry'
import { usePluginSettingsStore } from '../../workspace/pluginSettingsStore'
import { useGlobalLauncherResultFrame } from '../../components/launcher/GlobalLauncherResults'
import { buildGlobalLauncherItems, type GlobalLauncherItem } from '../../components/launcher/GlobalLauncherItems'
import { buildGlobalLauncherPanelStyle } from '../../components/launcher/GlobalLauncherLayout'
import { usePluginPermissionStore } from '../../workspace/pluginPermissions'
import { getPluginSettings, useLauncherSession } from '../../workspace/launcher/useLauncherSession'
import { releaseDesktopWindowSearch, setDesktopWindowSearchVisibilityGuard } from '../../workspace/desktopControl/windows'
import type { SelectableExtraRow } from '../../workspace/launcher/selectionPreserve'
import { useGlobalLauncherSurfaceRegistry } from '../../components/launcher/GlobalLauncherSurfaceRegistry'
import { useAutoCloseStandaloneLauncherOnBackgroundIdle, useCloseStandaloneLauncherOnBlur, useFocusGlobalLauncherSurfaceShell, useGlobalLauncherNativeDrag, useStandaloneLauncherResize } from '../../components/launcher/GlobalLauncherWindowLifecycle'
import { isStandaloneLauncherWindow, useGlobalLauncherCollectInputPreview, useGlobalLauncherFocusSession, useGlobalLauncherHostEscape, useGlobalLauncherImeComposition } from '../../components/launcher/GlobalLauncherHostLifecycle'
import { closeGlobalLauncherWindow } from '../../components/launcher/GlobalLauncherClose'
import { getPluginSurfaceDefinition, isWorkflowObjectLauncherItem } from '../../components/launcher/GlobalLauncherSelection'
import { useGlobalLauncherSurfaceFrame } from '../../components/launcher/GlobalLauncherSurfaceFrame'
import { readLauncherClipboard } from '../clipboard/readLauncherClipboard'
import { peekTrackedClipboardText } from '../clipboard/clipboardTextCache'
import type { ObjectAcceptance } from '../clipboard/attachPolicy'
import { GlobalLauncherPanel } from '../../components/launcher/GlobalLauncherPanel'
import { useLauncherSurfaceBackgroundIdle } from '../../components/launcher/useLauncherSurfaceBackgroundIdle'
import { WindowResizeHandles } from '../../components/WindowResizeHandles'
import { useGlobalLauncherSelectionController } from '../../components/launcher/useGlobalLauncherSelectionController'
import { useClipboardObjectBlock } from '../clipboard/useClipboardObjectBlock'
import { chooseTextMaterialFile } from '../clipboard/fileTextMaterial'
import { captureRootFileTextSession } from '../clipboard/fileTextInputSession'
import { acquireLauncherNativeDialogFocus } from '../../workspace/launcherBlurGuard'
import { createStrongQueryObjectBlock, getObjectBlockRecommendationText, type LauncherObjectBlock } from '../clipboard/objectBlock'
import { captureCurrentTextDeliveryScope, createCurrentTextDelivery, isCurrentTextDeliveryAction, type CurrentTextDeliveryAction } from '../clipboard/currentTextDelivery'
import { canExportCurrentText, captureCurrentTextExportScope, createCurrentTextExport, CURRENT_TEXT_EXPORT_ACTION, CURRENT_TEXT_EXPORT_ERROR_KEYS } from '../clipboard/currentTextExport'
import { setPendingObjectBlock, subscribePendingObjectBlock } from '../clipboard/pendingObjectBlock'
import { subscribeLauncherObjectHandoff } from '../clipboard/launcherObjectHandoff'
import { isNativeDesktopRuntime } from '../../workspace/webNativeBridge'
import { ACTION_ERROR_KEYS, executeRecommendedAction } from '../clipboard/actionExecutor'
import { OPEN_QUICK_EDITOR, recommendActionsForBlock, type RecommendedAction, type RecommendedOutputTarget } from '../clipboard/actionRecommendation'
import { createPluginClipboard, writeClipboardText } from '../../workspace/pluginClipboard'
import { createGlobalLauncherPluginApi } from '../clipboard/globalLauncherApi'
import { createPluginPaste } from '../../workspace/pluginPaste'
import { cancelPendingPasteRecovery, captureLauncherPasteOwner, isPasteCancelled } from '../../workspace/pasteRecovery'
import { LAUNCHER_NEW_SESSION_EVENT } from '../../workspace/launcherWindowEvents'
import type { PluginPasteResult } from '../../workspace/pluginTypes'
import { createPluginPrivateStorage } from '../../workspace/pluginStorage'
import type { PluginSettingsSource } from '../../workspace/pluginSettingsStore'
import { invalidateCurrentLauncherWindowResize, restoreLauncherInputSource, startCurrentLauncherWindowResize, type LauncherWindowResizeDirection } from '../../workspace/windowManager/launcherWindow'
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
import { selectLauncherVisibleItems } from '../../workspace/launcher/visibleItems'
import type { LauncherBrowseCategory } from '../../workspace/launcher/browseItems'
import { showToast } from '../../workspace/toast'
import { withClipboardImageSave } from '../../shortcutHosts/clipboardImageSave'
import { captureHudTarget } from '../../workspace/toastRouting'

type CurrentTextActionScope = { block: LauncherObjectBlock } & ReturnType<typeof captureCurrentTextDeliveryScope>
type CurrentTextExportScope = { block: LauncherObjectBlock } & ReturnType<typeof captureCurrentTextExportScope>

/** Host commands unrelated to the attached content; hidden from the default content-action list. */
const CONTENT_UNRELATED_HOST_KEYS: ReadonlySet<string> = new Set([
  'host:view:plugins',
  'host:view:settings',
  'host:view:ai-settings',
  'host:view:devtools',
  'host:view:quick-editor',
  'host:saved-action:delete',
  'host:app-launcher:refresh',
])

/** Idle time before strong-typed query text turns into an Object Block. */
const QUERY_BLOCK_ATTACH_DELAY_MS = 250

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
  const suggestionSettings = useSuggestionSettings()
  // The session is created in a layout effect (not during render) so renders stay pure;
  // the state update re-renders before paint.
  const [openedSuggestionSession, setOpenedSuggestionSession] = useState<ReturnType<typeof getSuggestionSession>>(null)
  const suggestionSession = open ? openedSuggestionSession : null
  const [suggestionDismissed, setSuggestionDismissed] = useState<string | null>(null)
  useLayoutEffect(() => {
    if (open) setOpenedSuggestionSession(getSuggestionSession() ?? beginSuggestionSession())
    else {
      endSuggestionSession()
      setOpenedSuggestionSession(null)
    }
  }, [open])
  useEffect(() => {
    const dismiss = () => { const session = getSuggestionSession(); if (session) setSuggestionDismissed(session.id) }
    document.addEventListener('compositionstart', dismiss, true)
    return () => document.removeEventListener('compositionstart', dismiss, true)
  }, [])
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
  const extraSelectionRowsRef = useRef<readonly SelectableExtraRow[]>([])
  const [browsingActions, setBrowsingActions] = useState(false)
  const [browseCategory, setBrowseCategory] = useState<LauncherBrowseCategory>('all')
  const [currentTextBusy, setCurrentTextBusy] = useState(false)
  const [deliveryFailure, setDeliveryFailure] = useState<{ message: string; isCurrent: () => boolean } | null>(null)
  const deliveryGenerationRef = useRef(0)
  const hudMaterialRef = useRef<{ block: unknown; id: string } | null>(null)
  const currentTextDeliveryRef = useRef(createCurrentTextDelivery(setCurrentTextBusy))
  const currentTextScopesRef = useRef(new WeakMap<LauncherItem, CurrentTextActionScope>())
  const materialComparisonRef = useRef(createMaterialComparison())
  const materialComparisonScopesRef = useRef(new WeakMap<LauncherItem, MaterialTextPair>())
  const currentTextExportRef = useRef(createCurrentTextExport())
  const currentTextExportScopesRef = useRef(new WeakMap<LauncherItem, CurrentTextExportScope>())
  const textExportLifetimeRef = useRef(0)
  const textExportMountedRef = useRef(true)
  const textExportQueryGenerationRef = useRef(0)
  const launcherFavoriteKeys = useAppStore((s) => s.launcherFavoriteKeys)
  const { isImeComposingRef, handleCompositionStart, handleCompositionEnd } = useGlobalLauncherImeComposition()
  const standaloneLauncher = isStandaloneLauncherWindow()
  const launcherSettingsTarget = settingsDialogTarget?.presentation === 'global-launcher'
    ? settingsDialogTarget
    : null
  const hostSurfaceTarget = launcherHostSurfaceTarget

  // Live query for suppress gate (session is declared below; ref stays current each render).
  const liveQueryRef = useRef('')
  const fileTextRootVisibleRef = useRef(false)
  useEffect(() => {
    setDesktopWindowSearchVisibilityGuard(() => {
      const state = useAppStore.getState()
      const settings = usePluginSettingsStore.getState().settingsDialogTarget
      return state.globalLauncherOpen && fileTextRootVisibleRef.current &&
        !state.pluginSurfaceToolTarget && !state.launcherHostSurfaceTarget &&
        settings?.presentation !== 'global-launcher'
    })
    return () => {
      setDesktopWindowSearchVisibilityGuard(() => false)
      void releaseDesktopWindowSearch()
    }
  }, [])
  // Text the user pulled back out of an auto-attached query block must not be re-attached.
  const rejectedQueryBlockTextRef = useRef<string | null>(null)
  // Filled from the session's available items below; the clipboard hook reads it at decision time.
  const objectAcceptanceRef = useRef<ObjectAcceptance>({ acceptedKinds: new Set() })
  const clipboardBlock = useClipboardObjectBlock({
    open,
    readClipboard: readLauncherClipboard,
    // The tracker polls every second; older copies may miss a copy made right before open.
    peekClipboard: () => peekTrackedClipboardText(1500),
    getAcceptance: () => objectAcceptanceRef.current,
    onQueryBlockRemoved: (text) => {
      rejectedQueryBlockTextRef.current = text
      setQuery(text)
    },
    // Do not replace an in-progress query with clipboard suggestions.
    suppressAutoAttach: () => (
      Boolean(liveQueryRef.current.trim())
      || Boolean(inputRef.current?.value?.trim())
    ),
    filePicker: isNativeDesktopRuntime() ? {
      choose: () => chooseTextMaterialFile({
        title: t(locale, 'palette.fileTextPickerTitle'),
        filterName: t(locale, 'palette.fileTextPickerFilter'),
      }),
      acquireFocusLease: acquireLauncherNativeDialogFocus,
      onComplete: () => {
        try { inputRef.current?.focus({ preventScroll: true }) } catch { /* best-effort caret restore */ }
      },
      beginSession: () => captureRootFileTextSession({
        getController: () => controllerRef.current,
        isRootVisible: () => {
          const state = useAppStore.getState()
          const settings = usePluginSettingsStore.getState().settingsDialogTarget
          return state.globalLauncherOpen && fileTextRootVisibleRef.current &&
            !state.pluginSurfaceToolTarget && !state.launcherHostSurfaceTarget &&
            settings?.presentation !== 'global-launcher'
        },
      }),
    } : undefined,
  })
  // Recommendations while block is mounted (exit keeps mode stable to avoid ranking jank).
  const objectBlockText = getObjectBlockRecommendationText(clipboardBlock.block)
  const [foregroundApp, setForegroundApp] = useState<string | undefined>()

  const makeLauncherApi = useCallback((api: Parameters<typeof withClipboardImageSave>[0], item?: Parameters<typeof withClipboardImageSave>[1]) =>
    withClipboardImageSave(
      createGlobalLauncherPluginApi(api),
      item,
      () => closeAfterActionRef.current(),
      () => { try { inputRef.current?.focus({ preventScroll: true }) } catch { /* best-effort retry focus */ } },
    ), [])
  const {
    query,
    rankingQuery,
    searchRecovery,
    setQuery: setSessionQuery,
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
    getMaterialGeneration: clipboardBlock.getMaterialGeneration,
    foregroundApp,
    makeApi: makeLauncherApi,
    visibleSelectionItemsRef,
    extraSelectionRowsRef,
  })
  const setQuery = useCallback((value: string) => {
    if (liveQueryRef.current !== value) textExportQueryGenerationRef.current += 1
    if (value.length > 0 && getSuggestionSession()) setSuggestionDismissed(getSuggestionSession()!.id)
    liveQueryRef.current = value
    setSessionQuery(value)
  }, [setSessionQuery])
  useLayoutEffect(() => {
    textExportMountedRef.current = true
    return () => {
      textExportMountedRef.current = false
    }
  }, [])
  const nearbySaveItem = useMemo(() => nearbySaveDomainItem ? buildGlobalLauncherItems({
    rankedLauncherItems: [nearbySaveDomainItem], query: '', locale,
  })[0] : undefined, [nearbySaveDomainItem, locale])
  liveQueryRef.current = query
  // A failed delivery belongs to the visible material and flow, never the next
  // query or window session. Keep it readable in the existing error region.
  useLayoutEffect(() => {
    deliveryGenerationRef.current += 1
    setDeliveryFailure(null)
  }, [open, query, clipboardBlock.block, controllerState, pluginSurfaceToolTarget, launcherHostSurfaceTarget, settingsDialogTarget])
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
    setBrowseCategory('all')
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

  // Auto-attach follows plugin declarations: a detected kind must be in some item's
  // `accepts.kinds`, or a plugin must claim the exact text.
  const objectAcceptance = useMemo<ObjectAcceptance>(() => ({
    acceptedKinds: new Set(availableLauncherItems.flatMap((item) => item.accepts?.kinds ?? [])),
    isClaimedByPlugin: (text) => isObjectTextClaimedByPlugin(text, getPluginSettings),
  }), [availableLauncherItems])
  objectAcceptanceRef.current = objectAcceptance

  // Only look up the foreground app when some candidate can actually use it.
  const anyCandidateAcceptsApps = useMemo(
    () => availableLauncherItems.some((item) => (item.accepts?.apps?.length ?? 0) > 0),
    [availableLauncherItems],
  )
  useEffect(() => {
    if (!open || !anyCandidateAcceptsApps) {
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
  }, [anyCandidateAcceptsApps, open])

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
  const surfaceKey = surfaceFrame && activeSurfaceFrame && !hostSurfaceTarget && !launcherSettingsTarget
    ? `${surfaceFrame.source}:${surfaceFrame.pluginId}:${surfaceFrame.surfaceId}:${surfaceFocusVersion}`
    : null
  const resizableSurface = standaloneLauncher && surfaceKey !== null
    && activeSurfaceFrame?.surface.shell?.resizable === true
  const surfaceBackgroundIdle = useLauncherSurfaceBackgroundIdle(
    open && surfaceKey !== null ? surfaceFrame : null,
  )

  // Typed or pasted text that is clearly a structured object (JSON, JWT, timestamp, URL, ...)
  // becomes an Object Block, exactly like clipboard content. Debounced so that typing a
  // longer query is never hijacked half-way.
  const rootListActive = !surfaceFrame && !hostSurfaceTarget && !launcherSettingsTarget &&
    (controllerState?.frames.length ?? 1) <= 1
  useEffect(() => {
    if (!open) rejectedQueryBlockTextRef.current = null
    if (!open || !rootListActive || clipboardBlock.block || browsingActions || !query.trim()) return
    if (rejectedQueryBlockTextRef.current === query) return
    if (!createStrongQueryObjectBlock(query, objectAcceptance)) return
    const timer = window.setTimeout(() => {
      if (isImeComposingRef.current) return
      clipboardBlock.attachQueryAsBlock(query)
    }, QUERY_BLOCK_ATTACH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [open, rootListActive, clipboardBlock.block, clipboardBlock.attachQueryAsBlock, browsingActions, query, isImeComposingRef, objectAcceptance])

  useEffect(() => {
    if (!standaloneLauncher || !isNativeDesktopRuntime()) return
    let disposed = false
    let stop: (() => void) | undefined
    void subscribeLauncherObjectHandoff({
      prepare: () => useAppStore.getState().openGlobalLauncherOverlay(),
      getGeneration: clipboardBlock.getMaterialGeneration,
      accept: (block) => {
        const generation = clipboardBlock.getMaterialGeneration()
        if (generation === undefined) return false
        if (!clipboardBlock.hasMaterial(block)) {
          setPendingObjectBlock(block, { persist: true })
          if (clipboardBlock.getMaterialGeneration() === generation) return false
        }
        useAppStore.getState().clearPluginSurfaceTool()
        useAppStore.getState().clearLauncherHostSurface()
        useAppStore.setState({ previousLauncherHostSurfaceTarget: null })
        setSurfaceFrame(null)
        controllerRef.current?.reset()
        const settings = usePluginSettingsStore.getState()
        if (settings.settingsDialogTarget?.presentation === 'global-launcher') settings.closeSettingsDialog()
        return true
      },
    }).then((unlisten) => { if (disposed) unlisten(); else stop = unlisten }).catch((error) => {
      console.warn('[hiven] Could not listen for launcher object handoffs:', error)
    })
    return () => { disposed = true; stop?.() }
  }, [standaloneLauncher, clipboardBlock.getMaterialGeneration, clipboardBlock.hasMaterial, setSurfaceFrame, controllerRef])

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
  const hasContentBlock = Boolean(clipboardBlock.block)
  const rankedVisible = useMemo(() => {
    void pluginRegistryVersion
    // With content attached and no search typed, only content-related actions are listed.
    const contentRows = hasContentBlock && !rankingQuery.trim()
      ? rankedLauncherItems.filter((item) => !CONTENT_UNRELATED_HOST_KEYS.has(item.systemKey))
      : rankedLauncherItems
    return buildGlobalLauncherItems({
      rankedLauncherItems: contentRows,
      query: rankingQuery,
      locale,
    })
  }, [hasContentBlock, locale, pluginRegistryVersion, rankingQuery, rankedLauncherItems])

  /**
   * Object Block host rows pinned near the top of the composed list.
   *
   * Ranking / textMatch no longer shows static recommendActionsForBlock entries
   * (RecommendedActionRow UI is disabled). Text delivery follows the attached
   * payload, including after editing, and keeps the existing search filtering.
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
      actions = objectActions.length > 0
        ? objectActions
        : [OPEN_QUICK_EDITOR]
    } else actions = []

    const labelOf = (key: string) => ({ en: t('en', key), zh: t('zh', key) })
    const kindLabel =
      block.kind === 'image'
        ? labelOf('palette.kindLabelImage')
        : block.kind === 'files'
          ? labelOf('palette.kindLabelFiles')
          : block.source === 'history-item'
            ? labelOf('palette.kindLabelHistory')
            : block.source === 'tool-result'
              ? labelOf('palette.kindLabelResult')
              : block.source === 'query'
                ? labelOf('palette.currentTextSourceInput')
                : labelOf('palette.kindLabelClipboard')

    const providerLabel = (action: RecommendedAction) =>
      action.provider ? pickLocale(locale, action.providerZh ?? action.provider, action.provider) : ''

    const textScope: CurrentTextActionScope = {
      block,
      ...captureCurrentTextDeliveryScope({
        block,
        getMaterialGeneration: clipboardBlock.getMaterialGeneration,
        hasMaterial: clipboardBlock.hasMaterial,
        getController: () => controllerRef.current,
        isOpen: () => useAppStore.getState().globalLauncherOpen,
        isRootVisible: () => {
          const state = useAppStore.getState()
          return fileTextRootVisibleRef.current &&
            !state.pluginSurfaceToolTarget && !state.launcherHostSurfaceTarget &&
            usePluginSettingsStore.getState().settingsDialogTarget?.presentation !== 'global-launcher'
        },
      }),
    }

    const items = actions
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
            icon: action.icon,
            subtitle: providerLabel(action),
            kindLabel: kindLabel.en,
            kindLabelI18n: kindLabel,
          },
          behavior: { type: 'perform' },
          execute: async () => ({ ok: true }),
        }
        if (isCurrentTextDeliveryAction(action.id)) currentTextScopesRef.current.set(domainItem, textScope)
        return {
          kind: 'domain' as const,
          id: domainItem.systemKey,
          title,
          subtitle: providerLabel(action),
          domainItem,
        }
      })
    const pair = clipboardBlock.beginTextPair()
    const compareTitles = { en: t('en', 'palette.comparePreviousMaterial'), zh: t('zh', 'palette.comparePreviousMaterial') }
    if (pair && (!q || compareTitles.en.toLowerCase().includes(q) || compareTitles.zh.includes(q) || CURRENT_MATERIAL_COMPARE_ACTION.includes(q))) {
      const title = t(locale, 'palette.comparePreviousMaterial')
      const domainItem: LauncherItem = {
        systemKey: `object-action:${CURRENT_MATERIAL_COMPARE_ACTION}`,
        kind: 'host', display: { title, titleI18n: compareTitles, icon: 'GitCompare', kindLabel: kindLabel.en, kindLabelI18n: kindLabel },
        behavior: { type: 'perform' }, execute: async () => ({ ok: true, keepOpen: true }),
        experienceRecord: false, recordUsage: false,
      }
      const queryGeneration = textExportQueryGenerationRef.current
      const lifetime = textExportLifetimeRef.current
      materialComparisonScopesRef.current.set(domainItem, { ...pair, isCurrent: () =>
        textExportMountedRef.current && textExportLifetimeRef.current === lifetime &&
        textExportQueryGenerationRef.current === queryGeneration && pair.isCurrent() && textScope.isCurrent() })
      items.push({ kind: 'domain', id: domainItem.systemKey, title, subtitle: '', domainItem })
    }
    // Host-only export has its own empty-text eligibility and no plugin output route.
    if (canExportCurrentText({ block, nativeDesktop: isNativeDesktopRuntime(), standaloneLauncher })) {
      const titleI18n = { en: t('en', 'palette.saveCurrentText'), zh: t('zh', 'palette.saveCurrentText') }
      if (!q || titleI18n.en.toLowerCase().includes(q) || titleI18n.zh.includes(q) || CURRENT_TEXT_EXPORT_ACTION.includes(q)) {
        const title = t(locale, 'palette.saveCurrentText')
        const domainItem: LauncherItem = {
          systemKey: `object-action:${CURRENT_TEXT_EXPORT_ACTION}`,
          kind: 'host', display: { title, titleI18n, icon: 'Save', kindLabel: kindLabel.en, kindLabelI18n: kindLabel },
          behavior: { type: 'perform' }, execute: async () => ({ ok: true, keepOpen: true }),
          experienceRecord: false, recordUsage: false,
        }
        currentTextExportScopesRef.current.set(domainItem, {
          block,
          ...captureCurrentTextExportScope({
            block,
            getMaterialGeneration: clipboardBlock.getMaterialGeneration,
            hasMaterial: clipboardBlock.hasMaterial,
            getController: () => controllerRef.current,
            isOpen: () => useAppStore.getState().globalLauncherOpen,
            isRootVisible: () => {
              const state = useAppStore.getState()
              return fileTextRootVisibleRef.current && !state.pluginSurfaceToolTarget && !state.launcherHostSurfaceTarget &&
                usePluginSettingsStore.getState().settingsDialogTarget?.presentation !== 'global-launcher'
            },
            getQueryGeneration: () => textExportQueryGenerationRef.current,
            getLifetime: () => textExportMountedRef.current && useAppStore.getState().globalLauncherOpen
              ? textExportLifetimeRef.current : undefined,
          }),
        })
        items.push({ kind: 'domain', id: domainItem.systemKey, title, subtitle: '', domainItem })
      }
    }
    return items
  }, [clipboardBlock.block, clipboardBlock.beginTextPair, clipboardBlock.getMaterialGeneration, clipboardBlock.hasMaterial, controllerRef, controllerState, locale, objectActions, rankingQuery, standaloneLauncher])

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
  const ordinaryVisible = useMemo(() => selectLauncherVisibleItems({
    rankedItems: composedRankedItems,
    availableItems,
    favoriteKeys: launcherFavoriteKeys,
    query: rankingQuery,
    browse: browsingActions,
    browseCategory,
    browseItemOf: (item: GlobalLauncherItem) => item.domainItem,
    keyOf: (item: GlobalLauncherItem) => item.id,
  }), [availableItems, browseCategory, browsingActions, composedRankedItems, launcherFavoriteKeys, rankingQuery])
  const frozenSuggestions = useRef<{ session: string; epoch: string; suggestions: Suggestion[]; keys: string[] } | null>(null)
  if (!open) frozenSuggestions.current = null
  if (suggestionSession && frozenSuggestions.current?.session !== suggestionSession.id) {
    const available = filterAvailableLauncherItems(availableLauncherItems, 'global-launcher')
    const suggestions = suggestionSettings.enabled ? selectContextSuggestions({
      events: suggestionSettings.events, originAppId: suggestionSession.originAppId,
      availableKeys: available.map(item => item.systemKey), excludedKeys: launcherFavoriteKeys, now: Date.now(),
    }) : []
    const keys = new Set(suggestions.map(item => item.actionKey))
    frozenSuggestions.current = { session: suggestionSession.id, epoch: suggestionSettings.epoch, suggestions,
      keys: [...keys, ...ordinaryVisible.filter(item => !keys.has(item.id)).map(item => item.id)] }
  }
  const suggestionsIdle = Boolean(suggestionSession && suggestionSettings.enabled &&
    (frozenSuggestions.current?.suggestions.length ?? 0) > 0 &&
    frozenSuggestions.current?.epoch === suggestionSettings.epoch && suggestionDismissed !== suggestionSession.id &&
    query === '' && !isImeComposingRef.current && !browsingActions && !clipboardBlock.block && !clipboardBlock.hint &&
    !clipboardBlock.isPickingTextFile && !clipboardBlock.isReadingFileText && !clipboardBlock.fileTextError &&
    !controllerState?.busy && !controllerState?.error && (controllerState?.frames.length ?? 1) <= 1 &&
    !surfaceFrame && !hostSurfaceTarget && !launcherSettingsTarget)
  const snapshot = frozenSuggestions.current
  const { visibleFiltered, currentSuggestionKeys, appendedSuggestionKeys } = useMemo(() => {
    const keys = new Set<string>()
    if (!suggestionsIdle || !snapshot) return { visibleFiltered: ordinaryVisible, currentSuggestionKeys: keys, appendedSuggestionKeys: [] as string[] }
    const eligible = new Set(filterAvailableLauncherItems(availableLauncherItems, 'global-launcher').map(item => item.systemKey))
    const byKey = new Map(availableItems.map(item => [item.id, item]))
    const reasons = new Map(snapshot.suggestions.map(item => [item.actionKey, item.reason]))
    // Async ordinary candidates may arrive after the first paint. Append them
    // without moving existing rows or changing their numeric shortcuts.
    const frozenKeys = new Set(snapshot.keys)
    const appendedKeys = ordinaryVisible.filter(item => !frozenKeys.has(item.id)).map(item => item.id)
    const items = [...snapshot.keys, ...appendedKeys].flatMap(key => {
      const item = byKey.get(key)
      if (!item) return []
      const reason = reasons.get(key)
      if (!reason) return [item]
      if (!eligible.has(key)) return []
      keys.add(key)
      return [{ ...item, subtitle: `${t(locale, 'settings.contextSuggestions')} · ${t(locale,
        reason === 'app' ? 'settings.contextSuggestionApp' : 'settings.contextSuggestionRecent')}` }]
    })
    return { visibleFiltered: items, currentSuggestionKeys: keys, appendedSuggestionKeys: appendedKeys }
  }, [suggestionsIdle, snapshot, ordinaryVisible, availableLauncherItems, availableItems, locale, pluginRegistryVersion])
  // Persist late arrivals after commit so later renders keep their position.
  useLayoutEffect(() => {
    if (!snapshot || appendedSuggestionKeys.length === 0) return
    const known = new Set(snapshot.keys)
    for (const key of appendedSuggestionKeys) if (!known.has(key)) snapshot.keys.push(key)
  }, [snapshot, appendedSuggestionKeys])
  const showingSuggestions = suggestionsIdle && currentSuggestionKeys.size > 0
  const visibleSelectionItems = useMemo(
    () => visibleFiltered.map((item) => item.domainItem),
    [visibleFiltered],
  )
  // Presentation age / tracker lastSeenAt can change without changing this material.
  const clipboardHintKey = clipboardBlock.hint && !clipboardBlock.block
    ? `clipboard-hint:${clipboardBlock.hint.snapshot.hash}:${clipboardBlock.hint.snapshot.changedAt}`
    : null
  const extraSelectionRows = useMemo<readonly SelectableExtraRow[]>(
    () => clipboardHintKey ? [{ index: -1, systemKey: clipboardHintKey }] : [],
    [clipboardHintKey],
  )
  // Drop a vanished/replaced hint pin before the next keyboard event can target its replacement.
  useLayoutEffect(() => {
    visibleSelectionItemsRef.current = visibleSelectionItems
    extraSelectionRowsRef.current = extraSelectionRows
    syncSelection()
  }, [extraSelectionRows, syncSelection, visibleSelectionItems])

  /**
   * Primitive resize trigger — controllerState object identity changes every setState.
   * For collect-input live preview: only signal empty vs has-preview (not each keystroke /
   * each preview text), so native window does not thrash while results replace in place.
   */
  const visibleDeliveryError = controllerState?.error || (deliveryFailure?.isCurrent() ? deliveryFailure.message : null)
  const controllerResizeKey = useMemo(() => {
    if (!controllerState) return 'idle'
    const top = controllerState.frames[controllerState.frames.length - 1]
    const topKind = top?.kind ?? 'none'
    const previewSignal = top?.kind === 'collect-input'
      ? `:${top.item.materialTextEdit || top.item.executionMode === 'explicit-text-preview' ? 'multi' : 'single'}:${top.inputText.trim() ? 1 : 0}:${top.previewOutput?.choices?.length ? 1 : 0}`
      : ''
    return `${controllerState.busy ? 1 : 0}:${controllerState.frames.length}:${topKind}:${visibleDeliveryError ?? ''}${previewSignal}`
  }, [controllerState, visibleDeliveryError])

  // Guard duplicate dismissals while the native window is hiding.
  const closingRef = useRef(false)
  const resetLauncherSession = useCallback((options?: { preservePendingMaterial?: boolean }) => {
    textExportLifetimeRef.current += 1
    clipboardBlock.markBlockConsumed({ preservePending: options?.preservePendingMaterial })
    clearPluginSurfaceTool()
    clearLauncherHostSurface()
    // Drop any suspended host (e.g. quick-editor under Diff) when fully closing.
    useAppStore.setState({ previousLauncherHostSurfaceTarget: null })
    setSurfaceFrame(null)
    setItemPermissionFrame(null)
    const settingsTarget = usePluginSettingsStore.getState().settingsDialogTarget
    if (settingsTarget?.presentation === 'global-launcher' || settingsTarget?.context?.surfaceId === 'global-launcher') {
      closeSettingsDialog()
    }
    setBrowsingActions(false)
    setBrowseCategory('all')
    isImeComposingRef.current = false
    resetSession()
  }, [clipboardBlock.markBlockConsumed, clearLauncherHostSurface, clearPluginSurfaceTool, closeSettingsDialog, isImeComposingRef, resetSession])

  useLayoutEffect(() => {
    if (!standaloneLauncher) return
    const resetForNativeOpen = () => {
      invalidateCurrentLauncherWindowResize()
      if (!useAppStore.getState().globalLauncherOpen) return
      cancelPendingPasteRecovery()
      resetLauncherSession({ preservePendingMaterial: true })
      closingRef.current = false
    }
    window.addEventListener(LAUNCHER_NEW_SESSION_EVENT, resetForNativeOpen)
    return () => window.removeEventListener(LAUNCHER_NEW_SESSION_EVENT, resetForNativeOpen)
  }, [standaloneLauncher, resetLauncherSession])

  const closeSession = useCallback((reason: 'esc-or-overlay' | 'blur' | 'after-action') => {
    const completed = reason === 'after-action'
    if (closingRef.current) return
    closingRef.current = true
    trackBehavior(TelemetryEvents.launcherClose, {
      reason,
      ...queryTelemetryProps(inputRef.current?.value ?? query),
    })
    resetLauncherSession()
    return closeGlobalLauncherWindow({
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
    paused: surfaceBackgroundIdle.paused,
    isPaused: surfaceBackgroundIdle.isPaused,
    restartVersion: surfaceBackgroundIdle.restartVersion,
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
    surfaceKey,
    visibleFilteredLength: visibleFiltered.length,
    controllerResizeKey: `${controllerResizeKey}:${locale}:${clipboardBlock.canPickTextFile}:${clipboardBlock.isPickingTextFile}:${clipboardBlock.canReadFileText}:${clipboardBlock.isReadingFileText}:${clipboardBlock.fileTextError ?? ''}`,
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
    objectBlockTextIsFileContent: clipboardBlock.block?.meta?.textOrigin === 'file-content',
    locale,
  })
  fileTextRootVisibleRef.current = !surfaceFrame && !itemPermissionFrame
  useEffect(() => {
    if (!showingSuggestions || !suggestionSession || itemPermissionFrame) return
    // Count only an actual visible paint, once per session; no typed/Esc penalty.
    const frame = requestAnimationFrame(() => {
      if (document.visibilityState === 'visible') recordSuggestionShown(suggestionSession)
    })
    return () => cancelAnimationFrame(frame)
  }, [showingSuggestions, suggestionSession, itemPermissionFrame])


  useEffect(() => {
    if (surfaceFrame || itemPermissionFrame || hostSurfaceTarget || launcherSettingsTarget) {
      void releaseDesktopWindowSearch()
    }
  }, [hostSurfaceTarget, itemPermissionFrame, launcherSettingsTarget, surfaceFrame])

  // Reset synchronously on external closes, before the hidden WebView can throttle React.
  useEffect(() => useAppStore.subscribe((state, previous) => {
    if ((state.pluginSurfaceToolTarget && state.pluginSurfaceToolTarget !== previous.pluginSurfaceToolTarget) ||
      (state.launcherHostSurfaceTarget && state.launcherHostSurfaceTarget !== previous.launcherHostSurfaceTarget)) {
      clipboardBlock.cancelFileTextRead()
    }
    if (!previous.globalLauncherOpen && state.globalLauncherOpen) {
      textExportLifetimeRef.current += 1
      closingRef.current = false
    } else if (previous.globalLauncherOpen && !state.globalLauncherOpen && !closingRef.current) {
      closingRef.current = true
      resetLauncherSession()
    }
  }), [clipboardBlock.cancelFileTextRead, controllerRef, resetLauncherSession])

  useEffect(() => usePluginSettingsStore.subscribe((state) => {
    if (state.settingsDialogTarget?.presentation === 'global-launcher') clipboardBlock.cancelFileTextRead()
  }), [clipboardBlock.cancelFileTextRead])

  const leaveActionBrowser = useCallback(() => {
    if (!browsingActions) return false
    setBrowsingActions(false)
    setBrowseCategory('all')
    setSelectedIndex(0, { pin: false })
    focusSearchInputAfterBack()
    return true
  }, [browsingActions, focusSearchInputAfterBack, setSelectedIndex])

  // Root list: the first Esc clears typed input / the attached block; only an empty root closes.
  const clearRootInput = useCallback(() => {
    const hasQuery = (inputRef.current?.value ?? liveQueryRef.current).length > 0
    const hasBlock = Boolean(clipboardBlock.block)
    if (!hasQuery && !hasBlock) return false
    if (hasBlock) clipboardBlock.markBlockConsumed()
    setQuery('')
    setSelectedIndex(0, { pin: false })
    focusSearchInputAfterBack()
    return true
  }, [clipboardBlock.block, clipboardBlock.markBlockConsumed, focusSearchInputAfterBack, setQuery, setSelectedIndex])

  useGlobalLauncherHostEscape({
    open,
    isImeComposingRef,
    controllerRef,
    closeLauncher,
    focusSearchInputAfterBack,
    onRootBack: () => leaveActionBrowser() || clearRootInput(),
  })


  const pastePreviewText = useCallback(async (text: string, isCurrent: () => boolean, options?: { historyText?: boolean; via?: string }): Promise<{ ok: true } | { ok: false; message: string; fallback?: 'copied' | 'none' }> => {
    const startedAt = telemetryNow()
    trackBehavior(TelemetryEvents.pasteText, { textLength: text.length, via: options?.via ?? 'result-preview' })
    const permissions = options?.historyText
      ? getPluginPermissionSnapshot('builtin', 'clipboard-history', ['clipboard.write', 'accessibility.paste'])
      : undefined
    const owner = captureLauncherPasteOwner({ isCurrent, complete: false })
    const result = await createPluginPaste(permissions, undefined, { ownerSource: { capture: () => owner } }).pasteText(text)
    trackLatencyFrom(TelemetryEvents.pasteLatency, startedAt, {
      ok: result.ok,
      textLength: text.length,
      via: options?.via ?? 'result-preview',
    })
    if (isPasteCancelled(result)) return { ok: false, message: '' }
    if (!result.ok) {
      // A clipboard fallback is recoverable, but is not a delivered output.
      return { ok: false, message: result.message || t(locale, 'palette.quickEntryError'), fallback: result.fallback }
    }
    return { ok: true }

  }, [locale])


  const executeCurrentTextAction = useCallback(async (scope: CurrentTextActionScope, action: CurrentTextDeliveryAction) => {
    if (!scope.isCurrent()) return
    const generation = ++deliveryGenerationRef.current
    if (hudMaterialRef.current?.block !== scope.block) hudMaterialRef.current = { block: scope.block, id: crypto.randomUUID() }
    const operation = hudMaterialRef.current.id
    const target = await captureHudTarget(operation)
    if (generation !== deliveryGenerationRef.current || !scope.isCurrent()) return
    setDeliveryFailure(null)
    const result = await currentTextDeliveryRef.current({
      ...scope,
      action,
      copyText: writeClipboardText,
      pasteText: (text, isCurrent) => pastePreviewText(text, isCurrent, {
        historyText: scope.block.source === 'history-item', via: 'current-material',
      }),
    })
    if (!result || generation !== deliveryGenerationRef.current || !scope.isCurrent()) return
    if (!result.ok) {
      if (result.message) {
        setDeliveryFailure({ message: result.message, isCurrent: scope.isCurrent })
        const outcome = action.startsWith('copy-') ? 'copy-failed' : result.fallback === 'copied' ? 'copied-paste-failed' : 'paste-failed'
        showToast(t(locale, `hud.result.${outcome}`), 'error', { durationMs: 6000, hud: { operation, target, revision: generation, result: outcome } })
      }
    }
    else {
      const closing = closeLauncherAfterAction()
      const closedSession = useAppStore.getState().globalLauncherSessionId + (standaloneLauncher || overlay ? 1 : 0)
      await closing
      const current = useAppStore.getState()
      if (current.globalLauncherSessionId === closedSession && !current.globalLauncherOpen) {
        showToast(t(locale, action.startsWith('copy-') ? 'palette.copied' : 'hud.pasted'), 'success', { hud: { operation, target, revision: generation, result: action.startsWith('copy-') ? 'copied' : 'pasted' } })
      }
    }
  }, [closeLauncherAfterAction, locale, overlay, pastePreviewText, standaloneLauncher])

  const executeCurrentTextExport = useCallback(async (scope: CurrentTextExportScope) => {
    if (!standaloneLauncher || !isNativeDesktopRuntime() || !scope.isCurrent() || currentTextExportRef.current.isBusy()) return
    const generation = ++deliveryGenerationRef.current
    setDeliveryFailure(null)
    const result = await currentTextExportRef.current({
      ...scope,
      labels: {
        dialogTitle: t(locale, 'palette.currentTextExportDialogTitle'),
      },
      acquireFocusLease: () => acquireLauncherNativeDialogFocus(scope.isCurrentLifetime),
    })
    if (!result || generation !== deliveryGenerationRef.current || !scope.isCurrent()) return
    try { inputRef.current?.focus({ preventScroll: true }) } catch { /* best-effort caret restore */ }
    if (result.status === 'error') {
      setDeliveryFailure({ message: t(locale, CURRENT_TEXT_EXPORT_ERROR_KEYS[result.code]), isCurrent: scope.isCurrent })
    }
  }, [locale, standaloneLauncher])

  const executeObjectAction = useCallback(async (action: RecommendedAction, target: RecommendedOutputTarget) => {
    const block = clipboardBlock.block
    if (!block) return
    // Text rows must use their captured material/session scope below.
    if (isCurrentTextDeliveryAction(action.id)) return
    const generation = ++deliveryGenerationRef.current
    setDeliveryFailure(null)
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
      'clipboard.history',
      'storage.private',
      'storage.blob',
      'accessibility.paste',
    ])
    const historyStorage = createPluginPrivateStorage('builtin', 'clipboard-history', historyPermissions)
    const historyClipboard = createPluginClipboard('clipboard-history', historyPermissions, historyStorage)
    const materialGeneration = clipboardBlock.getMaterialGeneration()
    const pasteOwner = captureLauncherPasteOwner({
      complete: false,
      isCurrent: () => clipboardBlock.getMaterialGeneration() === materialGeneration && clipboardBlock.hasMaterial(block),
    })
    const historyPaste = createPluginPaste(historyPermissions, historyStorage, { ownerSource: { capture: () => pasteOwner } })
    let pasteAttempted = false
    let pasteCancelled = false
    const requirePasteDelivery = (result: PluginPasteResult) => {
      pasteAttempted = true
      if (isPasteCancelled(result)) {
        pasteCancelled = true
        throw new Error('')
      }
      if (!result.ok) throw new Error(result.message || t(locale, 'palette.quickEntryError'))
    }

    const result = await executeRecommendedAction({ block, action, target }, {
      copyText: writeClipboardText,
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
      getPluginSurfaceInitialTextMode: (pluginId) => getPluginSurfaceDefinition({ source: 'builtin', pluginId, surfaceId: 'main' })?.surface.initialTextMode,
      readLocalFileText: async (path) => {
        const { invoke } = await import('@tauri-apps/api/core')
        return invoke<string>('read_text_material_file', { path })
      },
      pasteText: async (text) => {
        requirePasteDelivery(await historyPaste.pasteText(text))
      },
      pasteImage: async (blobId) => {
        requirePasteDelivery(await historyPaste.pasteImage(blobId))
      },
      writeImage: async (blobId) => {
        await historyClipboard.writeImage(blobId)
      },
      pasteFiles: async (paths) => {
        requirePasteDelivery(await historyPaste.pasteFiles(paths))
      },
    })

    trackLatencyFrom(TelemetryEvents.objectActionLatency, startedAt, {
      actionId: action.id,
      target,
      ok: result.ok,
      blockKind: block.kind,
    })

    if (pasteAttempted && (pasteCancelled || !pasteOwner?.isCurrent())) return
    if (!result.ok) {
      if (generation !== deliveryGenerationRef.current) return
      setDeliveryFailure({
        message: result.error === 'ExecutionFailed' && result.detail
          ? result.detail
          : t(locale, ACTION_ERROR_KEYS[result.error]),
        isCurrent: () => clipboardBlock.getMaterialGeneration() === materialGeneration && clipboardBlock.hasMaterial(block),
      })
      return
    }

    if (result.ok) {
      // Navigation into another Launcher surface is continuation, not completion.
      if (target === 'open-plugin-surface' || useAppStore.getState().launcherHostSurfaceTarget) {
        clipboardBlock.markBlockConsumed()
        setQuery('')
      } else {
        closeLauncherAfterAction()
      }
    }
  }, [clipboardBlock.block, clipboardBlock.getMaterialGeneration, clipboardBlock.hasMaterial, clipboardBlock.markBlockConsumed, closeLauncherAfterAction, locale, openPluginSurface, setQuery])

  const selectItemWithObjectActions = useCallback((item: GlobalLauncherItem | undefined, customizeParams = false) => {
    if (!item) return
    if (suggestionSession) suggestionSession.selectedActionKey = null
    if (showingSuggestions && currentSuggestionKeys.has(item.id) && suggestionSession) {
      if (filterAvailableLauncherItems([item.domainItem], 'global-launcher').length !== 1) return
      recordSuggestionShown(suggestionSession)
      recordSuggestionSelected(suggestionSession, item.id)
    }

    // Support both current prefix and the retired history-only prefix.
    const objectActionId = item.id.startsWith('object-action:')
      ? item.id.slice('object-action:'.length)
      : item.id.startsWith('history-object-action:')
        ? item.id.slice('history-object-action:'.length)
        : null
    if (objectActionId === CURRENT_MATERIAL_COMPARE_ACTION) {
      const pair = item.kind === 'domain' ? materialComparisonScopesRef.current.get(item.domainItem) : undefined
      if (!pair?.isCurrent()) return
      clipboardBlock.cancelFileTextRead()
      setDeliveryFailure(null)
      void materialComparisonRef.current(pair, {
        prepare: () => ensurePluginRuntimeReady('builtin'),
        available: () => {
          const definition = pluginRegistry.getPluginDefinition('text-diff', 'builtin')
          return isCurrentBundledDefinition('text-diff', 'builtin', definition) &&
            pluginRegistry.getPluginLifetime('text-diff', 'builtin').active &&
            Boolean(definition?.ui?.surfaces?.some(surface => surface.id === 'main'))
        },
        titles: { previous: t(locale, 'palette.previousMaterial'), current: t(locale, 'palette.currentMaterial') },
        open: openLauncherHostedPluginSurface,
      }).then(error => {
        if (error && pair.isCurrent()) setDeliveryFailure({
          message: t(locale, error === 'too-large' ? 'palette.materialComparisonTooLarge' : 'palette.materialComparisonUnavailable'),
          isCurrent: pair.isCurrent,
        })
      })
      return
    }
    if (objectActionId === CURRENT_TEXT_EXPORT_ACTION) {
      const scope = item.kind === 'domain' ? currentTextExportScopesRef.current.get(item.domainItem) : undefined
      if (!scope?.isCurrent()) return
      clipboardBlock.cancelFileTextRead()
      void executeCurrentTextExport(scope)
      return
    }
    if (objectActionId && isCurrentTextDeliveryAction(objectActionId)) {
      const scope = item.kind === 'domain' ? currentTextScopesRef.current.get(item.domainItem) : undefined
      if (!scope?.isCurrent()) return
      clipboardBlock.cancelFileTextRead()
      void executeCurrentTextAction(scope, objectActionId)
      return
    }
    clipboardBlock.cancelFileTextRead()
    if (objectActionId != null) {
      const fromCatalog = objectActions.find((entry) => entry.id === objectActionId)
      const action: RecommendedAction = fromCatalog ?? { ...OPEN_QUICK_EDITOR, id: objectActionId }
      void executeObjectAction(action, action.defaultOutput)
      return
    }
    if (item.kind === 'domain' && item.domainItem.systemKey.startsWith('settings-field:')) {
      // Enter on the default top row is an explicit destination too. Keep its
      // identity while async results arrive behind the settings page.
      const index = visibleFiltered.findIndex((candidate) => candidate.id === item.id)
      if (index >= 0) setSelectedIndex(index)
    }
    selectItem(item, customizeParams)
  }, [clipboardBlock.cancelFileTextRead, executeCurrentTextAction, executeCurrentTextExport, executeObjectAction, objectActions, selectItem, setSelectedIndex, visibleFiltered, showingSuggestions, suggestionSession, currentSuggestionKeys, locale])


  const beginDrag = useGlobalLauncherNativeDrag(standaloneLauncher)
  const backdropPointerDownRef = useRef(false)
  const beginResize = useCallback((direction: LauncherWindowResizeDirection) => {
    void startCurrentLauncherWindowResize(direction).catch((error) => {
      console.warn('[hiven] Failed to resize launcher window:', error)
    })
  }, [])

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
      onPointerDownCapture={(event) => {
        // Native edge resize can finish with a click retargeted to the gutter.
        // Dismiss only an intentional background click, not that drag's end.
        backdropPointerDownRef.current = event.button === 0 && event.target === event.currentTarget
      }}
      onPointerCancel={() => { backdropPointerDownRef.current = false }}
      onClick={(event) => {
        const startedOnBackdrop = backdropPointerDownRef.current
        backdropPointerDownRef.current = false
        if (!open) return
        if (startedOnBackdrop && event.target === event.currentTarget) closeLauncher()
      }}
    >
      <GlobalLauncherPanel
        panelRef={panelRef}
        inputRef={inputRef}
        bindSearchInputRef={bindSearchInputRef}
        controllerRef={controllerRef}
        isImeComposingRef={isImeComposingRef}
        isKeyboardNavRef={isKeyboardNavRef}
        busy={currentTextBusy || (controllerState?.busy ?? false)}
        panelStyle={panelStyle}
        beginDrag={beginDrag as never}
        launcherSettingsTarget={launcherSettingsTarget}
        closeSettingsDialog={closeSettingsDialog}
        focusSearchInputAfterBack={focusSearchInputAfterBack}
        surfaceFrame={surfaceFrame}
        activeSurfaceFrame={activeSurfaceFrame}
        surfaceFillsWindow={resizableSurface}
        onSurfaceUnsavedChangesReport={surfaceBackgroundIdle.onUnsavedChangesReport}
        leaveSurface={leaveSurface}
        itemPermissionFrame={itemPermissionFrame}
        cancelItemPermissionPrompt={cancelItemPermissionPrompt}
        grantItemPermissionsAndRun={grantItemPermissionsAndRun}
        controllerState={controllerState && visibleDeliveryError !== controllerState.error
          ? { ...controllerState, error: visibleDeliveryError }
          : controllerState}
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
        searchRecovery={searchRecovery}
        setQuery={(value) => {
          setBrowsingActions(false)
          setBrowseCategory('all')
          setQuery(value)
        }}
        browsingActions={browsingActions}
        browseCategory={browseCategory}
        onBrowseCategoryChange={(category) => {
          setSelectedIndex(0, { pin: false })
          setBrowseCategory(category)
        }}
        onBrowseActions={() => {
          setQuery('')
          setSelectedIndex(0, { pin: false })
          setBrowseCategory('all')
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
      />
      {open && resizableSurface && <WindowResizeHandles inset={8} onResizeStart={beginResize} />}
    </div>
  )
}
