import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { makePluginT } from '../../i18n/pluginI18nRegistry'
import { detectContent } from '../../kits/content'
import { useAppStore } from '../../store'
import { pluginRegistry, usePluginRegistryVersion } from '../pluginRegistry'
import { resolvePluginSettings } from '../pluginSettingsStore'
import type { ContributionSource } from '../pluginTypes'
import { LauncherController, type LauncherControllerState } from './controller'
import { createPluginLauncherApi, createPluginLauncherStorage } from './pluginApi'
import { createPluginNetwork } from '../pluginNetwork'
import { createPluginShell } from '../pluginShell'
import { getPluginPermissionSnapshot } from '../pluginPermissions'
import { resolvePluginSettingsSource } from './pluginSource'
import { subscribeDesktopWindowsUpdated } from '../desktopControl/windows'
import { getDesktopDocumentLauncherDynamicItems } from '../desktopTargets/collectDocumentLauncherItems'
import { rankLauncherItems } from './ranking'
import {
  collectDynamicItems,
  collectStaticCandidates,
  filterDynamicForSurface,
} from './registry'
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

/** Local compute plugins (calc / timestamp / regex match) — keep near-instant. */
const PLUGIN_DYNAMIC_DEBOUNCE_MS = 60
/**
 * Host app / window list debounce while typing.
 * Apps filter in-memory; windows use 8s CG cache.
 */
const HOST_DYNAMIC_DEBOUNCE_MS = 200
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

type UseLauncherSessionOptions = {
  hostId: LauncherSurfaceId
  open: boolean
  requestClose: () => void
  staticItemFilter?: (items: LauncherItem[]) => LauncherItem[]
  collectDynamicWhenEmpty?: boolean
  objectBlockText?: string
  /** Foreground application name when host can resolve it (contextBoost). */
  foregroundApp?: string
  makeApi?: (api: PluginLauncherApi, item?: LauncherItem) => PluginLauncherApi
}

export type LauncherSession = {
  hostId: LauncherHostId
  query: string
  /**
   * Deferred query used for ranking + list mapping (match highlights).
   * Live `query` drives the input; use this so typing does not rebuild the full list every keystroke.
   */
  rankingQuery: string
  setQuery: (value: string) => void
  selectedIndex: number
  setSelectedIndex: (value: number | ((current: number) => number)) => void
  controller: LauncherController | null
  controllerRef: MutableRefObject<LauncherController | null>
  controllerState: LauncherControllerState | null
  rankedItems: LauncherItem[]
  reset: () => void
}

export function useLauncherSession({
  hostId,
  open,
  requestClose,
  staticItemFilter,
  collectDynamicWhenEmpty = false,
  objectBlockText,
  foregroundApp,
  makeApi,
}: UseLauncherSessionOptions): LauncherSession {
  const normalizedHostId = normalizeLauncherSurfaceId(hostId)
  const locale = useAppStore((s) => s.locale)
  const launcherUsageBySurface = useAppStore((s) => s.launcherUsageBySurface)
  const recordLauncherSelection = useAppStore((s) => s.recordLauncherSelection)
  const pluginRegistryVersion = usePluginRegistryVersion()

  const [query, setQuery] = useState('')
  /** Keep the input box on the live query; defer ranking so keystrokes stay responsive. */
  const deferredQuery = useDeferredValue(query)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [controllerState, setControllerState] = useState<LauncherControllerState | null>(null)
  const [controller, setController] = useState<LauncherController | null>(null)
  /** Plugin dynamicItems (calc, timestamp, web-open, …) — progressive. */
  const [pluginDynamicItems, setPluginDynamicItems] = useState<LauncherItem[]>([])
  /** Host dynamic items (apps / workflow / bridge tabs) — isolated from plugin path. */
  const [hostDynamicItems, setHostDynamicItems] = useState<LauncherItem[]>([])
  /**
   * Slow remote document Desktop Targets (e.g. feishu.docs).
   * Progressive + long debounce; never blocks host apps/windows path.
   */
  const [documentDynamicItems, setDocumentDynamicItems] = useState<LauncherItem[]>([])
  const controllerRef = useRef<LauncherController | null>(null)
  const pluginQueryRef = useRef('')
  const hostQueryRef = useRef('')
  const documentQueryRef = useRef('')
  const requestCloseRef = useRef(requestClose)
  const prevControllerStateRef = useRef<LauncherControllerState | null>(null)
  const pluginAbortRef = useRef<AbortController | null>(null)
  const hostAbortRef = useRef<AbortController | null>(null)
  const documentAbortRef = useRef<AbortController | null>(null)
  /** Per-plugin partial results for the in-flight generation. */
  const pluginPartialsRef = useRef(new Map<string, LauncherItem[]>())
  /** Per document-source partial results for the in-flight generation. */
  const documentPartialsRef = useRef(new Map<string, LauncherItem[]>())

  useEffect(() => {
    requestCloseRef.current = requestClose
  }, [requestClose])

  useEffect(() => {
    installLauncherPerfDebugApi()
  }, [])

  const reset = useCallback(() => {
    setQuery('')
    setSelectedIndex(0)
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
  }, [])

  useEffect(() => {
    if (!open) return
    const openedAt = launcherPerfNow()
    logLauncherPerf('session:open', { surfaceId: normalizedHostId })
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setPluginDynamicItems([])
      setHostDynamicItems([])
      setDocumentDynamicItems([])
      pluginQueryRef.current = ''
      hostQueryRef.current = ''
      documentQueryRef.current = ''
      pluginPartialsRef.current.clear()
      documentPartialsRef.current.clear()
      if (!controllerRef.current) {
        const nextController = new LauncherController({
          surfaceId: normalizedHostId,
          api: makeApi?.(createPluginLauncherApi()) ?? createPluginLauncherApi(),
          makeApi: (item) => {
            const requestedPermissions = item.pluginId && item.source
              ? pluginRegistry.getPluginPermissions(item.pluginId, item.source)
              : []
            const api = createPluginLauncherApi({
              pluginId: item.pluginId,
              source: item.source,
              requestedPermissions,
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
          locale,
          makeT: (item) => makePluginT(item.pluginId ?? '', locale),
          getSettings: getLauncherItemSettings,
          recordSelection: (surfaceId, item) => {
            // List identity may be volatile (window/tab id); also record stable usage keys.
            recordLauncherSelection(surfaceId, item.systemKey)
            for (const key of item.legacyUsageKeys ?? []) {
              if (key && key !== item.systemKey) {
                recordLauncherSelection(surfaceId, key)
              }
            }
          },
          requestClose: () => requestCloseRef.current(),
          onChange: (state) => {
            const prev = prevControllerStateRef.current
            if (prev && prev.busy === state.busy && prev.error === state.error && prev.frames === state.frames) {
              return
            }
            prevControllerStateRef.current = state
            setControllerState(state)
          },
        })
        controllerRef.current = nextController
        setController(nextController)
      }
      controllerRef.current.reset()
      logLauncherPerfDuration('session:open:controller-reset', openedAt, { surfaceId: normalizedHostId })
    })
    return () => { cancelled = true }
  }, [locale, makeApi, normalizedHostId, open, recordLauncherSelection])

  // ── Plugin dynamic path (fast debounce, progressive partials) ──────────────
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    const inputText = q || objectBlockText?.trim() || ''
    if (!inputText && !collectDynamicWhenEmpty) {
      setPluginDynamicItems([])
      pluginQueryRef.current = ''
      pluginPartialsRef.current.clear()
      pluginAbortRef.current?.abort()
      return
    }

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
          const merged = filterDynamicForSurface(
            [...pluginPartialsRef.current.values()].flat(),
            normalizedHostId,
          )
          setPluginDynamicItems(merged)
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
        setPluginDynamicItems(filterDynamicForSurface(items, normalizedHostId))
      }).catch(() => { /* aborted or failed — ignore */ })
    }, q || inputText ? PLUGIN_DYNAMIC_DEBOUNCE_MS : 0)

    return () => {
      window.clearTimeout(timer)
      pluginAbortRef.current?.abort()
    }
  }, [collectDynamicWhenEmpty, locale, normalizedHostId, objectBlockText, open, query])

  // ── Host dynamic path (apps / workflow) — isolated, longer debounce ────────
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    const inputText = q || objectBlockText?.trim() || ''
    if (!inputText && !collectDynamicWhenEmpty) {
      setHostDynamicItems([])
      hostQueryRef.current = ''
      hostAbortRef.current?.abort()
      return
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
          setHostDynamicItems(filterDynamicForSurface(update.items, normalizedHostId))
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
        setHostDynamicItems(filterDynamicForSurface(items, normalizedHostId))
      }).catch(() => { /* aborted or failed — ignore */ })
    }, delayMs)

    return () => {
      window.clearTimeout(timer)
      hostAbortRef.current?.abort()
    }
  }, [collectDynamicWhenEmpty, locale, normalizedHostId, objectBlockText, open, query])

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
      setDocumentDynamicItems([])
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
            const merged = filterDynamicForSurface(
              [...documentPartialsRef.current.values()].flat(),
              normalizedHostId,
            )
            setDocumentDynamicItems(merged)
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
          setDocumentDynamicItems(filterDynamicForSurface(items, normalizedHostId))
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
        setHostDynamicItems(filterDynamicForSurface(items, normalizedHostId))
      }).catch(() => { /* ignore */ })
    })
  }, [collectDynamicWhenEmpty, locale, normalizedHostId, objectBlockText, open])

  // Collect static candidates separately — they only change with pluginRegistryVersion,
  // not on every keystroke.
  const staticCandidates = useMemo<LauncherItem[]>(() => {
    void pluginRegistryVersion
    const raw = measureLauncherPerfSync('session:static-candidates', () => collectStaticCandidates(normalizedHostId), () => ({
      surfaceId: normalizedHostId,
    }))
    return staticItemFilter ? staticItemFilter(raw) : raw
  }, [normalizedHostId, pluginRegistryVersion, staticItemFilter])

  const rankedItems = useMemo<LauncherItem[]>(() => {
    // contentText for textMatch: Object Block takes precedence (it IS the text to process);
    // only fall back to query when no Object Block is present.
    // Rank against deferredQuery so typing is not blocked by detectContent + full re-rank.
    const rankQuery = deferredQuery.trim()
    const contentText = objectBlockText ?? (rankQuery || undefined)
    const detections = contentText ? detectContent(contentText) : []
    return measureLauncherPerfSync('session:rank-items', () => rankLauncherItems(
      {
        query: rankQuery,
        locale,
        surfaceId: normalizedHostId,
        usage: launcherUsageBySurface,
        now: Date.now(),
        contentText,
        detections,
        foregroundApp,
      },
      [...staticCandidates, ...pluginDynamicItems, ...hostDynamicItems, ...documentDynamicItems],
    ), (items) => ({
      surfaceId: normalizedHostId,
      queryLength: rankQuery.length,
      hasObjectBlockText: Boolean(objectBlockText),
      inputCount:
        staticCandidates.length +
        pluginDynamicItems.length +
        hostDynamicItems.length +
        documentDynamicItems.length,
      resultCount: items.length,
    }))
  }, [
    deferredQuery,
    documentDynamicItems,
    foregroundApp,
    hostDynamicItems,
    launcherUsageBySurface,
    locale,
    normalizedHostId,
    objectBlockText,
    pluginDynamicItems,
    staticCandidates,
  ])

  return {
    hostId: normalizedHostId,
    query,
    rankingQuery: deferredQuery,
    setQuery,
    selectedIndex,
    setSelectedIndex,
    controller,
    controllerRef,
    controllerState,
    rankedItems,
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
  return getPluginSettings(item.pluginId, item.source)
}
