import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { makePluginT } from '../i18n/pluginI18nRegistry'
import type { Locale } from '../i18n'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from '../utils/imeKeyboard'
import { LauncherController, type LauncherControllerState } from '../workspace/launcher/controller'
import { createPluginLauncherApi, createPluginLauncherStorage } from '../workspace/launcher/pluginApi'
import { resolvePluginSettingsSource } from '../workspace/launcher/pluginSource'
import { collectDynamicItems, collectStaticCandidates, filterDynamicForSurface } from '../workspace/launcher/registry'
import { rankLauncherItems } from '../workspace/launcher/ranking'
import type { LauncherHostConfig } from './LauncherHostConfig'
import type { ContributionSource } from '../workspace/pluginTypes'
import { pluginRegistry } from '../workspace/pluginRegistry'
import { resolvePluginSettings } from '../workspace/pluginSettingsStore'
import type { LauncherItem, LauncherUsageBySurface } from '../workspace/launcher/types'

type UseLauncherSessionOptions = {
  open: boolean
  hostConfig: LauncherHostConfig
  locale: Locale
  launcherUsageBySurface: LauncherUsageBySurface
  pluginRegistryVersion: number
  recordSelection: (surfaceId: string, systemKey: string) => void
  collectForEmptyQuery?: boolean
  focusDelay?: number
}

export type LauncherSession = ReturnType<typeof useLauncherSession>

export function useLauncherSession({
  open,
  hostConfig,
  locale,
  launcherUsageBySurface,
  pluginRegistryVersion,
  recordSelection,
  collectForEmptyQuery = false,
  focusDelay = 0,
}: UseLauncherSessionOptions) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [controllerState, setControllerState] = useState<LauncherControllerState | null>(null)
  const [controller, setController] = useState<LauncherController | null>(null)
  const [dynamicItems, setDynamicItems] = useState<LauncherItem[]>([])
  const [rankingNow, setRankingNow] = useState(() => Date.now())
  const inputRef = useRef<HTMLInputElement>(null)
  const controllerRef = useRef<LauncherController | null>(null)
  const dynamicQueryRef = useRef('')
  const isKeyboardNavRef = useRef(false)
  const isImeComposingRef = useRef(false)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const requestCloseRef = useRef(hostConfig.closeBehavior.requestClose)

  useEffect(() => {
    requestCloseRef.current = hostConfig.closeBehavior.requestClose
  }, [hostConfig.closeBehavior.requestClose])

  const resetSession = useCallback(() => {
    setQuery('')
    setSelectedIndex(0)
    setDynamicItems([])
    dynamicQueryRef.current = ''
    controllerRef.current?.reset()
  }, [])

  const restoreFocus = useCallback(() => {
    const el = previousFocusRef.current
    if (el && typeof el.focus === 'function') {
      requestAnimationFrame(() => el.focus())
    }
    previousFocusRef.current = null
  }, [])

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      resetSession()
      if (!controllerRef.current) {
        const nextController = new LauncherController({
          surfaceId: hostConfig.hostId,
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
          getSettings: (item) => getSettingsForPluginItem(item),
          recordSelection: (surfaceId, item) => {
            recordSelection(surfaceId, item.systemKey)
          },
          requestClose: () => requestCloseRef.current(),
          onChange: (state) => setControllerState({ ...state }),
        })
        controllerRef.current = nextController
        setController(nextController)
      }
      controllerRef.current.reset()
      window.setTimeout(() => inputRef.current?.focus(), focusDelay)
    })
    return () => {
      cancelled = true
    }
  }, [focusDelay, hostConfig.hostId, locale, open, recordSelection, resetSession])

  useEffect(() => {
    if (!open) {
      dynamicQueryRef.current = ''
      controllerRef.current?.reset()
      return
    }
    const q = query.trim()
    if (!q && !collectForEmptyQuery) {
      dynamicQueryRef.current = ''
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) setDynamicItems([])
      })
      return () => { cancelled = true }
    }
    dynamicQueryRef.current = q
    const timer = window.setTimeout(async () => {
      if (dynamicQueryRef.current !== q) return
      const items = await collectDynamicItems(q, hostConfig.hostId, locale, getSettingsForPlugin)
      if (dynamicQueryRef.current !== q) return
      setDynamicItems(filterDynamicForSurface(items, hostConfig.hostId))
    }, q ? 150 : 0)
    return () => window.clearTimeout(timer)
  }, [collectForEmptyQuery, hostConfig.hostId, locale, open, query])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => setRankingNow(Date.now()), 0)
    return () => window.clearTimeout(timer)
  }, [dynamicItems.length, open, query])

  const rankedLauncherItems = useMemo<LauncherItem[]>(() => {
    void pluginRegistryVersion
    const staticCandidates = collectStaticCandidates(hostConfig.hostId)
    const allCandidates = [...staticCandidates, ...dynamicItems]
    return rankLauncherItems(
      {
        query: query.trim(),
        locale,
        surfaceId: hostConfig.hostId,
        usage: launcherUsageBySurface,
        now: rankingNow,
      },
      allCandidates,
    )
  }, [dynamicItems, hostConfig.hostId, launcherUsageBySurface, locale, pluginRegistryVersion, query, rankingNow])

  const setSearchQuery = useCallback((value: string) => {
    setQuery(value)
    setSelectedIndex(0)
  }, [])

  const topFrame = controllerState?.frames[controllerState.frames.length - 1] ?? null
  const inControllerFrame = Boolean(topFrame && topFrame.kind !== 'list')
  const clampedSelectedIndex = Math.min(selectedIndex, Math.max(0, rankedLauncherItems.length - 1))
  const selectedItem = rankedLauncherItems.length === 1
    ? rankedLauncherItems[0]
    : rankedLauncherItems[clampedSelectedIndex]

  return {
    query,
    setQuery,
    setSearchQuery,
    selectedIndex,
    setSelectedIndex,
    clampedSelectedIndex,
    selectedItem,
    dynamicItems,
    rankedLauncherItems,
    controllerState,
    controller,
    controllerRef,
    inputRef,
    isKeyboardNavRef,
    imeComposingRef: isImeComposingRef,
    topFrame,
    inControllerFrame,
    resetSession,
    restoreFocus,
    shouldIgnoreKeyDown: (event: KeyboardEvent) => shouldIgnoreImeKeyDown(event, isImeComposingRef),
    handleCompositionStart: () => startImeComposition(isImeComposingRef),
    handleCompositionEnd: () => finishImeComposition(isImeComposingRef),
  }
}

function getSettingsForPlugin(pluginId: string, source: ContributionSource) {
  const def = pluginRegistry.getPluginDefinition(pluginId, source)
  const settingsContribution = def?.settings
  if (!settingsContribution) return undefined
  const settingsSource = resolvePluginSettingsSource(pluginId, source)
  return resolvePluginSettings(settingsSource, pluginId, settingsContribution).value
}

function getSettingsForPluginItem(item: LauncherItem) {
  if (!item.pluginId || !item.source) return undefined
  return getSettingsForPlugin(item.pluginId, item.source)
}
