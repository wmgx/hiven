import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { makePluginT } from '../../i18n/pluginI18nRegistry'
import { useAppStore } from '../../store'
import { pluginRegistry, usePluginRegistryVersion } from '../pluginRegistry'
import { resolvePluginSettings } from '../pluginSettingsStore'
import type { ContributionSource } from '../pluginTypes'
import { LauncherController, type LauncherControllerState } from './controller'
import { createPluginLauncherApi, createPluginLauncherStorage } from './pluginApi'
import { createPluginNetwork } from '../pluginNetwork'
import { getPluginPermissionSnapshot } from '../pluginPermissions'
import { resolvePluginSettingsSource } from './pluginSource'
import { rankLauncherItems } from './ranking'
import {
  collectDynamicItems,
  collectStaticCandidates,
  filterDynamicForSurface,
} from './registry'
import { logLauncherPerf, logLauncherPerfDuration, launcherPerfNow, measureLauncherPerfSync } from './perf'
import type {
  LauncherHostId,
  LauncherItem,
  LauncherSurfaceId,
  PluginLauncherApi,
} from './types'
import { normalizeLauncherSurfaceId } from './types'

/** Local compute plugins (calc / timestamp / regex match) — keep near-instant. */
const PLUGIN_DYNAMIC_DEBOUNCE_MS = 30
/** Host app / workflow search — tolerate slightly longer debounce. */
const HOST_DYNAMIC_DEBOUNCE_MS = 150

type UseLauncherSessionOptions = {
  hostId: LauncherSurfaceId
  open: boolean
  requestClose: () => void
  staticItemFilter?: (items: LauncherItem[]) => LauncherItem[]
  collectDynamicWhenEmpty?: boolean
  objectBlockText?: string
  makeApi?: (api: PluginLauncherApi, item?: LauncherItem) => PluginLauncherApi
}

export type LauncherSession = {
  hostId: LauncherHostId
  query: string
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
  makeApi,
}: UseLauncherSessionOptions): LauncherSession {
  const normalizedHostId = normalizeLauncherSurfaceId(hostId)
  const locale = useAppStore((s) => s.locale)
  const launcherUsageBySurface = useAppStore((s) => s.launcherUsageBySurface)
  const recordLauncherSelection = useAppStore((s) => s.recordLauncherSelection)
  const pluginRegistryVersion = usePluginRegistryVersion()

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [controllerState, setControllerState] = useState<LauncherControllerState | null>(null)
  const [controller, setController] = useState<LauncherController | null>(null)
  /** Plugin dynamicItems (calc, timestamp, web-open, …) — progressive. */
  const [pluginDynamicItems, setPluginDynamicItems] = useState<LauncherItem[]>([])
  /** Host dynamic items (apps / workflow) — isolated from plugin path. */
  const [hostDynamicItems, setHostDynamicItems] = useState<LauncherItem[]>([])
  const controllerRef = useRef<LauncherController | null>(null)
  const pluginQueryRef = useRef('')
  const hostQueryRef = useRef('')
  const requestCloseRef = useRef(requestClose)
  const prevControllerStateRef = useRef<LauncherControllerState | null>(null)
  const pluginAbortRef = useRef<AbortController | null>(null)
  const hostAbortRef = useRef<AbortController | null>(null)
  /** Per-plugin partial results for the in-flight generation. */
  const pluginPartialsRef = useRef(new Map<string, LauncherItem[]>())

  useEffect(() => {
    requestCloseRef.current = requestClose
  }, [requestClose])

  const reset = useCallback(() => {
    setQuery('')
    setSelectedIndex(0)
    setPluginDynamicItems([])
    setHostDynamicItems([])
    pluginQueryRef.current = ''
    hostQueryRef.current = ''
    pluginPartialsRef.current.clear()
    pluginAbortRef.current?.abort()
    hostAbortRef.current?.abort()
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
      pluginQueryRef.current = ''
      hostQueryRef.current = ''
      pluginPartialsRef.current.clear()
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
          locale,
          makeT: (item) => makePluginT(item.pluginId ?? '', locale),
          getSettings: getLauncherItemSettings,
          recordSelection: (surfaceId, item) => {
            recordLauncherSelection(surfaceId, item.systemKey)
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
    const timer = window.setTimeout(() => {
      if (hostQueryRef.current !== q) return
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
          setHostDynamicItems(filterDynamicForSurface(update.items, normalizedHostId))
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
    }, q ? HOST_DYNAMIC_DEBOUNCE_MS : 0)

    return () => {
      window.clearTimeout(timer)
      hostAbortRef.current?.abort()
    }
  }, [collectDynamicWhenEmpty, locale, normalizedHostId, objectBlockText, open, query])

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
    const contentText = objectBlockText ?? (query.trim() || undefined)
    return measureLauncherPerfSync('session:rank-items', () => rankLauncherItems(
      {
        query: query.trim(),
        locale,
        surfaceId: normalizedHostId,
        usage: launcherUsageBySurface,
        now: Date.now(),
        contentText,
      },
      [...staticCandidates, ...pluginDynamicItems, ...hostDynamicItems],
    ), (items) => ({
      surfaceId: normalizedHostId,
      queryLength: query.trim().length,
      hasObjectBlockText: Boolean(objectBlockText),
      inputCount: staticCandidates.length + pluginDynamicItems.length + hostDynamicItems.length,
      resultCount: items.length,
    }))
  }, [
    hostDynamicItems,
    launcherUsageBySurface,
    locale,
    normalizedHostId,
    objectBlockText,
    pluginDynamicItems,
    query,
    staticCandidates,
  ])

  return {
    hostId: normalizedHostId,
    query,
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
