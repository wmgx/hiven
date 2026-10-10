import { captureLauncherPasteOwner, checkPendingPasteRecovery } from '../pasteRecovery'
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { makePluginT } from '../../i18n/pluginI18nRegistry'
import { translate } from '../../i18n'
import { detectContent } from '../../kits/content'
import { useAppStore } from '../../store'
import { pluginRegistry, usePluginRegistryVersion } from '../pluginRegistry'
import { resolvePluginSettings, usePluginSettingsStore } from '../pluginSettingsStore'
import type { ContributionSource } from '../pluginTypes'
import { LauncherController, type LauncherControllerState } from './controller'
import { createPluginLauncherApi, createPluginLauncherStorage } from './pluginApi'
import { createPluginNetwork } from '../pluginNetwork'
import { createPluginAi } from '../ai/runtime'
import { chooseJevCandidate, validJevSettings } from '../ai/jev'
import { resolveDisplaySubtitle, resolveDisplayTitle } from './display'
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
import { getDesktopDocumentLauncherDynamicItems } from '../desktopTargets/collectDocumentLauncherItems'
import { rankLauncherItems } from './ranking'
import {
  collectDynamicItems,
  collectStaticCandidates,
  getNearbySaveRunItem,
  filterDynamicForSurface,
  filterAvailableLauncherItems,
} from './registry'
import { resolvePreservedSelection, type SelectableExtraRow } from './selectionPreserve'
import {
  buildPersistableRecentLauncherItems,
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
  LauncherItem,
  LauncherSurfaceId,
  PluginLauncherApi,
} from './types'
import { normalizeLauncherSurfaceId } from './types'
import { subscribeSavedActions } from '../savedActions/store'
import { getLastSaveableRun, subscribeLastSaveableRun } from '../savedActions/lastSaveableRun'
import type { LastSaveableRunState } from '../savedActions/types'

/** Local compute plugins (calc / timestamp / regex match) — keep near-instant. */
const PLUGIN_DYNAMIC_DEBOUNCE_MS = 60
/** Host app / window / browser indexes are memory-backed while typing. */
const HOST_DYNAMIC_DEBOUNCE_MS = 0
/**
 * Empty-open: wait a frame so static list paints before any host dynamic work.
 * Previously debounce was 0 on empty open and felt like a freeze on first show.
 */
const HOST_EMPTY_OPEN_DELAY_MS = 120
/**
 * Remote document Desktop Targets (feishu.docs / chats / contacts via lark-cli).
 * Longer debounce so intermediate IME / pinyin fragments do not stack CLI processes.
 * (Perf log showed 10–19s pile-ups when 3×CLI fired per partial query.)
 */
const DOCUMENT_DYNAMIC_DEBOUNCE_MS = 520
const JEV_DEBOUNCE_MS = 250
const EMPTY_DYNAMIC_ITEMS: readonly LauncherItem[] = []

type UseLauncherSessionOptions = {
  hostId: LauncherSurfaceId
  open: boolean
  requestClose: () => void
  staticItemFilter?: (items: LauncherItem[]) => LauncherItem[]
  collectDynamicWhenEmpty?: boolean
  objectBlockText?: string
  getMaterialGeneration?: () => number | undefined
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
  nearbySaveItem: LauncherItem | null
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
  const pendingRef = useRef<{ inputIdentity: string | null; items: LauncherItem[] } | null>(null)
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

  const setItemsNextFrame = useCallback((items: LauncherItem[], inputIdentity: string) => {
    pendingRef.current = { inputIdentity, items }
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const pending = pendingRef.current
      pendingRef.current = null
      if (pending) apply(pending.items, pending.inputIdentity)
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
  collectDynamicWhenEmpty = false,
  objectBlockText,
  getMaterialGeneration,
  visibleSelectionItemsRef,
  extraSelectionRowsRef,
  foregroundApp,
  makeApi,
}: UseLauncherSessionOptions): LauncherSession {
  const normalizedHostId = normalizeLauncherSurfaceId(hostId)
  const materialGenerationGetterRef = useRef(getMaterialGeneration)
  materialGenerationGetterRef.current = getMaterialGeneration
  const locale = useAppStore((s) => s.locale)
  const automaticLearningEnabled = useAppStore((s) => s.settings.automaticLearningEnabled)
  const appSearchAliases = useAppStore((s) => s.settings.appSearchAliases)
  const appSearchAliasesRef = useRef(appSearchAliases)
  const jevSettings = useAppStore((s) => s.settings.jevCommandSuggestion)
  const launcherUsageBySurface = useAppStore((s) => s.launcherUsageBySurface)
  const recordLauncherSelection = useAppStore((s) => s.recordLauncherSelection)
  const launcherFavoriteKeys = useAppStore((s) => s.launcherFavoriteKeys)
  const launcherPersistableRecents = useAppStore((s) => s.launcherPersistableRecents)
  const recordPersistableLauncherSelection = useAppStore((s) => s.recordPersistableLauncherSelection)
  const rankingNow = useMemo(() => Date.now(), [open])
  const pluginRegistryVersion = usePluginRegistryVersion()
  // toolsFor and launcher.itemsFor depend on live settings; recollect after edits.
  const pluginSettings = usePluginSettingsStore((s) => s.pluginSettings)
  const pluginPermissions = usePluginPermissionStore((s) => s.permissions)

  const [savedActionVersion, setSavedActionVersion] = useState(0)
  useEffect(() => subscribeSavedActions(() => setSavedActionVersion((version) => version + 1)), [])
  const [lastSaveableRun, setLastSaveableRun] = useState<LastSaveableRunState | null>(null)
  useEffect(() => {
    if (!open || normalizedHostId !== 'global-launcher') {
      setLastSaveableRun(null)
      return
    }
    let cancelled = false
    let delivered = false
    const unsubscribe = subscribeLastSaveableRun((run) => {
      delivered = true
      setLastSaveableRun(run)
    })
    // Recover a previous successful copy on reopen. A newer live delivery wins
    // over an outstanding native read; no timer or new persistence is needed.
    void getLastSaveableRun().then((run) => {
      if (!cancelled && !delivered) setLastSaveableRun(run)
    }).catch(() => {
      if (!cancelled && !delivered) setLastSaveableRun(null)
    })
    return () => { cancelled = true; unsubscribe() }
  }, [normalizedHostId, open])
  const nearbySaveItem = useMemo(() => {
    void pluginRegistryVersion
    void pluginSettings
    void pluginPermissions
    void savedActionVersion
    return open && normalizedHostId === 'global-launcher' ? getNearbySaveRunItem(lastSaveableRun) : null
  }, [lastSaveableRun, normalizedHostId, open, pluginRegistryVersion, pluginSettings, pluginPermissions, savedActionVersion])
  const [query, setQueryState] = useState('')
  const queryRef = useRef('')
  const [selectedIndex, setSelectedIndexState] = useState(0)
  const [controllerState, setControllerState] = useState<LauncherControllerState | null>(null)
  const [controller, setController] = useState<LauncherController | null>(null)
  const [jevSuggestion, setJevSuggestion] = useState<{ query: string; item: LauncherItem; settings: typeof jevSettings; candidates: LauncherItem[] } | null>(null)
  const [jevSettledTick, setJevSettledTick] = useState(0)
  const jevGenerationRef = useRef(0)
  const jevInFlightRef = useRef(false)
  const jevPendingRef = useRef(false)
  /** Plugin dynamicItems (calc, timestamp, web-open, …) — progressive. */
  const [pluginDynamicItems, pluginInputIdentity, setPluginDynamicItems, setPluginDynamicItemsNextFrame] = useFrameBatchedLauncherItems()
  /** Host dynamic items (apps / workflow / bridge tabs) — isolated from plugin path. */
  const [hostDynamicItems, hostInputIdentity, setHostDynamicItems, setHostDynamicItemsNextFrame] = useFrameBatchedLauncherItems()
  /**
   * Slow remote document Desktop Targets (e.g. feishu.docs).
   * Progressive + long debounce; never blocks host apps/windows path.
   */
  const [documentDynamicItems, documentInputIdentity, setDocumentDynamicItems, setDocumentDynamicItemsNextFrame] = useFrameBatchedLauncherItems()
  const controllerRef = useRef<LauncherController | null>(null)
  // Registry notifications revoke an open flow synchronously, before React's
  // next render/effect. Controller entry points also check the captured lifetime.
  useEffect(() => pluginRegistry.subscribe(() => controllerRef.current?.invalidateUnavailablePlugin()), [])
  const pluginQueryRef = useRef('')
  const hostQueryRef = useRef('')
  const documentQueryRef = useRef('')
  const requestCloseRef = useRef(requestClose)
  const launcherOpenRef = useRef(open)
  launcherOpenRef.current = open
  const prevControllerStateRef = useRef<LauncherControllerState | null>(null)
  const pluginAbortRef = useRef<AbortController | null>(null)
  const hostAbortRef = useRef<AbortController | null>(null)
  const documentAbortRef = useRef<AbortController | null>(null)
  /** Per-plugin partial results for the in-flight generation. */
  const pluginPartialsRef = useRef(new Map<string, LauncherItem[]>())
  /** Per document-source partial results for the in-flight generation. */
  const documentPartialsRef = useRef(new Map<string, LauncherItem[]>())
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
    setSelectedIndexState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value
      selectedIndexRef.current = next
      if (pin) {
        const item = (visibleSelectionItemsRef?.current ?? rankedItemsRef.current)[next]
        selectedKeyRef.current = item?.systemKey
          ?? extraSelectionRowsRef?.current.find((row) => row.index === next)?.systemKey
          ?? null
      } else {
        selectedKeyRef.current = null
      }
      return next
    })
  }, [extraSelectionRowsRef, visibleSelectionItemsRef])

  const syncSelection = useCallback(() => {
    const resolved = resolvePreservedSelection({
      selectedKey: selectedKeyRef.current,
      selectedIndex: selectedIndexRef.current,
      items: visibleSelectionItemsRef?.current ?? rankedItemsRef.current,
      extraRows: extraSelectionRowsRef?.current,
    })
    selectedKeyRef.current = resolved.key
    if (resolved.index === selectedIndexRef.current) return
    selectedIndexRef.current = resolved.index
    setSelectedIndexState(resolved.index)
  }, [extraSelectionRowsRef, visibleSelectionItemsRef])

  /** Typing starts a new result generation — drop sticky key so highlight tracks ranking top. */
  const setQuery = useCallback((value: string) => {
    if (queryRef.current === value) return
    queryRef.current = value
    controllerRef.current?.onRootQueryChanged()
    selectedKeyRef.current = null
    selectedIndexRef.current = 0
    setSelectedIndexState(0)
    setQueryState(value)
  }, [])

  const reset = useCallback(() => {
    if (normalizedHostId === 'global-launcher') void releaseDesktopWindowSearch()
    queryRef.current = ''
    setQueryState('')
    selectedKeyRef.current = null
    selectedIndexRef.current = 0
    setSelectedIndexState(0)
    setPluginDynamicItems([])
    setHostDynamicItems([])
    setDocumentDynamicItems([])
    pluginQueryRef.current = ''
    hostQueryRef.current = ''
    documentQueryRef.current = ''
    pluginPartialsRef.current.clear()
    documentPartialsRef.current.clear()
    pluginAbortRef.current?.abort()
    hostAbortRef.current?.abort()
    documentAbortRef.current?.abort()
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
      // Drop plugin/document partials (query-bound). Keep last empty-open host
      // apps/windows when the previous host query was also empty — avoids a
      // blank host strip + re-rank flash while the 120ms empty-open delay runs.
      setPluginDynamicItems([])
      const keepWarmHost =
        hostQueryRef.current === '' && hostDynamicItemsRef.current.length > 0
      if (!keepWarmHost) {
        setHostDynamicItems([])
        hostQueryRef.current = ''
      }
      setDocumentDynamicItems([])
      pluginQueryRef.current = ''
      documentQueryRef.current = ''
      pluginPartialsRef.current.clear()
      documentPartialsRef.current.clear()
      if (!controllerRef.current) {
        const nextController = new LauncherController({
          surfaceId: normalizedHostId,
          getMaterialGeneration: materialGenerationGetterRef.current ? () => materialGenerationGetterRef.current?.() : undefined,
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
          recordSelection: (surfaceId, item) => {
            recordLauncherSelection(surfaceId, item.systemKey)
            // Plugin-declared durable content → host recents for next-session recommend.
            const payload = payloadFromLauncherItem(item)
            if (payload) {
              recordPersistableLauncherSelection(payload)
            }
          },
          requestClose: () => requestCloseRef.current(),
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
      controllerRef.current.reset()
      logLauncherPerfDuration('session:open:controller-reset', openedAt, { surfaceId: normalizedHostId })
    })
    return () => { cancelled = true }
  }, [locale, makeApi, normalizedHostId, open, recordLauncherSelection, recordPersistableLauncherSelection])

  // ── Plugin dynamic path (fast debounce, progressive partials) ──────────────
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    const inputText = q || objectBlockText?.trim() || ''
    const inputIdentity = launcherInputIdentity(q, objectBlockText)
    if (!inputText && !collectDynamicWhenEmpty) {
      setPluginDynamicItems([])
      pluginQueryRef.current = ''
      pluginPartialsRef.current.clear()
      pluginAbortRef.current?.abort()
      return
    }

    // A settings/registry edit starts a new generation even when text is unchanged.
    setPluginDynamicItems([])
    pluginQueryRef.current = q
    const timer = window.setTimeout(() => {
      if (pluginQueryRef.current !== q) return
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
          if (abortController.signal.aborted) return
          if (pluginQueryRef.current !== q) return
          if (update.kind !== 'plugin' || !update.pluginId) return
          pluginPartialsRef.current.set(update.pluginId, update.items)
          const merged = filterDynamicForSurface(mergePartials(pluginPartialsRef.current), normalizedHostId)
          setPluginDynamicItemsNextFrame(merged, inputIdentity)
        },
      }).then((items) => {
        if (abortController.signal.aborted) return
        logLauncherPerfDuration('session:plugin-dynamic-items', startedAt, {
          surfaceId: normalizedHostId,
          queryLength: q.length,
          hasObjectBlockText: Boolean(objectBlockText),
          itemCount: items.length,
        })
        if (pluginQueryRef.current !== q) return
        const merged = pluginPartialsRef.current.size > 0
          ? mergePartials(pluginPartialsRef.current)
          : items
        setPluginDynamicItems(filterDynamicForSurface(merged, normalizedHostId), inputIdentity)
      }).catch(() => { /* aborted or failed — ignore */ })
    }, q || inputText ? PLUGIN_DYNAMIC_DEBOUNCE_MS : 0)

    return () => {
      window.clearTimeout(timer)
      pluginAbortRef.current?.abort()
    }
  }, [collectDynamicWhenEmpty, locale, normalizedHostId, objectBlockText, open, query, pluginSettings, pluginRegistryVersion])

  // ── Host dynamic path (apps / workflow) — isolated, longer debounce ────────
  useEffect(() => {
    if (!open) return
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
          const applyStartedAt = launcherPerfNow()
          setHostDynamicItemsNextFrame(filterDynamicForSurface(update.items, normalizedHostId), inputIdentity)
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
      }).catch(() => { /* aborted or failed — ignore */ })
    }, delayMs)

    return () => {
      window.clearTimeout(timer)
      hostAbortRef.current?.abort()
    }
  }, [appSearchAliases, automaticLearningEnabled, collectDynamicWhenEmpty, locale, normalizedHostId, objectBlockText, open, query])

  // ── Remote document Desktop Targets (feishu.docs, …) — progressive, slow debounce ──
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setDocumentDynamicItems([])
      documentQueryRef.current = ''
      documentPartialsRef.current.clear()
      documentAbortRef.current?.abort()
      return
    }
    if (normalizedHostId !== 'global-launcher') {
      setDocumentDynamicItems([])
      return
    }

    documentQueryRef.current = q
    setDocumentDynamicItems([])
    documentPartialsRef.current.clear()
    documentAbortRef.current?.abort()
    const scheduledAt = launcherPerfNow()
    logLauncherPerf('session:document-dynamic-schedule', {
      queryLength: q.length,
      debounceMs: DOCUMENT_DYNAMIC_DEBOUNCE_MS,
    })
    const timer = window.setTimeout(() => {
      if (documentQueryRef.current !== q) return
      logLauncherPerfDuration('session:document-dynamic-debounce-wait', scheduledAt, {
        queryLength: q.length,
        expectedWait: true,
      })
      documentAbortRef.current?.abort()
      const abortController = new AbortController()
      documentAbortRef.current = abortController
      documentPartialsRef.current = new Map()
      const startedAt = launcherPerfNow()
      void getDesktopDocumentLauncherDynamicItems(
        {
          query: q,
          locale,
          surfaceId: normalizedHostId,
          signal: abortController.signal,
        },
        {
          onPartial: (update) => {
            if (abortController.signal.aborted) return
            if (documentQueryRef.current !== q) return
            const mergeStartedAt = launcherPerfNow()
            documentPartialsRef.current.set(update.sourceId, update.items)
            const merged = filterDynamicForSurface(mergePartials(documentPartialsRef.current, true), normalizedHostId)
            setDocumentDynamicItemsNextFrame(merged, q)
            logLauncherPerfDuration('session:document-dynamic-partial-apply', mergeStartedAt, {
              sourceId: update.sourceId,
              itemCount: update.items.length,
              mergedCount: merged.length,
            })
          },
        },
      )
        .then((items) => {
          if (abortController.signal.aborted) return
          logLauncherPerfDuration('session:document-dynamic-items', startedAt, {
            surfaceId: normalizedHostId,
            queryLength: q.length,
            itemCount: items.length,
          })
          if (documentQueryRef.current !== q) return
          const merged = documentPartialsRef.current.size > 0
            ? mergePartials(documentPartialsRef.current, true)
            : items
          setDocumentDynamicItems(filterDynamicForSurface(merged, normalizedHostId), q)
        })
        .catch(() => { /* aborted or failed */ })
    }, DOCUMENT_DYNAMIC_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      documentAbortRef.current?.abort()
    }
  }, [locale, normalizedHostId, open, query])

  // When offline window-title enrich finishes, re-collect host items so titles/icons update.
  useEffect(() => {
    if (!open) return
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
      }).catch(() => { /* ignore */ })
    })
  }, [collectDynamicWhenEmpty, locale, normalizedHostId, objectBlockText, open])

  // Collect static candidates separately — they change with plugin registry or
  // plugin settings (toolsFor / itemsFor), not on every keystroke.
  const staticCandidates = useMemo<LauncherItem[]>(() => {
    void pluginRegistryVersion
    void pluginSettings
    void savedActionVersion
    const raw = measureLauncherPerfSync('session:static-candidates', () => collectStaticCandidates(normalizedHostId), () => ({
      surfaceId: normalizedHostId,
    }))
    return staticItemFilter ? staticItemFilter(raw) : raw
  }, [normalizedHostId, open, pluginRegistryVersion, pluginSettings, savedActionVersion, staticItemFilter])

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
  const visibleDocumentDynamicItems = documentInputIdentity === rankQuery && documentDynamicItems.length > 0
    ? documentDynamicItems : EMPTY_DYNAMIC_ITEMS

  const resolvedCandidateItems = useMemo<LauncherItem[]>(() => {
    // Any live result wins over its rehydrated recent snapshot. Keeping both
    // also creates duplicate React keys, which corrupts visible quick-run indices.
    const liveKeys = new Set([...staticCandidates, ...visiblePluginDynamicItems, ...visibleHostDynamicItems, ...visibleDocumentDynamicItems].map((item) => item.systemKey))
    const recentsDeduped = persistableRecentItems.filter((item) => !liveKeys.has(item.systemKey))
    return [...staticCandidates, ...visiblePluginDynamicItems, ...visibleHostDynamicItems,
      ...recentsDeduped, ...visibleDocumentDynamicItems]
      .filter((item) => !item.automaticLearningSignal
        || (automaticLearningEnabled === true && !item.automaticLearningSignal.aborted))
  }, [automaticLearningEnabled, query, objectBlockText, visiblePluginDynamicItems, visibleHostDynamicItems,
    visibleDocumentDynamicItems, staticCandidates, persistableRecentItems])

  const availableItems = useMemo(() => {
    void pluginPermissions
    void pluginRegistryVersion
    return filterAvailableLauncherItems(resolvedCandidateItems, normalizedHostId)
  }, [resolvedCandidateItems, normalizedHostId, pluginPermissions, pluginRegistryVersion])

  const localRankedItems = useMemo<LauncherItem[]>(() => {
    // The original ranking input and scoring remain shared by every host.
    const rankQuery = query.trim()
    const contentText = objectBlockText ?? (rankQuery || undefined)
    const detections = contentText ? detectContent(contentText) : []
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
  const hasLocalMatches = localRankedItems.length > 0
  const jevFrameKind = controllerState?.frames.at(-1)?.kind
  useEffect(() => {
    const generation = ++jevGenerationRef.current
    jevPendingRef.current = false
    const q = query.trim()
    if (hasLocalMatches || !open || jevFrameKind !== 'list' || !jevSettings?.enabled || !validJevSettings(jevSettings) || q.length < 2 || query.length > 500) {
      setJevSuggestion(null)
      return
    }
    // Static plugin actions only: never send clipboard, editor, history, or dynamic result content.
    const candidates = staticCandidates.filter((item) => item.kind === 'plugin' && !item.disabledReason &&
      !item.savedActionArtifactId && !item.systemKey.startsWith('plugin-settings:')).slice(0, 254)
    if (!candidates.length) return
    const timer = window.setTimeout(() => {
      if (jevInFlightRef.current) {
        jevPendingRef.current = true
        return
      }
      jevInFlightRef.current = true
      void chooseJevCandidate(jevSettings, query, candidates.map((item) => ({
        id: item.systemKey,
        description: [
          resolveDisplayTitle(item.display, locale),
          resolveDisplaySubtitle(item.display, locale),
          ...(item.display.aliases ?? []).slice(0, 5),
        ].filter(Boolean).join(' · '),
      }))).then((suggestion) => {
        if (generation !== jevGenerationRef.current || !suggestion) return
        const candidate = candidates.find((item) => item.systemKey === suggestion.id)
        if (candidate) setJevSuggestion({
          query,
          item: suggestion.useInput ? { ...candidate, initialInputText: query } : candidate,
          settings: jevSettings,
          candidates: staticCandidates,
        })
      }).catch(() => { /* Network/model failures leave local search intact. */ }).finally(() => {
        jevInFlightRef.current = false
        if (jevPendingRef.current) {
          jevPendingRef.current = false
          setJevSettledTick((tick) => tick + 1)
        }
      })
    }, JEV_DEBOUNCE_MS)
    return () => { window.clearTimeout(timer); ++jevGenerationRef.current }
  }, [hasLocalMatches, jevFrameKind, jevSettings, jevSettledTick, locale, open, query, staticCandidates])

  const rankedItems = useMemo<LauncherItem[]>(() => {
    const suggestion = jevSuggestion
    if (hasLocalMatches || !open || jevFrameKind !== 'list' || !suggestion || suggestion.query !== query ||
      suggestion.settings !== jevSettings || suggestion.candidates !== staticCandidates) return localRankedItems
    const label = translate(locale, 'settings', 'jevBadge')
    const item = { ...suggestion.item, display: { ...suggestion.item.display, kindLabel: label,
      kindLabelI18n: { en: translate('en', 'settings', 'jevBadge'), zh: translate('zh', 'settings', 'jevBadge') } } }
    return [item, ...localRankedItems.filter((candidate) => candidate.systemKey !== item.systemKey)]
  }, [hasLocalMatches, jevFrameKind, jevSettings, jevSuggestion, localRankedItems, locale, open, query, staticCandidates])
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
    setQuery,
    selectedIndex,
    setSelectedIndex,
    controller,
    controllerRef,
    controllerState,
    rankedItems,
    availableItems,
    nearbySaveItem,
    syncSelection,
    reset,
  }
}

function getPluginSettings(pluginId: string, source: ContributionSource): unknown {
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
