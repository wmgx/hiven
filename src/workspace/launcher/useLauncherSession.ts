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
import type {
  LauncherHostId,
  LauncherItem,
  LauncherSurfaceId,
} from './types'
import { normalizeLauncherSurfaceId } from './types'

type UseLauncherSessionOptions = {
  hostId: LauncherSurfaceId
  open: boolean
  requestClose: () => void
  staticItemFilter?: (items: LauncherItem[]) => LauncherItem[]
  collectDynamicWhenEmpty?: boolean
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
  const [rankingNow, setRankingNow] = useState(0)
  const controllerRef = useRef<LauncherController | null>(null)
  const dynamicQueryRef = useRef('')
  const requestCloseRef = useRef(requestClose)

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
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setDynamicItems([])
      dynamicQueryRef.current = ''
      if (!controllerRef.current) {
        const nextController = new LauncherController({
          surfaceId: normalizedHostId,
          api: createPluginLauncherApi(),
          makeApi: (item) => {
            const requestedPermissions = item.pluginId && item.source
              ? pluginRegistry.getPluginPermissions(item.pluginId, item.source)
              : []
            return createPluginLauncherApi({
              pluginId: item.pluginId,
              source: item.source,
              requestedPermissions,
            })
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
          onChange: (state) => setControllerState({ ...state }),
        })
        controllerRef.current = nextController
        setController(nextController)
      }
      controllerRef.current.reset()
    })
    return () => { cancelled = true }
  }, [locale, normalizedHostId, open, recordLauncherSelection])

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q && !collectDynamicWhenEmpty) {
      setDynamicItems([])
      dynamicQueryRef.current = ''
      return
    }

    dynamicQueryRef.current = q
    const timer = window.setTimeout(async () => {
      if (dynamicQueryRef.current !== q) return
      const items = await collectDynamicItems(q, normalizedHostId, locale, getPluginSettings)
      if (dynamicQueryRef.current !== q) return
      setDynamicItems(filterDynamicForSurface(items, normalizedHostId))
    }, q ? 150 : 0)
    return () => window.clearTimeout(timer)
  }, [collectDynamicWhenEmpty, locale, normalizedHostId, open, query])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => setRankingNow(Date.now()), 0)
    return () => window.clearTimeout(timer)
  }, [dynamicItems.length, open, query])

  const rankedItems = useMemo<LauncherItem[]>(() => {
    void pluginRegistryVersion
    const staticCandidates = staticItemFilter
      ? staticItemFilter(collectStaticCandidates(normalizedHostId))
      : collectStaticCandidates(normalizedHostId)
    return rankLauncherItems(
      {
        query: query.trim(),
        locale,
        surfaceId: normalizedHostId,
        usage: launcherUsageBySurface,
        now: rankingNow,
      },
      [...staticCandidates, ...dynamicItems],
    )
  }, [
    dynamicItems,
    launcherUsageBySurface,
    locale,
    normalizedHostId,
    pluginRegistryVersion,
    query,
    rankingNow,
    staticItemFilter,
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
