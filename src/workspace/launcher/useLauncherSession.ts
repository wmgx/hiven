import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { makePluginT } from '../../i18n/pluginI18nRegistry'
import { useAppStore } from '../../store'
import { pluginRegistry, usePluginRegistryVersion } from '../pluginRegistry'
import { resolvePluginSettings } from '../pluginSettingsStore'
import type { ContributionSource } from '../pluginTypes'
import { LauncherController, type LauncherControllerState } from './controller'
import { createPluginLauncherApi, createPluginLauncherStorage } from './pluginApi'
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

type UseLauncherSessionOptions = {
  hostId: LauncherSurfaceId
  open: boolean
  requestClose: () => void
  staticItemFilter?: (items: LauncherItem[]) => LauncherItem[]
  collectDynamicWhenEmpty?: boolean
  clipboardText?: string
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
  clipboardText,
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
  const [dynamicItems, setDynamicItems] = useState<LauncherItem[]>([])
  const controllerRef = useRef<LauncherController | null>(null)
  const dynamicQueryRef = useRef('')
  const requestCloseRef = useRef(requestClose)
  const prevControllerStateRef = useRef<LauncherControllerState | null>(null)

  useEffect(() => {
    requestCloseRef.current = requestClose
  }, [requestClose])

  const reset = useCallback(() => {
    setQuery('')
    setSelectedIndex(0)
    setDynamicItems([])
    dynamicQueryRef.current = ''
    controllerRef.current?.reset()
  }, [])

  useEffect(() => {
    if (!open) return
    const openedAt = launcherPerfNow()
    logLauncherPerf('session:open', { surfaceId: normalizedHostId })
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setDynamicItems([])
      dynamicQueryRef.current = ''
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

  const dynamicAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q && !collectDynamicWhenEmpty && !clipboardText) {
      setDynamicItems([])
      dynamicQueryRef.current = ''
      return
    }

    dynamicQueryRef.current = q
    const timer = window.setTimeout(() => {
      if (dynamicQueryRef.current !== q) return
      // Abort the previous in-flight request
      dynamicAbortRef.current?.abort()
      const abortController = new AbortController()
      dynamicAbortRef.current = abortController
      const startedAt = launcherPerfNow()
      collectDynamicItems(q, normalizedHostId, locale, getPluginSettings, clipboardText)
        .then((items) => {
          if (abortController.signal.aborted) return
          logLauncherPerfDuration('session:dynamic-items', startedAt, {
            surfaceId: normalizedHostId,
            queryLength: q.length,
            hasClipboardText: Boolean(clipboardText),
            itemCount: items.length,
          })
          if (dynamicQueryRef.current !== q) return
          setDynamicItems(filterDynamicForSurface(items, normalizedHostId))
        })
        .catch(() => { /* aborted or failed — ignore */ })
    }, q ? 150 : 0)
    return () => {
      window.clearTimeout(timer)
      dynamicAbortRef.current?.abort()
    }
  }, [clipboardText, collectDynamicWhenEmpty, locale, normalizedHostId, open, query])

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
    const contentText = clipboardText ?? (query.trim() || undefined)
    return measureLauncherPerfSync('session:rank-items', () => rankLauncherItems(
      {
        query: query.trim(),
        locale,
        surfaceId: normalizedHostId,
        usage: launcherUsageBySurface,
        now: Date.now(),
        contentText,
      },
      [...staticCandidates, ...dynamicItems],
    ), (items) => ({
      surfaceId: normalizedHostId,
      queryLength: query.trim().length,
      hasClipboardText: Boolean(clipboardText),
      inputCount: staticCandidates.length + dynamicItems.length,
      resultCount: items.length,
    }))
  }, [
    clipboardText,
    dynamicItems,
    launcherUsageBySurface,
    locale,
    normalizedHostId,
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
