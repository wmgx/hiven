import { createSearchAttempt, type LauncherSearchRecovery } from './searchRecovery'
import { getSuggestionSession, recordSuggestionSuccess } from './contextSuggestionsStore'
import { captureLauncherPasteOwner, checkPendingPasteRecovery } from '../pasteRecovery'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject } from 'react'
import { makePluginT } from '../../i18n/pluginI18nRegistry'
import { detectContent } from '../../kits/content'
import { refreshHostApplicationIndexIfStale, subscribeHostAppIndexUpdated } from '../appLauncher/hostAppLauncher'
import { useAppStore } from '../../store'
import { subscribeDesktopTargets, getDesktopTargetsVersion } from '../desktopTargets/registry'
import { pluginRegistry, usePluginRegistryVersion } from '../pluginRegistry'
import { resolvePluginSettings, usePluginSettingsStore } from '../pluginSettingsStore'
import type { ContributionSource } from '../pluginTypes'
import { LauncherController, type LauncherControllerState } from './controller'
import { createPluginLauncherApi, createPluginLauncherStorage } from './pluginApi'
import { createPluginNetwork } from '../pluginNetwork'
import { createPluginAi } from '../ai/runtime'
import { requestOpenLauncherHostSurface } from '../launcherHostSurfaceBridge'
import { createPluginShell } from '../pluginShell'
import { getPluginPermissionSnapshot, usePluginPermissionStore } from '../pluginPermissions'
import { resolvePluginSettingsSource } from './pluginSource'
import {
  hasLinuxDesktopWindowSearch,
  isExplicitWindowSearch,
  releaseDesktopWindowSearch,
  setDesktopWindowRootSearchEnabled,
  subscribeDesktopWindowsUpdated,
} from '../desktopControl/windows'
import { rankLauncherItems } from './ranking'
import {
  collectDynamicItems,
  collectStaticCandidates,
  filterDynamicForSurface,
  filterAvailableLauncherItems,
} from './registry'
import { resolvePreservedSelection, type SelectableExtraRow } from './selectionPreserve'
import {
  buildPersistableRecentLauncherItems,
  pruneRetiredPersistableRecents,
  payloadFromLauncherItem,
} from './persistableRecents'
import {
  installLauncherPerfDebugApi,
  logLauncherPerf,
  logLauncherPerfDuration,
  launcherPerfNow,
  measureLauncherPerfSync,
} from './perf'
import type {
  LauncherHostId,
  OutputIntent,
  LauncherItem,
  LauncherSurfaceId,
  PluginLauncherApi,
} from './types'
import { normalizeLauncherSurfaceId } from './types'

/** Local compute plugins (calc / timestamp / regex match) — keep near-instant. */
const PLUGIN_DYNAMIC_DEBOUNCE_MS = 60
/** Host app / window / browser indexes are memory-backed while typing. */
const HOST_DYNAMIC_DEBOUNCE_MS = 0
/**
 * Empty-open: wait a frame so static list paints before any host dynamic work.
 * Previously debounce was 0 on empty open and felt like a freeze on first show.
 */
const HOST_EMPTY_OPEN_DELAY_MS = 120
const EMPTY_DYNAMIC_ITEMS: readonly LauncherItem[] = []

type UseLauncherSessionOptions = {
  hostId: LauncherSurfaceId
  open: boolean
  requestClose: (intent?: OutputIntent) => void
  staticItemFilter?: (items: LauncherItem[]) => LauncherItem[]
  mapCandidate?: (item: LauncherItem) => LauncherItem
  collectDynamicWhenEmpty?: boolean
  /** Skip dynamic providers and remote fallback ranking for a frozen local-only flow. */
  allowDynamicItems?: boolean
  objectBlockText?: string
  getMaterialGeneration?: () => number | undefined
  /** Leaving a command keeps its typed input as a Block. */
  keepInputAsBlock?: (text: string) => void
  /** Rendered list identity when the host prepends rows outside ranking. */
  visibleSelectionItemsRef?: MutableRefObject<readonly LauncherItem[]>
  /** Host-owned rows outside the visible item array (for example, index -1). */
  extraSelectionRowsRef?: MutableRefObject<readonly SelectableExtraRow[]>
  /** Foreground application name when host can resolve it (contextBoost). */
  foregroundApp?: string
  makeApi?: (api: PluginLauncherApi, item?: LauncherItem) => PluginLauncherApi
}

export type LauncherSession = {
  hostId: LauncherHostId
  query: string
  /** Query snapshot used by ranking, rendering, and execution. */
  rankingQuery: string
  searchRecovery: LauncherSearchRecovery
  setQuery: (value: string) => void
  selectedIndex: number
  /**
   * Update highlight index.
   * - User paths (↑↓ / intentional hover): default `pin: true` — sticky across partials.
   * - Programmatic defaults (query change / open / close): pass `{ pin: false }`.
   */
  setSelectedIndex: (
    value: number | ((current: number) => number),
    options?: { pin?: boolean },
  ) => void
  controller: LauncherController | null
  controllerRef: MutableRefObject<LauncherController | null>
  controllerState: LauncherControllerState | null
  rankedItems: LauncherItem[]
  /** Current resolved candidates before ranking caps, strictly eligible for discovery. */
  availableItems: LauncherItem[]
  syncSelection: () => void
  reset: () => void
}

function mergePartials(
  partials: Map<string, LauncherItem[]>,
  sortKeys = false,
): LauncherItem[] {
  const entries = [...partials.entries()]
  if (sortKeys) entries.sort(([left], [right]) => left.localeCompare(right))
  return entries.flatMap(([, items]) => items)
}

function launcherInputIdentity(query: string, objectBlockText?: string): string {
  return JSON.stringify([query.trim(), objectBlockText?.trim() ?? ''])
}

function useFrameBatchedLauncherItems() {
  const [state, setState] = useState<{ inputIdentity: string | null; items: LauncherItem[] }>({
    inputIdentity: null,
    items: [],
  })
  const pendingRef = useRef<{ inputIdentity: string | null; items: LauncherItem[]; isCurrent?: () => boolean } | null>(null)
  const frameRef = useRef<number | null>(null)

  const apply = useCallback((items: LauncherItem[], inputIdentity: string | null) => {
    setState((current) => (
      current.inputIdentity === inputIdentity &&
      current.items.length === items.length &&
      current.items.every((item, index) => item === items[index])
        ? current
        : { inputIdentity, items }
    ))
  }, [])

  const setItems = useCallback((items: LauncherItem[], inputIdentity: string | null = null) => {
    pendingRef.current = null
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    apply(items, inputIdentity)
  }, [apply])

  const setItemsNextFrame = useCallback((items: LauncherItem[], inputIdentity: string, isCurrent?: () => boolean) => {
    pendingRef.current = { inputIdentity, items, isCurrent }
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const pending = pendingRef.current
      pendingRef.current = null
      if (pending && (!pending.isCurrent || pending.isCurrent())) apply(pending.items, pending.inputIdentity)
    })
  }, [apply])

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
  }, [])

  return [state.items, state.inputIdentity, setItems, setItemsNextFrame] as const
}

export function useLauncherSession({
  hostId,
  open,
  requestClose,
  staticItemFilter,
  mapCandidate,
  collectDynamicWhenEmpty = false,
  allowDynamicItems = true,
  objectBlockText,
  getMaterialGeneration,
  keepInputAsBlock,
  visibleSelectionItemsRef,
  extraSelectionRowsRef,
  foregroundApp,
  makeApi,
}: UseLauncherSessionOptions): LauncherSession {
  const normalizedHostId = normalizeLauncherSurfaceId(hostId)
  const materialGenerationGetterRef = useRef(getMaterialGeneration)
  materialGenerationGetterRef.current = getMaterialGeneration
  const keepInputAsBlockRef = useRef(keepInputAsBlock)
  keepInputAsBlockRef.current = keepInputAsBlock
  const locale = useAppStore((s) => s.locale)
  const appSearchAliases = useAppStore((s) => s.settings.appSearchAliases)
  const appSearchAliasesRef = useRef(appSearchAliases)
  const launcherUsageBySurface = useAppStore((s) => s.launcherUsageBySurface)
  const recordLauncherSelection = useAppStore((s) => s.recordLauncherSelection)
  const launcherFavoriteKeys = useAppStore((s) => s.launcherFavoriteKeys)
  const launcherPersistableRecents = useAppStore((s) => s.launcherPersistableRecents)
  const recordPersistableLauncherSelection = useAppStore((s) => s.recordPersistableLauncherSelection)
  const rankingNow = useMemo(() => Date.now(), [open])
  const pluginRegistryVersion = usePluginRegistryVersion()
  const desktopTargetsVersion = useSyncExternalStore(subscribeDesktopTargets, getDesktopTargetsVersion, getDesktopTargetsVersion)
  // toolsFor and launcher.itemsFor depend on live settings; recollect after edits.
  const pluginSettings = usePluginSettingsStore((s) => s.pluginSettings)
  const pluginPermissions = usePluginPermissionStore((s) => s.permissions)

  const [query, setQueryState] = useState('')
  const queryRef = useRef('')
  const [selectedIndex, setSelectedIndexState] = useState(0)
  const [controllerState, setControllerState] = useState<LauncherControllerState | null>(null)
  const [controller, setController] = useState<LauncherController | null>(null)
  /** Plugin dynamicItems (calc, timestamp, web-open, …) — progressive. */
  const [pluginDynamicItems, pluginInputIdentity, setPluginDynamicItems, setPluginDynamicItemsNextFrame] = useFrameBatchedLauncherItems()
  /** Host dynamic items (apps / bridge tabs) — isolated from plugin path. */
  const [hostDynamicItems, hostInputIdentity, setHostDynamicItems, setHostDynamicItemsNextFrame] = useFrameBatchedLauncherItems()
  const controllerRef = useRef<LauncherController | null>(null)
  // Registry notifications revoke an open flow synchronously, before React's
  // next render/effect. Controller entry points also check the captured lifetime.
  useEffect(() => pluginRegistry.subscribe(() => controllerRef.current?.invalidateUnavailablePlugin()), [])
  const pluginQueryRef = useRef('')
  const hostQueryRef = useRef('')
  const requestCloseRef = useRef(requestClose)
  const launcherOpenRef = useRef(open)
  launcherOpenRef.current = open
  const prevControllerStateRef = useRef<LauncherControllerState | null>(null)
  const pluginAbortRef = useRef<AbortController | null>(null)
  const hostAbortRef = useRef<AbortController | null>(null)
  /** Per-plugin partial results for the in-flight generation. */
  const pluginPartialsRef = useRef(new Map<string, LauncherItem[]>())
  /**
   * User-pinned row identity. Only set when the user moves selection (↑↓ / hover).
   * Default top-of-list highlight must stay unpinned so async partials re-rank freely.
   */
  const selectedKeyRef = useRef<string | null>(null)
  const rankedItemsRef = useRef<LauncherItem[]>([])
  const selectedIndexRef = useRef(0)
  /** Latest host dynamic rows — open path may keep empty-open cache warm. */
  const hostDynamicItemsRef = useRef<LauncherItem[]>([])

  useEffect(() => {
    requestCloseRef.current = requestClose
  }, [requestClose])

  useEffect(() => {
    installLauncherPerfDebugApi()
  }, [])

  const setSelectedIndex = useCallback((
    value: number | ((current: number) => number),
    options?: { pin?: boolean },
  ) => {
    // Default pin=true: keyboard / hover are intentional user selection.
    const pin = options?.pin !== false
    const next = typeof value === 'function' ? value(selectedIndexRef.current) : value
    const itemKey = (visibleSelectionItemsRef?.current ?? rankedItemsRef.current)[next]?.systemKey
      ?? extraSelectionRowsRef?.current.find((row) => row.index === next)?.systemKey
      ?? null
    selectedIndexRef.current = next
    selectedKeyRef.current = pin ? itemKey : null
    controllerRef.current?.onRootSelectionChanged(itemKey)
    setSelectedIndexState(next)
  }, [extraSelectionRowsRef, visibleSelectionItemsRef])

  const syncSelection = useCallback(() => {
    const resolved = resolvePreservedSelection({
      selectedKey: selectedKeyRef.current,
      selectedIndex: selectedIndexRef.current,
      items: visibleSelectionItemsRef?.current ?? rankedItemsRef.current,
      extraRows: extraSelectionRowsRef?.current,
    })
    selectedKeyRef.current = resolved.key
    const itemKey = (visibleSelectionItemsRef?.current ?? rankedItemsRef.current)[resolved.index]?.systemKey
      ?? extraSelectionRowsRef?.current.find((row) => row.index === resolved.index)?.systemKey
      ?? null
    controllerRef.current?.onRootSelectionChanged(itemKey)
    if (resolved.index === selectedIndexRef.current) return
    selectedIndexRef.current = resolved.index
    setSelectedIndexState(resolved.index)
  }, [extraSelectionRowsRef, visibleSelectionItemsRef])

  /** Typing starts a new result generation — drop sticky key so highlight tracks ranking top. */
  const setQuery = useCallback((value: string) => {
    if (queryRef.current === value) return
    queryRef.current = value
    searchOwnerRef.current = {}
    controllerRef.current?.onRootQueryChanged()
    selectedKeyRef.current = null
    selectedIndexRef.current = 0
    setSelectedIndexState(0)
    setQueryState(value)
  }, [])

  const reset = useCallback(() => {
    searchOwnerRef.current = {}
    if (normalizedHostId === 'global-launcher') void releaseDesktopWindowSearch()
    queryRef.current = ''
    setQueryState('')
    selectedKeyRef.current = null
    selectedIndexRef.current = 0
    setSelectedIndexState(0)
    setPluginDynamicItems([])
    setHostDynamicItems([])
    pluginQueryRef.current = ''
    hostQueryRef.current = ''
    pluginPartialsRef.current.clear()
    pluginAbortRef.current?.abort()
    hostAbortRef.current?.abort()
    controllerRef.current?.reset()
  }, [normalizedHostId])

  const windowSearchFrame = controllerState?.frames[controllerState.frames.length - 1]
  const inWindowSearchCommand = windowSearchFrame?.kind === 'collect-input'
    && windowSearchFrame.item.systemKey === 'host:window:switch-command'
  const inRootWindowSearch = (!windowSearchFrame || windowSearchFrame.kind === 'list') && isExplicitWindowSearch(query)

  useEffect(() => {
    if (normalizedHostId !== 'global-launcher') return
    setDesktopWindowRootSearchEnabled(open && (!windowSearchFrame || windowSearchFrame.kind === 'list'))
    if (!open || (!inRootWindowSearch && !inWindowSearchCommand)) {
      void releaseDesktopWindowSearch()
    }
  }, [inWindowSearchCommand, inRootWindowSearch, normalizedHostId, open, windowSearchFrame])

  useEffect(() => {
    if (normalizedHostId !== 'global-launcher') return
    return () => {
      const hadLinuxSearch = hasLinuxDesktopWindowSearch()
      void releaseDesktopWindowSearch()
      // Do not retain window titles in the hidden launcher/controller frames.
      if (hadLinuxSearch) {
        controllerRef.current?.reset()
        setHostDynamicItems(hostDynamicItemsRef.current.filter((item) => !item.systemKey.startsWith('host.window:focus:native:x11:')))
      }
      setDesktopWindowRootSearchEnabled(false)
    }
  }, [normalizedHostId, open])
  useEffect(() => {
    if (!open) return
    const openedAt = launcherPerfNow()
    logLauncherPerf('session:open', { surfaceId: normalizedHostId })
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      // Drop plugin partials (query-bound). Keep last empty-open host
      // apps/windows when the previous host query was also empty — avoids a
      // blank host strip + re-rank flash while the 120ms empty-open delay runs.
      setPluginDynamicItems([])
      const keepWarmHost =
        hostQueryRef.current === '' && hostDynamicItemsRef.current.length > 0
      if (!keepWarmHost) {
        setHostDynamicItems([])
        hostQueryRef.current = ''
      }
      pluginQueryRef.current = ''
      pluginPartialsRef.current.clear()
      if (!controllerRef.current) {
        const nextController = new LauncherController({
          surfaceId: normalizedHostId,
          openAiSettings: normalizedHostId === 'global-launcher'
            ? () => { void requestOpenLauncherHostSurface('system-ai-settings').catch(() => {}) }
            : undefined,
          getMaterialGeneration: materialGenerationGetterRef.current ? () => materialGenerationGetterRef.current?.() : undefined,
          keepInputAsBlock: (text) => keepInputAsBlockRef.current?.(text),
          api: makeApi?.(createPluginLauncherApi()) ?? createPluginLauncherApi(),
          makeApi: (item, isPasteCurrent) => {
            const materialGeneration = materialGenerationGetterRef.current?.()
            const pasteOwner = normalizedHostId === 'global-launcher'
              ? captureLauncherPasteOwner({ complete: false, isCurrent: () => isPasteCurrent?.() !== false &&
                  materialGenerationGetterRef.current?.() === materialGeneration })
              : undefined
            const requestedPermissions = item.pluginId && item.source
              ? pluginRegistry.getPluginPermissions(item.pluginId, item.source)
              : []
            const api = createPluginLauncherApi({
              pluginId: item.pluginId,
              source: item.source,
              requestedPermissions,
              pasteOwnerSource: normalizedHostId === 'global-launcher' ? { capture: () => pasteOwner } : undefined,
            })
            return makeApi?.(api, item) ?? api
          },
          getStorage: (item) => {
            const requestedPermissions = item.pluginId && item.source
              ? pluginRegistry.getPluginPermissions(item.pluginId, item.source)
              : []
            return createPluginLauncherStorage({
              pluginId: item.pluginId,
              source: item.source,
              requestedPermissions,
            })
          },
          getNetwork: (item) => {
            const requestedPermissions = item.pluginId && item.source
              ? pluginRegistry.getPluginPermissions(item.pluginId, item.source)
              : []
            const source = item.source ?? 'builtin'
            const pluginId = item.pluginId ?? ''
            return createPluginNetwork(getPluginPermissionSnapshot(source, pluginId, requestedPermissions))
          },
          getShell: (item) => {
            const requestedPermissions = item.pluginId && item.source
              ? pluginRegistry.getPluginPermissions(item.pluginId, item.source)
              : []
            const source = item.source ?? 'builtin'
            const pluginId = item.pluginId ?? ''
            return createPluginShell(getPluginPermissionSnapshot(source, pluginId, requestedPermissions))
          },
          getAi: (item) => {
            const requestedPermissions = item.pluginId && item.source
              ? pluginRegistry.getPluginPermissions(item.pluginId, item.source)
              : []
            const source = item.source ?? 'builtin'
            const pluginId = item.pluginId ?? ''
            return createPluginAi(
              pluginId,
              source,
              getPluginPermissionSnapshot(source, pluginId, requestedPermissions),
            )
          },
          locale,
          makeT: (item) => makePluginT(item.pluginId ?? '', locale),
          getSettings: getLauncherItemSettings,
          captureSuccessfulSelection: () => {
            const session = normalizedHostId === 'global-launcher' ? getSuggestionSession() : null
            const selectedKey = session?.selectedActionKey
            return item => recordSuggestionSuccess(session, item.systemKey, selectedKey === item.systemKey)
          },
          recordSelection: (surfaceId, item) => {
            recordLauncherSelection(surfaceId, item.systemKey)
            // Plugin-declared durable content → host recents for next-session recommend.
            const payload = payloadFromLauncherItem(item)
            if (payload) {
              recordPersistableLauncherSelection(payload)
            }
          },
          requestClose: intent => requestCloseRef.current(intent),
          onReturnToRoot: () => {
            queryRef.current = ''
            setQueryState('')
          },
          onChange: (state) => {
            if (normalizedHostId === 'global-launcher') {
              setDesktopWindowRootSearchEnabled(launcherOpenRef.current && state.frames[state.frames.length - 1]?.kind === 'list')
            }
            const prev = prevControllerStateRef.current
            if (prev && prev.busy === state.busy && prev.deliveryIntent === state.deliveryIntent && prev.error === state.error && prev.frames === state.frames) {
              return
            }
            prevControllerStateRef.current = state
            setControllerState(state)
            checkPendingPasteRecovery()
          },
        })
        controllerRef.current = nextController
        setController(nextController)
      }
      controllerRef.current.updateLocale(locale, (item) => makePluginT(item.pluginId ?? '', locale))
      controllerRef.current.reset()
      logLauncherPerfDuration('session:open:controller-reset', openedAt, { surfaceId: normalizedHostId })
    })
    return () => { cancelled = true }
  }, [locale, makeApi, normalizedHostId, open, recordLauncherSelection, recordPersistableLauncherSelection])

  const searchOwner = useMemo(() => ({}), [open, query, objectBlockText, normalizedHostId, locale, pluginSettings, pluginRegistryVersion])
  const searchOwnerRef = useRef(searchOwner)
  searchOwnerRef.current = searchOwner
  const [searchRetry, setSearchRetry] = useState(0)
  const [searchStatus, setSearchStatus] = useState<{ owner: object; failed: boolean; pending: boolean } | null>(null)
  const retryOwnerRef = useRef<object | null>(null)
  /** Owner whose host (apps/windows) provider failed; folded into the plugin attempt's status. */
  const hostFailedOwnerRef = useRef<object | null>(null)
  const reportHostFailure = () => {
    const owner = searchOwnerRef.current
    hostFailedOwnerRef.current = owner
    setSearchStatus((prev) => (prev && prev.owner === owner ? { ...prev, failed: true } : prev))
  }
  const retrySearch = () => {
    if (!open || searchOwnerRef.current !== searchOwner || searchStatus?.owner !== searchOwner
      || !searchStatus.failed || searchStatus.pending || retryOwnerRef.current === searchOwner) return
    retryOwnerRef.current = searchOwner
    setSearchStatus({ owner: searchOwner, failed: true, pending: true })
    setSearchRetry(value => value + 1)
  }

  // ── Plugin dynamic path (fast debounce, progressive partials) ──────────────
  useEffect(() => {
    if (!open) return
    if (!allowDynamicItems) {
      setPluginDynamicItems([])
      pluginQueryRef.current = ''
      pluginPartialsRef.current.clear()
      pluginAbortRef.current?.abort()
      return
    }
    const owner = searchOwner
    const current = () => launcherOpenRef.current && searchOwnerRef.current === owner
    const retrying = retryOwnerRef.current === owner
    const attempt = createSearchAttempt(current, (failed, pending) => {
      if (!pending && retryOwnerRef.current === owner) retryOwnerRef.current = null
      setSearchStatus({ owner, failed: failed || hostFailedOwnerRef.current === owner, pending })
    }, retrying)
    setSearchStatus({ owner, failed: retrying, pending: true })
    const q = query.trim()
    const inputText = q || objectBlockText?.trim() || ''
    const inputIdentity = launcherInputIdentity(q, objectBlockText)
    if (!inputText && !collectDynamicWhenEmpty) {
      setPluginDynamicItems([])
      pluginQueryRef.current = ''
      pluginPartialsRef.current.clear()
      pluginAbortRef.current?.abort()
      attempt.finish()
      return
    }

    // A settings/registry edit starts a new generation even when text is unchanged.
    setPluginDynamicItems([])
    pluginQueryRef.current = q
    const timer = window.setTimeout(() => {
      if (pluginQueryRef.current !== q || !current()) return
      pluginAbortRef.current?.abort()
      const abortController = new AbortController()
      pluginAbortRef.current = abortController
      pluginPartialsRef.current = new Map()
      setPluginDynamicItems([])
      const startedAt = launcherPerfNow()
      void collectDynamicItems(q, normalizedHostId, locale, getPluginSettings, inputText, {
        includeHost: false,
        includePlugins: true,
        signal: abortController.signal,
        onPartial: (update) => {
          if (abortController.signal.aborted || !current()) return
          if (pluginQueryRef.current !== q || !current()) return
          if (update.kind !== 'plugin' || !update.pluginId) return
          attempt.report(update.pluginId, update.failed === true)
          pluginPartialsRef.current.set(update.pluginId, update.items)
          const merged = filterDynamicForSurface(mergePartials(pluginPartialsRef.current), normalizedHostId)
          setPluginDynamicItemsNextFrame(merged, inputIdentity, () => !abortController.signal.aborted && current())
        },
      }).then((items) => {
        if (abortController.signal.aborted || !current()) return
        logLauncherPerfDuration('session:plugin-dynamic-items', startedAt, {
          surfaceId: normalizedHostId,
          queryLength: q.length,
          hasObjectBlockText: Boolean(objectBlockText),
          itemCount: items.length,
        })
        if (pluginQueryRef.current !== q || !current()) return
        const merged = pluginPartialsRef.current.size > 0
          ? mergePartials(pluginPartialsRef.current)
          : items
        setPluginDynamicItems(filterDynamicForSurface(merged, normalizedHostId), inputIdentity)
        attempt.finish()
      }).catch(() => { if (!abortController.signal.aborted) attempt.finish(true) })
    }, q || inputText ? PLUGIN_DYNAMIC_DEBOUNCE_MS : 0)

    return () => {
      attempt.cancel()
      window.clearTimeout(timer)
      pluginAbortRef.current?.abort()
    }
  }, [allowDynamicItems, collectDynamicWhenEmpty, locale, normalizedHostId, objectBlockText, open, query, pluginSettings, pluginRegistryVersion, searchOwner, searchRetry])

  // Rescan installed apps when the launcher opens (throttled inside); re-collect once new apps land.
  const [appIndexVersion, setAppIndexVersion] = useState(0)
  useEffect(() => {
    if (!open || !allowDynamicItems) return
    const unsubscribe = subscribeHostAppIndexUpdated(() => setAppIndexVersion((v) => v + 1))
    refreshHostApplicationIndexIfStale()
    return unsubscribe
  }, [allowDynamicItems, open])

  // ── Host dynamic path (apps) — isolated, longer debounce ────────
  useEffect(() => {
    if (!open) return
    if (!allowDynamicItems) {
      setHostDynamicItems([])
      hostQueryRef.current = ''
      hostAbortRef.current?.abort()
      return
    }
    const q = query.trim()
    const inputText = q || objectBlockText?.trim() || ''
    const inputIdentity = launcherInputIdentity(q, objectBlockText)
    if (!inputText && !collectDynamicWhenEmpty) {
      setHostDynamicItems([])
      hostQueryRef.current = ''
      hostAbortRef.current?.abort()
      return
    }

    // Alias edits can change matches for an unchanged query. Clear the prior
    // generation before scheduling the replacement; cleanup aborts old work.
    if (appSearchAliasesRef.current !== appSearchAliases) {
      appSearchAliasesRef.current = appSearchAliases
      setHostDynamicItems([])
    }
    hostQueryRef.current = q
    // Empty open: delay past first paint. Typing: normal debounce.
    const delayMs = q ? HOST_DYNAMIC_DEBOUNCE_MS : HOST_EMPTY_OPEN_DELAY_MS
    const scheduledAt = launcherPerfNow()
    logLauncherPerf('session:host-dynamic-schedule', {
      queryLength: q.length,
      debounceMs: delayMs,
      emptyOpen: !q,
    })
    const timer = window.setTimeout(() => {
      if (hostQueryRef.current !== q) return
      if (hostFailedOwnerRef.current === searchOwnerRef.current) hostFailedOwnerRef.current = null
      logLauncherPerfDuration('session:host-dynamic-debounce-wait', scheduledAt, {
        queryLength: q.length,
        debounceMs: delayMs,
        expectedWait: true,
      })
      hostAbortRef.current?.abort()
      const abortController = new AbortController()
      hostAbortRef.current = abortController
      const startedAt = launcherPerfNow()
      void collectDynamicItems(q, normalizedHostId, locale, getPluginSettings, inputText, {
        includeHost: true,
        includePlugins: false,
        signal: abortController.signal,
        onPartial: (update) => {
          if (abortController.signal.aborted) return
          if (hostQueryRef.current !== q) return
          if (update.kind !== 'host') return
          if (update.failed) reportHostFailure()
          const applyStartedAt = launcherPerfNow()
          setHostDynamicItemsNextFrame(filterDynamicForSurface(update.items, normalizedHostId), inputIdentity, () => !abortController.signal.aborted)
          logLauncherPerfDuration('session:host-dynamic-partial-apply', applyStartedAt, {
            itemCount: update.items.length,
          })
        },
      }).then((items) => {
        if (abortController.signal.aborted) return
        logLauncherPerfDuration('session:host-dynamic-items', startedAt, {
          surfaceId: normalizedHostId,
          queryLength: q.length,
          itemCount: items.length,
        })
        if (hostQueryRef.current !== q) return
        setHostDynamicItems(filterDynamicForSurface(items, normalizedHostId), inputIdentity)
      }).catch(() => { if (!abortController.signal.aborted) reportHostFailure() })
    }, delayMs)

    return () => {
      window.clearTimeout(timer)
      hostAbortRef.current?.abort()
    }
  }, [allowDynamicItems, appSearchAliases, collectDynamicWhenEmpty, locale, normalizedHostId, objectBlockText, open, query, pluginRegistryVersion, pluginPermissions, desktopTargetsVersion, appIndexVersion, searchRetry])

  // When offline window-title enrich finishes, re-collect host items so titles/icons update.
  useEffect(() => {
    if (!open || !allowDynamicItems) return
    return subscribeDesktopWindowsUpdated(() => {
      const q = hostQueryRef.current
      const inputText = q || objectBlockText?.trim() || ''
      const inputIdentity = launcherInputIdentity(q, objectBlockText)
      if (!inputText && !collectDynamicWhenEmpty) return
      hostAbortRef.current?.abort()
      const abortController = new AbortController()
      hostAbortRef.current = abortController
      void collectDynamicItems(q, normalizedHostId, locale, getPluginSettings, inputText, {
        includeHost: true,
        includePlugins: false,
        signal: abortController.signal,
      }).then((items) => {
        if (abortController.signal.aborted) return
        if (hostQueryRef.current !== q) return
        setHostDynamicItems(filterDynamicForSurface(items, normalizedHostId), inputIdentity)
      }).catch(() => { if (!abortController.signal.aborted) reportHostFailure() })
    })
  }, [allowDynamicItems, collectDynamicWhenEmpty, locale, normalizedHostId, objectBlockText, open])

  // Collect static candidates separately — they change with plugin registry or
  // plugin settings (toolsFor / itemsFor), not on every keystroke.
  const staticCandidates = useMemo<LauncherItem[]>(() => {
    void pluginRegistryVersion
    void pluginSettings
    const raw = measureLauncherPerfSync('session:static-candidates', () => collectStaticCandidates(normalizedHostId), () => ({
      surfaceId: normalizedHostId,
    }))
    return staticItemFilter ? staticItemFilter(raw) : raw
  }, [normalizedHostId, open, pluginRegistryVersion, pluginSettings, staticItemFilter])

  useEffect(() => {
    if (normalizedHostId !== 'global-launcher') return
    const recents = pruneRetiredPersistableRecents(launcherPersistableRecents)
    if (recents !== launcherPersistableRecents) useAppStore.setState({ launcherPersistableRecents: recents })
  }, [launcherPersistableRecents, normalizedHostId])

  /** Host recents from plugin-opted persistable selections (contacts/chats/docs). */
  const persistableRecentItems = useMemo<LauncherItem[]>(() => {
    if (normalizedHostId !== 'global-launcher') return []
    return buildPersistableRecentLauncherItems({
      recents: launcherPersistableRecents,
      query: query.trim(),
      locale,
    })
  }, [launcherPersistableRecents, locale, normalizedHostId, query])

  // Keep open-path warm-cache decision off the render dependency list.
  hostDynamicItemsRef.current = hostDynamicItems

  const rankQuery = query.trim()
  const inputIdentity = launcherInputIdentity(rankQuery, objectBlockText)
  // Empty or stale generations do not change the visible candidates. Keep their
  // dependencies stable without retaining nonempty rows or their old callbacks.
  const visiblePluginDynamicItems = pluginInputIdentity === inputIdentity && pluginDynamicItems.length > 0
    ? pluginDynamicItems : EMPTY_DYNAMIC_ITEMS
  const visibleHostDynamicItems = hostInputIdentity === inputIdentity && hostDynamicItems.length > 0
    ? hostDynamicItems : EMPTY_DYNAMIC_ITEMS

  const resolvedCandidateItems = useMemo<LauncherItem[]>(() => {
    // Any live result wins over its rehydrated recent snapshot. Keeping both
    // also creates duplicate React keys, which corrupts visible quick-run indices.
    const liveKeys = new Set([...staticCandidates, ...visiblePluginDynamicItems, ...visibleHostDynamicItems].map((item) => item.systemKey))
    const recentsDeduped = persistableRecentItems.filter((item) => !liveKeys.has(item.systemKey))
    const items = [...staticCandidates, ...visiblePluginDynamicItems, ...visibleHostDynamicItems,
      ...recentsDeduped]
    return mapCandidate ? items.map(mapCandidate) : items
  }, [query, objectBlockText, visiblePluginDynamicItems, visibleHostDynamicItems,
    staticCandidates, persistableRecentItems, mapCandidate])

  const availableItems = useMemo(() => {
    void pluginPermissions
    void pluginRegistryVersion
    return filterAvailableLauncherItems(resolvedCandidateItems, normalizedHostId)
  }, [resolvedCandidateItems, normalizedHostId, pluginPermissions, pluginRegistryVersion])

  const rankedItems = useMemo<LauncherItem[]>(() => {
    // The original ranking input and scoring remain shared by every host.
    const rankQuery = query.trim()
    const contentText = objectBlockText ?? (rankQuery || undefined)
    const detections = contentText ? detectContent(contentText, { source: objectBlockText ? 'clipboard' : 'query' }) : []
    return measureLauncherPerfSync('session:rank-items', () => rankLauncherItems(
      {
        query: rankQuery,
        locale,
        surfaceId: normalizedHostId,
        usage: launcherUsageBySurface,
        now: rankingNow,
        contentText,
        detections,
        foregroundApp,
        favoriteKeys: launcherFavoriteKeys,
      },
      resolvedCandidateItems,
    ), (items) => ({
      surfaceId: normalizedHostId,
      queryLength: rankQuery.length,
      hasObjectBlockText: Boolean(objectBlockText),
      inputCount: resolvedCandidateItems.length,
      resultCount: items.length,
    }))
  }, [
    foregroundApp,
    launcherFavoriteKeys,
    launcherUsageBySurface,
    locale,
    normalizedHostId,
    objectBlockText,
    query,
    rankingNow,
    resolvedCandidateItems,
  ])
  // After progressive partials / re-rank:
  // - user-pinned key → follow that row
  // - default (no pin) → stay on ranking top (index 0)
  useEffect(() => {
    rankedItemsRef.current = rankedItems
    syncSelection()
  }, [rankedItems, syncSelection])

  return {
    hostId: normalizedHostId,
    query,
    rankingQuery: query,
    searchRecovery: { failed: open && searchStatus?.owner === searchOwner && searchStatus.failed,
      pending: searchStatus?.owner === searchOwner && searchStatus.pending, retry: retrySearch },
    setQuery,
    selectedIndex,
    setSelectedIndex,
    controller,
    controllerRef,
    controllerState,
    rankedItems,
    availableItems,
    syncSelection,
    reset,
  }
}

export function getPluginSettings(pluginId: string, source: ContributionSource): unknown {
  const def = pluginRegistry.getPluginDefinition(pluginId, source)
  const settingsContribution = def?.settings
  if (!settingsContribution) return undefined
  const settingsSource = resolvePluginSettingsSource(pluginId, source)
  return resolvePluginSettings(settingsSource, pluginId, settingsContribution).value
}

function getLauncherItemSettings(item: LauncherItem): unknown {
  if (!item.pluginId || !item.source) return undefined
  return getPluginSettings(item.pluginId, item.source as never)
}
