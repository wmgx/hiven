import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ErrorInfo, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { LayoutPanelLeft, Pin, Puzzle, Search, Settings } from 'lucide-react'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { localized, useAppStore, type PluginSurfaceOpenTarget, type ViewId } from '../store'
import { t, type Locale } from '../i18n'
import { makePluginT } from '../i18n/pluginI18nRegistry'
import { resolveIcon } from '../utils/resolveIcon'
import { pluginRegistry, usePluginRegistryVersion } from '../workspace/pluginRegistry'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from '../utils/imeKeyboard'
import { resolvePluginSettings, usePluginSettingsStore } from '../workspace/pluginSettingsStore'
import { scoreSearchableFields, searchableFieldsMatch, type SearchableFields } from '../workspace/searchRanking'
import { LauncherController } from '../workspace/launcher/controller'
import type { LauncherControllerState, CollectInputFrame, ParamInputFrame, ResultFrame } from '../workspace/launcher/controller'
import { createPluginLauncherApi } from '../workspace/launcher/pluginApi'
import { collectStaticCandidates, collectDynamicItems, filterDynamicForSurface } from '../workspace/launcher/registry'
import { rankLauncherItems } from '../workspace/launcher/ranking'
import { resolveDisplayTitle, resolveDisplaySubtitle } from '../workspace/launcher/display'
import type { LauncherItem as DomainLauncherItem, LauncherResultChoice, LauncherSurfaceId } from '../workspace/launcher/types'
import { resolvePluginSettingsSource } from '../workspace/launcher/pluginSource'
import { LauncherParamStep, resolveParamValueLabel } from './launcher/LauncherParamStep'
import { getPlatformShortcutMeta, shouldCustomizeParams, supportsDefaultParamRun, supportsParamCustomization } from './launcher/launcherParamShortcuts'
import type { ContributionSource, PluginDefinition, PluginPermission } from '../workspace/pluginTypes'
import { createPluginPrivateStorage } from '../workspace/pluginStorage'
import { createPluginClipboard } from '../workspace/pluginClipboard'
import { createPluginPaste } from '../workspace/pluginPaste'
import { describePluginPermission, getPluginPermissionSnapshot, missingPluginPermissions, usePluginPermissionStore } from '../workspace/pluginPermissions'
import { restartPluginBackground } from '../workspace/pluginBackgroundManager'
import type { PluginSettingsSource } from '../workspace/pluginSettingsStore'

type LauncherItem =
  | { kind: 'domain'; id: string; title: string; subtitle: string; icon?: string; domainItem: DomainLauncherItem }
  | { kind: 'pinned'; id: string; title: string; subtitle: string; icon?: string; actionId: string }
  | { kind: 'view'; id: ViewId; title: string; subtitle: string; icon: ReactNode }

const viewItems: { id: ViewId; title: string; titleI18n: Partial<Record<Locale, string>>; icon: ReactNode }[] = [
  { id: 'editor', title: 'Editor', titleI18n: { zh: '编辑器' }, icon: <LayoutPanelLeft size={14} /> },
  { id: 'scripts', title: 'Plugins', titleI18n: { zh: '插件' }, icon: <Puzzle size={14} /> },
  { id: 'settings', title: 'Settings', titleI18n: { zh: '设置' }, icon: <Settings size={14} /> },
]

const STANDALONE_LAUNCHER_WIDTH = 660
const STANDALONE_LAUNCHER_MIN_HEIGHT = 160
const STANDALONE_LAUNCHER_MAX_HEIGHT = 390
const STANDALONE_SURFACE_MAX_WIDTH = 920
const STANDALONE_SURFACE_MAX_HEIGHT = 760
const STANDALONE_LAUNCHER_VERTICAL_PADDING = 24
const STANDALONE_LAUNCHER_HORIZONTAL_PADDING = 24
const STANDALONE_LAUNCHER_LIST_MAX_HEIGHT = 300
const PLUGIN_SURFACE_BACK_EVENT = 'hiven:plugin-surface-back'
const PLUGIN_SURFACE_CLOSE_EVENT = 'hiven:plugin-surface-close'

export function GlobalLauncher() {
  const open = useAppStore((s) => s.globalLauncherOpen)
  const mode = useAppStore((s) => s.globalLauncherMode)
  const overlay = useAppStore((s) => s.globalLauncherOverlay)
  const setOpen = useAppStore((s) => s.setGlobalLauncherOpen)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const openPinnedAction = useAppStore((s) => s.openPinnedAction)
  const pinnedActions = useAppStore((s) => s.pinnedActions)
  const recentActionNames = useAppStore((s) => s.actionUsageBySource['global-launcher'].recentActionNames)
  const actionUsageCounts = useAppStore((s) => s.actionUsageBySource['global-launcher'].actionUsageCounts)
  const launcherPosition = useAppStore((s) => s.settings.globalLauncherPosition)
  const updateSetting = useAppStore((s) => s.updateSetting)
  const locale = useAppStore((s) => s.locale)
  const pluginRegistryVersion = usePluginRegistryVersion()
  const pluginPermissionVersion = usePluginPermissionStore((s) => s.version)
  const grantPluginPermissions = usePluginPermissionStore((s) => s.grantPermissions)
  const launcherUsageBySurface = useAppStore((s) => s.launcherUsageBySurface)
  const recordLauncherSelection = useAppStore((s) => s.recordLauncherSelection)
  const pluginSurfaceToolTarget = useAppStore((s) => s.pluginSurfaceToolTarget)
  const clearPluginSurfaceTool = useAppStore((s) => s.clearPluginSurfaceTool)
  const [controllerState, setControllerState] = useState<LauncherControllerState | null>(null)
  const [launcherController, setLauncherController] = useState<LauncherController | null>(null)
  const controllerRef = useRef<LauncherController | null>(null)
  const closeAfterActionRef = useRef<() => void>(() => {})
  const [dynamicItems, setDynamicItems] = useState<DomainLauncherItem[]>([])
  const [surfaceFrame, setSurfaceFrame] = useState<{ source: PluginSettingsSource; pluginId: string; surfaceId: string } | null>(null)
  const [surfaceFocusVersion, setSurfaceFocusVersion] = useState(0)
  const [rankingNow, setRankingNow] = useState(0)
  const dynamicQueryRef = useRef('')
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [dragPosition, setDragPosition] = useState(launcherPosition)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const isImeComposingRef = useRef(false)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<{
    offsetX: number
    offsetY: number
    position: { x: number; y: number }
  } | null>(null)
  const standaloneLauncher = isStandaloneLauncherWindow()

  useEffect(() => {
    if (dragRef.current) return
    setDragPosition(launcherPosition)
  }, [launcherPosition])

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => {
      setQuery('')
      setSelectedIndex(0)
      inputRef.current?.focus()
    })
  }, [open])

  useEffect(() => {
    if (open) return
    setSurfaceFrame(null)
    setDynamicItems([])
    dynamicQueryRef.current = ''
    controllerRef.current?.reset()
  }, [open])

  useEffect(() => {
    if (!open || !pluginSurfaceToolTarget) return
    const timer = window.setTimeout(() => {
      setSurfaceFrame(pluginSurfaceToolTarget)
      setSurfaceFocusVersion((version) => version + 1)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open, pluginSurfaceToolTarget])

  // Initialize LauncherController on open
  useEffect(() => {
    if (!open) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setDynamicItems([])
      dynamicQueryRef.current = ''
      if (!controllerRef.current) {
        const controller = new LauncherController({
          surfaceId: 'global-launcher' as LauncherSurfaceId,
          api: createPluginLauncherApi(),
          locale,
          makeT: (item) => makePluginT(item.pluginId ?? '', locale),
          getSettings: (item) => {
            if (!item.pluginId || !item.source) return undefined
            const def = pluginRegistry.getPluginDefinition(item.pluginId, item.source)
            const settingsContribution = def?.settings
            if (!settingsContribution) return undefined
            return resolvePluginSettings(item.source, item.pluginId, settingsContribution).value
          },
          recordSelection: (surfaceId, item) => {
            recordLauncherSelection(surfaceId, item.systemKey)
          },
          requestClose: () => closeAfterActionRef.current(),
          onChange: (state) => setControllerState({ ...state }),
        })
        controllerRef.current = controller
        setLauncherController(controller)
      }
      controllerRef.current.reset()
    })
    return () => { cancelled = true }
  }, [locale, open, recordLauncherSelection])

  // Collect dynamic items with debounce
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      dynamicQueryRef.current = ''
      const clearTimer = window.setTimeout(() => setDynamicItems([]), 0)
      return () => window.clearTimeout(clearTimer)
    }
    dynamicQueryRef.current = q
    const timer = setTimeout(async () => {
      if (dynamicQueryRef.current !== q) return
      const getSettingsForPlugin = (pluginId: string, source: ContributionSource) => {
        const def = pluginRegistry.getPluginDefinition(pluginId, source)
        const settingsContribution = def?.settings
        if (!settingsContribution) return undefined
        const settingsSource = resolvePluginSettingsSource(pluginId, source)
        return resolvePluginSettings(settingsSource, pluginId, settingsContribution).value
      }
      const items = await collectDynamicItems(q, locale, getSettingsForPlugin)
      if (dynamicQueryRef.current !== q) return
      setDynamicItems(filterDynamicForSurface(items, 'global-launcher'))
    }, 150)
    return () => clearTimeout(timer)
  }, [query, open, locale])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => setRankingNow(Date.now()), 0)
    return () => window.clearTimeout(timer)
  }, [open, query, dynamicItems.length])

  // Domain ranked items (new launcher system)
  const rankedLauncherItems = useMemo<DomainLauncherItem[]>(() => {
    void pluginRegistryVersion
    const staticCandidates = collectStaticCandidates('global-launcher')
    const allCandidates = [...staticCandidates, ...dynamicItems]
    const q = query.trim()
    return rankLauncherItems(
      { query: q, locale, surfaceId: 'global-launcher', usage: launcherUsageBySurface, now: rankingNow },
      allCandidates,
    )
  }, [query, locale, pluginRegistryVersion, dynamicItems, launcherUsageBySurface, rankingNow])

  const activeSurfaceFrame = useMemo(() => {
    void pluginRegistryVersion
    if (!surfaceFrame) return null
    const def = pluginRegistry.getPluginDefinition(surfaceFrame.pluginId, surfaceFrame.source) as PluginDefinition<unknown> | undefined
    const surface = def?.ui?.surfaces?.find((s) => s.id === surfaceFrame.surfaceId)
    if (!def || !surface) return null
    return { definition: def, surface }
  }, [surfaceFrame, pluginRegistryVersion])

  const items = useMemo<LauncherItem[]>(() => {
    const pinnedLabel = t(locale, 'palette.globalPinned')
    const pinned = pinnedActions.map((item) => ({
      kind: 'pinned' as const,
      id: item.id,
      title: localized(item.title, item.titleI18n, locale),
      subtitle: pinnedLabel,
      icon: item.icon,
      actionId: item.actionId,
    }))

    if ('pinned-only' === mode) return pinned

    const viewsLabel = t(locale, 'palette.globalViews')
    const views = viewItems.map((item) => ({
      kind: 'view' as const,
      id: item.id,
      title: localized(item.title, item.titleI18n, locale),
      subtitle: viewsLabel,
      icon: item.icon,
    }))
    return [...pinned, ...views]
  }, [locale, mode, pinnedActions])

  const filtered = useMemo(() => {
    void pluginRegistryVersion
    const q = query.trim().toLowerCase()
    const base = q ? items.filter((item) => launcherItemMatchesQuery(item, q, locale)) : items
    const sortedBase = [...base].sort((a, b) =>
      scoreLauncherItem(b, q, locale, recentActionNames, actionUsageCounts) -
      scoreLauncherItem(a, q, locale, recentActionNames, actionUsageCounts)
    )

    const domainItems: LauncherItem[] = rankedLauncherItems.map((domainItem) => ({
      kind: 'domain' as const,
      id: domainItem.systemKey,
      title: resolveDisplayTitle(domainItem.display, locale),
      subtitle: resolveDisplaySubtitle(domainItem.display, locale) ?? '',
      icon: domainItem.display.icon,
      domainItem,
    }))

    return [...domainItems, ...sortedBase]
  }, [items, query, locale, pluginRegistryVersion, recentActionNames, actionUsageCounts, rankedLauncherItems])

  const restoreFocus = useCallback(() => {
    const el = previousFocusRef.current
    if (el && typeof el.focus === 'function') {
      requestAnimationFrame(() => el.focus())
    }
    previousFocusRef.current = null
  }, [])

  const resetLauncherSession = useCallback(() => {
    clearPluginSurfaceTool()
    setSurfaceFrame(null)
    setQuery('')
    setSelectedIndex(0)
    setDynamicItems([])
    dynamicQueryRef.current = ''
    controllerRef.current?.reset()
  }, [clearPluginSurfaceTool])

  const closeLauncher = useCallback(() => {
    const wasOverlay = overlay
    resetLauncherSession()
    if (standaloneLauncher) {
      void (async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('hide_launcher_window')
        } catch (error) {
          console.warn('[hiven] Failed to hide launcher window:', error)
        }
        setOpen(false)
        restoreFocus()
      })()
      return
    }
    if (wasOverlay) {
      void (async () => {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          const win = getCurrentWindow()
          await win.setDecorations(true)
          await win.hide()
        } catch (error) {
          console.warn('[hiven] Failed to restore launcher window:', error)
        }
        setOpen(false)
        restoreFocus()
      })()
      return
    }
    setOpen(false)
    restoreFocus()
  }, [overlay, resetLauncherSession, setOpen, standaloneLauncher, restoreFocus])

  // Close launcher after a command has been executed (don't hide the main window)
  const closeLauncherAfterAction = useCallback(() => {
    resetLauncherSession()
    if (standaloneLauncher) {
      void (async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('hide_launcher_window')
        } catch (error) {
          console.warn('[hiven] Failed to hide launcher window:', error)
        }
        setOpen(false)
        restoreFocus()
      })()
      return
    }
    if (overlay) {
      void (async () => {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          const win = getCurrentWindow()
          await win.setDecorations(true)
        } catch (error) {
          console.warn('[hiven] Failed to restore launcher window:', error)
        }
        setOpen(false)
        restoreFocus()
      })()
      return
    }
    setOpen(false)
    restoreFocus()
  }, [overlay, resetLauncherSession, setOpen, standaloneLauncher, restoreFocus])

  useEffect(() => {
    closeAfterActionRef.current = closeLauncherAfterAction
  }, [closeLauncherAfterAction])

  useEffect(() => {
    if (!open || !standaloneLauncher) return
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return

    let disposed = false
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (!focused) closeLauncher()
      }))
      .then((cleanup) => {
        if (disposed) cleanup()
        else unlisten = cleanup
      })
      .catch((error) => {
        console.warn('[hiven] Failed to listen for launcher focus changes:', error)
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [closeLauncher, open, standaloneLauncher])

  const clampedSelectedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1))
  const selectedItem = filtered.length === 1 ? filtered[0] : filtered[clampedSelectedIndex]

  function focusSearchInputAfterBack() {
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  // Focus input when entering collect-input frame
  useEffect(() => {
    if (!open || !controllerState || controllerState.frames.length <= 1) return
    const topFrame = controllerState.frames[controllerState.frames.length - 1]
    if (topFrame.kind !== 'collect-input') return
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open, controllerState])

  useEffect(() => {
    if (!open || !controllerState || controllerState.frames.length <= 1) return
    if (controllerState.busy) return
    const topFrame = controllerState.frames[controllerState.frames.length - 1]
    if (topFrame.kind !== 'collect-input') return
    if (topFrame.item.behavior.type !== 'perform' || topFrame.item.inputPolicy == null) return
    if (topFrame.previewInputText === topFrame.inputText) return
    const timer = window.setTimeout(() => {
      void controllerRef.current?.previewInput()
    }, 180)
    return () => window.clearTimeout(timer)
  }, [controllerState, open])

  useLayoutEffect(() => {
    if (!open || !standaloneLauncher) return
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return

    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      const surfaceShell = activeSurfaceFrame?.surface.shell
      const desiredPanelHeight = surfaceShell?.defaultHeight
        ? surfaceShell.defaultHeight
        : measureStandaloneLauncherPanelHeight(panel)
      const nextHeight = clamp(
        Math.ceil(desiredPanelHeight + STANDALONE_LAUNCHER_VERTICAL_PADDING),
        STANDALONE_LAUNCHER_MIN_HEIGHT,
        surfaceShell ? STANDALONE_SURFACE_MAX_HEIGHT : STANDALONE_LAUNCHER_MAX_HEIGHT,
      )
      const desiredPanelWidth = surfaceShell?.defaultWidth ?? STANDALONE_LAUNCHER_WIDTH
      const nextWidth = clamp(
        Math.ceil(desiredPanelWidth + STANDALONE_LAUNCHER_HORIZONTAL_PADDING),
        STANDALONE_LAUNCHER_WIDTH,
        surfaceShell ? STANDALONE_SURFACE_MAX_WIDTH : STANDALONE_LAUNCHER_WIDTH,
      )
      void getCurrentWindow()
        .setSize(new LogicalSize(nextWidth, nextHeight))
        .catch((error) => {
          console.warn('[hiven] Failed to resize launcher window:', error)
        })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [
    filtered.length,
    mode,
    open,
    controllerState,
    standaloneLauncher,
    activeSurfaceFrame,
  ])

  const selectItem = (item: LauncherItem | undefined, customizeParams = false) => {
    if (!item) return

    if (item.kind === 'domain') {
      // Intercept plugin surface items — render surface instead of execute
      if (item.domainItem.systemKey.startsWith('plugin-surface:')) {
        const parts = item.domainItem.systemKey.split(':')
        // format: plugin-surface:source:pluginId:surfaceId
        const source = parts[1]
        const pluginId = parts[2]
        const surfaceId = parts[3]
        if (isPluginSettingsSource(source) && pluginId && surfaceId) {
          clearPluginSurfaceTool()
          setSurfaceFrame({ source, pluginId, surfaceId })
          setSurfaceFocusVersion((version) => version + 1)
          return
        }
      }

      const controller = controllerRef.current
      if (!controller) {
        console.warn('[hiven] Cannot select domain launcher item before controller is ready:', item.domainItem.systemKey)
        return
      }
      if (!customizeParams && !supportsDefaultParamRun(item.domainItem)) {
        void controller.selectItem(item.domainItem, { customizeParams: true })
        return
      }
      void controller.selectItem(item.domainItem, { customizeParams })
      return
    }

    if (standaloneLauncher) {
      void (async () => {
        try {
          const { emitTo } = await import('@tauri-apps/api/event')
          const { invoke } = await import('@tauri-apps/api/core')
          if (item.kind === 'pinned') {
            await emitTo('main', 'hiven://run-pinned-action', { id: item.id })
          }
          await invoke('hide_launcher_window')
        } catch (error) {
          console.warn('[hiven] Failed to select launcher item:', error)
        }
        setOpen(false)
        restoreFocus()
      })()
      return
    }
    if (overlay) {
      void (async () => {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          const win = getCurrentWindow()
          await win.setDecorations(true)
        } catch (error) {
          console.warn('[hiven] Failed to restore launcher window:', error)
        }
        setOpen(false)
        restoreFocus()
        if (item.kind === 'pinned') {
          openPinnedAction(item.id)
          return
        }
        if (item.kind === 'view') {
          setActiveView(item.id)
          return
        }
      })()
    } else {
      setOpen(false)
      restoreFocus()
      if (item.kind === 'pinned') {
        openPinnedAction(item.id)
        return
      }
      if (item.kind === 'view') {
        setActiveView(item.id)
        return
      }
    }
  }

  const activateResultChoice = useCallback((choice: LauncherResultChoice) => {
    void launcherController?.activateChoice(choice)
  }, [launcherController])

  const leaveSurface = useCallback(() => {
    if (surfaceFrame && pluginSurfaceToolTarget && samePluginSurfaceTarget(surfaceFrame, pluginSurfaceToolTarget)) {
      closeLauncher()
      return
    }
    setSurfaceFrame(null)
  }, [closeLauncher, pluginSurfaceToolTarget, surfaceFrame])

  const closeSurface = useCallback(() => {
    setSurfaceFrame(null)
    closeLauncher()
  }, [closeLauncher])

  const requestSurfaceBack = useCallback(() => {
    window.dispatchEvent(new CustomEvent(PLUGIN_SURFACE_BACK_EVENT))
  }, [])

  const requestSurfaceClose = useCallback(() => {
    window.dispatchEvent(new CustomEvent(PLUGIN_SURFACE_CLOSE_EVENT))
  }, [])

  const leaveCrashedSurface = useCallback(() => {
    setSurfaceFrame(null)
  }, [])

  const handleHostEscape = useCallback((event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    if (shouldIgnoreImeKeyDown(event, isImeComposingRef)) return
    event.preventDefault()
    event.stopPropagation()

    if (surfaceFrame) {
      leaveSurface()
      return
    }

    if (controllerRef.current?.back()) {
      focusSearchInputAfterBack()
      return
    }

    closeLauncher()
  }, [closeLauncher, leaveSurface, surfaceFrame])

  useEffect(() => {
    if (!open) return
    window.addEventListener('keydown', handleHostEscape, true)
    return () => window.removeEventListener('keydown', handleHostEscape, true)
  }, [handleHostEscape, open])

  useEffect(() => {
    if (!open) return
    window.addEventListener(PLUGIN_SURFACE_BACK_EVENT, leaveSurface)
    window.addEventListener(PLUGIN_SURFACE_CLOSE_EVENT, closeSurface)
    return () => {
      window.removeEventListener(PLUGIN_SURFACE_BACK_EVENT, leaveSurface)
      window.removeEventListener(PLUGIN_SURFACE_CLOSE_EVENT, closeSurface)
    }
  }, [closeSurface, leaveSurface, open])

  function handleCompositionStart() {
    startImeComposition(isImeComposingRef)
  }

  function handleCompositionEnd() {
    finishImeComposition(isImeComposingRef)
  }

  const beginDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button, a, [role="button"], [data-no-drag], [data-launcher-scrollable]')) return
    if (standaloneLauncher && (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      event.preventDefault()
      event.stopPropagation()
      try {
        void getCurrentWindow().startDragging().catch((error) => {
          console.warn('[hiven] Failed to drag launcher window:', error)
        })
      } catch (error) {
        console.warn('[hiven] Failed to drag launcher window:', error)
      }
      return
    }
    const panel = panelRef.current
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    const initialPosition = { x: rect.left, y: rect.top }
    dragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      position: initialPosition,
    }
    setDragPosition(initialPosition)
    event.preventDefault()

    const move = (moveEvent: PointerEvent) => {
      const currentPanel = panelRef.current
      const drag = dragRef.current
      if (!currentPanel || !drag) return
      const width = currentPanel.offsetWidth
      const height = currentPanel.offsetHeight
      const next = {
        x: clamp(moveEvent.clientX - drag.offsetX, 8, Math.max(8, window.innerWidth - width - 8)),
        y: clamp(moveEvent.clientY - drag.offsetY, 8, Math.max(8, window.innerHeight - height - 8)),
      }
      drag.position = next
      setDragPosition(next)
    }

    const finish = () => {
      const position = dragRef.current?.position
      dragRef.current = null
      if (position) updateSetting('globalLauncherPosition', position)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }, [standaloneLauncher, updateSetting])

  const currentPosition = standaloneLauncher ? undefined : (dragPosition ?? launcherPosition)
  const panelStyle: CSSProperties = {
    background: 'var(--color-background-primary)',
    border: '0.5px solid var(--color-border-secondary)',
    borderRadius: 'var(--radius-xl)',
    width: activeSurfaceFrame?.surface.shell?.defaultWidth
      ? `min(${activeSurfaceFrame.surface.shell.defaultWidth}px, calc(100vw - 24px))`
      : undefined,
    maxHeight: activeSurfaceFrame?.surface.shell?.defaultHeight
      ? `min(${activeSurfaceFrame.surface.shell.defaultHeight}px, calc(100vh - 24px))`
      : undefined,
    left: currentPosition ? currentPosition.x : '50%',
    top: currentPosition ? currentPosition.y : overlay ? 12 : 70,
    transform: currentPosition ? undefined : 'translateX(-50%)',
  }

  useLayoutEffect(() => {
    if (!surfaceFrame) return
    const frame = window.requestAnimationFrame(() => {
      const shell = panelRef.current?.querySelector<HTMLElement>('.global-launcher-surface-shell')
      const focusTarget =
        shell?.querySelector<HTMLElement>('[data-plugin-surface-autofocus]') ??
        shell
      focusTarget?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [surfaceFrame, surfaceFocusVersion])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 palette-overlay global-launcher-overlay open"
      style={{ pointerEvents: 'auto', visibility: 'visible', zIndex: 1100 }}
      onClick={(event) => { if (event.target === event.currentTarget) closeLauncher() }}
    >
      <div
        ref={panelRef}
        className="global-launcher-panel overflow-hidden outline-none palette-panel"
        style={panelStyle}
        tabIndex={-1}
        onPointerDown={beginDrag}
        onContextMenu={(event) => {
          if (event.target instanceof HTMLElement && event.target.closest('input, textarea')) return
          event.preventDefault()
        }}
        onKeyDown={(event) => {
          if (shouldIgnoreImeKeyDown(event, isImeComposingRef)) return
          if (event.defaultPrevented) return
          if (surfaceFrame) {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              leaveSurface()
            }
            return
          }
          // Controller frame key handling (collect-input / result)
          if (controllerState && controllerState.frames.length > 1) {
            const topFrame = controllerState.frames[controllerState.frames.length - 1]
            if (topFrame.kind === 'param-input') {
              return
            }
            if (topFrame.kind === 'collect-input') {
              if (event.key === 'Enter') {
                event.preventDefault()
                void controllerRef.current?.submitInput()
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                controllerRef.current?.back()
                focusSearchInputAfterBack()
                return
              }
              if (event.key === 'Backspace' && !(topFrame as CollectInputFrame).inputText) {
                event.preventDefault()
                event.stopPropagation()
                controllerRef.current?.back()
                focusSearchInputAfterBack()
                return
              }
              return // other keys pass to input naturally
            }
            if (topFrame.kind === 'result') {
              if (event.key === 'Enter') {
                event.preventDefault()
                const choices = (topFrame as ResultFrame).output.choices
                if (choices.length > 0) {
                  void controllerRef.current?.activateChoice(choices[0])
                }
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                controllerRef.current?.back()
                focusSearchInputAfterBack()
                return
              }
              return
            }
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeLauncher()
            return
          }
          if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedIndex((index) => Math.min(index + 1, Math.max(0, filtered.length - 1))) }
          if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedIndex((index) => Math.max(index - 1, 0)) }
          if (event.key === 'Enter') {
            event.preventDefault()
            selectItem(selectedItem, shouldCustomizeParams(event.metaKey, event.ctrlKey))
          }
        }}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      >
        {surfaceFrame ? (() => {
          void pluginPermissionVersion
          if (!activeSurfaceFrame) {
            return <div className="p-4 text-center text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>Surface not found</div>
          }
          const { definition: def, surface } = activeSurfaceFrame
          const SurfaceComponent = surface.component
          const settingsContribution = def.settings
          const settings = settingsContribution ? resolvePluginSettings(surfaceFrame.source, surfaceFrame.pluginId, settingsContribution).value : {}
          const pluginT = makePluginT(surfaceFrame.pluginId, locale)
          const requestedPermissions = pluginRegistry.getPluginPermissions(surfaceFrame.pluginId, surfaceFrame.source)
          const permissions = getPluginPermissionSnapshot(surfaceFrame.source, surfaceFrame.pluginId, requestedPermissions)
          const missingPermissions = missingPluginPermissions(permissions, requestedPermissions)
          const openSettingsDialog = usePluginSettingsStore.getState().openSettingsDialog
          const hostStorage = createPluginPrivateStorage(surfaceFrame.source, surfaceFrame.pluginId, permissions)
          const shellHeight = surface.shell?.defaultHeight ?? 480
          return (
            <PluginSurfaceErrorBoundary pluginId={surfaceFrame.pluginId} onBack={leaveCrashedSurface}>
              <div
                className="global-launcher-surface-shell flex flex-col min-h-0 outline-none"
                tabIndex={-1}
                style={{ height: shellHeight }}
              >
                <div className="global-launcher-body" style={{ maxHeight: shellHeight, height: shellHeight, overflow: 'hidden' }}>
                  {missingPermissions.length > 0 ? (
                    <PluginSurfacePermissionGate
                      permissions={missingPermissions}
                      locale={locale}
                      onBack={requestSurfaceBack}
                      onGrant={() => {
                        grantPluginPermissions(surfaceFrame.source, surfaceFrame.pluginId, missingPermissions)
                        void restartPluginBackground(surfaceFrame.pluginId, surfaceFrame.source)
                      }}
                    />
                  ) : (
                    <SurfaceComponent
                      pluginId={surfaceFrame.pluginId}
                      surfaceId={surfaceFrame.surfaceId}
                      locale={locale}
                      t={pluginT}
                      settings={settings}
                      permissions={permissions}
                      host={{
                        close: requestSurfaceClose,
                        requestBack: requestSurfaceBack,
                        openSettings: () => { openSettingsDialog({ pluginId: surfaceFrame.pluginId, source: surfaceFrame.source }) },
                        showMessage: (message, level) => {
                          useAppStore.getState().setLastCommandStatus({ title: message, status: level === 'error' ? 'error' : 'success', message, updatedAt: Date.now() })
                        },
                        storage: hostStorage,
                        clipboard: createPluginClipboard(surfaceFrame.pluginId, permissions, hostStorage),
                        paste: createPluginPaste(permissions, hostStorage),
                      }}
                    />
                  )}
                </div>
              </div>
            </PluginSurfaceErrorBoundary>
          )
        })() : controllerState && controllerState.frames.length > 1 && controllerState.frames[controllerState.frames.length - 1].kind === 'param-input' ? (() => {
          const frame = controllerState.frames[controllerState.frames.length - 1] as ParamInputFrame
          return (
            <LauncherParamStep
              frame={frame}
              error={controllerState.error}
              busy={controllerState.busy}
              locale={locale}
              headerClassName="global-launcher-header flex items-center gap-2 px-3.5 py-2.5"
              bodyClassName="global-launcher-body"
              footerClassName="global-launcher-footer flex shrink-0 gap-3 px-3.5 py-1.5"
              onQueryChange={(value) => controllerRef.current?.setParamQuery(value)}
              onSelectedIndexChange={(index) => controllerRef.current?.setParamSelectedIndex(index)}
              onCommit={(value) => { void controllerRef.current?.commitCurrentParam(value) }}
              onBack={() => {
                controllerRef.current?.back()
                focusSearchInputAfterBack()
              }}
            />
          )
        })() : controllerState && controllerState.frames.length > 1 && controllerState.frames[controllerState.frames.length - 1].kind === 'collect-input' ? (() => {
          const frame = controllerState.frames[controllerState.frames.length - 1] as CollectInputFrame
          const placeholder = frame.input.placeholder ?? ''
          const previewChoice = frame.previewOutput?.choices[0]
          const paramChips: { label: string; value: string }[] = []
          if (frame.params && frame.item.params) {
            for (const p of frame.item.params) {
              const val = frame.params[p.key]
              if (val !== undefined && val !== null) {
                paramChips.push({ label: localized(p.label, p.labelI18n, locale), value: resolveParamValueLabel(p, val, locale) })
              }
            }
          }
          return (
            <>
              <div className="global-launcher-header flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                {resolveIcon(frame.item.display.icon, 16, resolveDisplayTitle(frame.item.display, locale))}
                {paramChips.map((chip, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center text-[11px] px-1.5 py-0.5 rounded shrink-0 max-w-[100px] truncate"
                    style={{
                      background: 'var(--color-background-tertiary)',
                      border: '0.5px solid var(--color-border-tertiary)',
                      color: 'var(--color-text-secondary)',
                      fontFamily: 'var(--font-mono)',
                    }}
                    title={`${chip.label}: ${chip.value}`}
                  >
                    {chip.value}
                  </span>
                ))}
                <input
                  ref={inputRef}
                  value={frame.inputText}
                  onChange={(event) => controllerRef.current?.setInputText(event.target.value)}
                  placeholder={placeholder}
                  className="flex-1 min-w-0 outline-none border-none bg-transparent text-[14px]"
                  style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
                />
                {controllerState.busy && (
                  <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>...</span>
                )}
              </div>
              {controllerState.error && (
                <div className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
                  {controllerState.error}
                </div>
              )}
              {previewChoice && (
                <div className="global-launcher-body">
                  <button
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-left text-[13px] bg-[var(--color-background-secondary)] hover:bg-[var(--color-background-secondary)]"
                    style={{ color: 'var(--color-text-primary)' }}
                    onClick={() => activateResultChoice(previewChoice)}
                  >
                    <span className="flex-1 truncate">{previewChoice.title}</span>
                    {previewChoice.subtitle && (
                      <span className="text-[11px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>
                        {previewChoice.subtitle}
                      </span>
                    )}
                  </button>
                </div>
              )}
              <div className="global-launcher-footer flex shrink-0 gap-3 px-3.5 py-1.5" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                {previewChoice
                  ? <HintText label={t(locale, 'palette.enterToCopy')} />
                  : <HintKey keys="↵" label={t(locale, 'palette.quickEntryRun')} />}
                <HintKey keys="esc" label={t(locale, 'palette.back')} />
              </div>
            </>
          )
        })() : controllerState && controllerState.frames.length > 1 && controllerState.frames[controllerState.frames.length - 1].kind === 'result' ? (() => {
          const frame = controllerState.frames[controllerState.frames.length - 1] as ResultFrame
          const choices = frame.output.choices
          return (
            <>
              <div className="global-launcher-header flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                <span className="text-[13px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  {frame.sourceTitle}
                </span>
              </div>
              <div className="global-launcher-body">
                {choices.map((choice, index) => (
                  <button
                    key={choice.id}
                    className={`w-full flex items-center gap-2 px-3.5 py-2 text-left text-[13px] hover:bg-[var(--color-background-secondary)] ${index === 0 ? 'bg-[var(--color-background-secondary)]' : ''}`}
                    style={{ color: 'var(--color-text-primary)' }}
                    onClick={() => activateResultChoice(choice)}
                  >
                    <span className="flex-1 truncate">{choice.title}</span>
                    {choice.subtitle && (
                      <span className="text-[11px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>
                        {choice.subtitle}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {controllerState.error && (
                <div className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
                  {controllerState.error}
                </div>
              )}
              <div className="global-launcher-footer flex shrink-0 gap-3 px-3.5 py-1.5" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                <HintKey keys="↵" label={t(locale, 'palette.confirm')} />
                <HintKey keys="esc" label={t(locale, 'palette.back')} />
              </div>
            </>
          )
        })() : (
          <>
            <div className="global-launcher-header flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
              <Search size={16} style={{ color: 'var(--color-text-tertiary)' }} />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0) }}
                placeholder={t(locale, 'palette.globalPlaceholder')}
                className="flex-1 outline-none border-none bg-transparent text-[14px]"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
              />
            </div>
            {controllerState?.error && (
              <div className="px-3.5 py-1.5 text-[12px]" style={{ color: 'var(--color-error)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                {controllerState.error}
              </div>
            )}
            <div className="global-launcher-body">
              <LauncherList
                items={filtered}
                selected={selectedItem}
                onSelect={(item) => selectItem(item)}
              />
            </div>
            <div className="global-launcher-footer flex shrink-0 gap-3 px-3.5 py-1.5" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
              <HintKey keys="↑↓" label={t(locale, 'palette.select')} />
              <HintKey keys="↵" label={t(locale, 'palette.confirm')} />
              {selectedItem?.kind === 'domain' && supportsParamCustomization(selectedItem.domainItem) && (
                <HintKey keys={`${getPlatformShortcutMeta().label}↵`} label={t(locale, 'palette.customizeParamsLabel')} />
              )}
              <HintKey keys="esc" label={t(locale, 'palette.back')} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function measureStandaloneLauncherPanelHeight(panel: HTMLElement) {
  const header = panel.querySelector<HTMLElement>('.global-launcher-header')
  const body = panel.querySelector<HTMLElement>('.global-launcher-body')
  const footer = panel.querySelector<HTMLElement>('.global-launcher-footer')
  if (!header || !footer) return panel.getBoundingClientRect().height

  if (!body) return panel.getBoundingClientRect().height
  const bodyMaxHeight = readCssPixelValue(getComputedStyle(body).maxHeight, STANDALONE_LAUNCHER_LIST_MAX_HEIGHT)
  return header.offsetHeight + Math.min(body.scrollHeight, bodyMaxHeight) + footer.offsetHeight
}

function readCssPixelValue(value: string, fallback: number) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}



function isStandaloneLauncherWindow() {
  return new URLSearchParams(window.location.search).get('window') === 'launcher'
}

function isPluginSettingsSource(value: string | undefined): value is PluginSettingsSource {
  return value === 'builtin' || value === 'installed' || value === 'dev'
}

function LauncherList({ items, selected, onSelect }: { items: LauncherItem[]; selected?: LauncherItem; onSelect: (item: LauncherItem) => void }) {
  if (items.length === 0) return null
  return (
    <div className="py-1">
      {items.map((item) => {
        const isSelected = selected?.kind === item.kind && selected.id === item.id
        return (
          <button
            key={`${item.kind}:${item.id}`}
            className={`cmd-item w-full border-none text-left ${isSelected ? 'selected' : ''}`}
            style={{
              background: isSelected ? 'var(--color-accent-light)' : 'transparent',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-mono)',
            }}
            onClick={() => onSelect(item)}
          >
            <span
              className="w-[26px] h-[26px] rounded-md flex items-center justify-center text-xs font-semibold shrink-0"
              style={{
                background: isSelected ? 'var(--color-accent)' : 'var(--color-background-tertiary)',
                color: isSelected ? 'white' : 'var(--color-text-secondary)',
              }}
            >
              {item.kind === 'domain'
                ? resolveIcon(item.icon, 14, item.title)
                : item.kind === 'pinned'
                ? resolveIcon(item.icon, 14, item.title) || <Pin size={14} />
                : item.kind === 'view' ? item.icon : resolveIcon(item.icon, 14, item.title)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium truncate">{item.title}</span>
              <span className="block text-[11px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>{item.subtitle}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function HintKey({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
      <kbd className="text-[10px] px-1 py-0.5 rounded" style={{ background: 'var(--color-background-tertiary)', border: '0.5px solid var(--color-border-tertiary)' }}>{keys}</kbd>
      {label}
    </span>
  )
}

function HintText({ label }: { label: string }) {
  return (
    <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
      {label}
    </span>
  )
}

function launcherItemMatchesQuery(item: LauncherItem, q: string, locale: Locale): boolean {
  return searchableFieldsMatch(launcherItemSearchFields(item), q, locale)
}

function scoreLauncherItem(
  item: LauncherItem,
  q: string,
  locale: Locale,
  recentNames: string[],
  usageCounts: Record<string, number>,
): number {
  return scoreSearchableFields(launcherItemSearchFields(item), q, locale, recentNames, usageCounts)
}

function launcherItemSearchFields(item: LauncherItem): SearchableFields {
  return {
    id: launcherItemSearchId(item),
    title: item.title,
    description: item.subtitle,
    usageKey: launcherItemUsageKey(item),
  }
}

function launcherItemSearchId(item: LauncherItem): string {
  if (item.kind === 'pinned') return item.actionId
  if (item.kind === 'view') return `view:${item.id}`
  return item.id
}

function launcherItemUsageKey(item: LauncherItem): string {
  if (item.kind === 'pinned') return item.actionId
  return item.id
}

// ─── Plugin Surface Helpers ──────────────────────────────────────────────────

function PluginSurfacePermissionGate({
  permissions,
  locale,
  onBack,
  onGrant,
}: {
  permissions: PluginPermission[]
  locale: Locale
  onBack: () => void
  onGrant: () => void
}) {
  const copy = locale === 'zh'
    ? {
        title: '需要授权',
        description: '这个插件需要 host 管理的权限后，才能运行 surface 或 background。',
        allow: '允许',
        back: '返回',
      }
    : {
        title: 'Permissions required',
        description: 'This plugin needs host-managed permissions before its surface or background can run.',
        allow: 'Allow',
        back: 'Back',
      }

  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center" style={{ color: 'var(--color-text-secondary)' }}>
      <div className="text-[13px] font-medium" style={{ color: 'var(--color-text-primary)' }}>{copy.title}</div>
      <div className="max-w-[420px] text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>
        {copy.description}
      </div>
      <div className="max-w-[420px] flex flex-col gap-1 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
        {permissions.map((permission) => (
          <div key={permission}>
            {describePluginPermission(permission, locale)}
            <span style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}> {permission}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <button
          className="text-[12px] px-3 py-1.5 rounded"
          style={{ background: 'var(--color-accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
          onClick={onGrant}
        >
          {copy.allow}
        </button>
        <button
          className="text-[12px] px-3 py-1.5 rounded"
          style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-primary)', border: 'none', cursor: 'pointer' }}
          onClick={onBack}
        >
          {copy.back}
        </button>
      </div>
    </div>
  )
}

type SurfaceErrorBoundaryProps = {
  pluginId: string
  onBack: () => void
  children: ReactNode
}

type SurfaceErrorBoundaryState = {
  hasError: boolean
  error?: string
}

class PluginSurfaceErrorBoundary extends Component<SurfaceErrorBoundaryProps, SurfaceErrorBoundaryState> {
  state: SurfaceErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(error: Error): SurfaceErrorBoundaryState {
    return { hasError: true, error: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[hiven] Plugin surface "${this.props.pluginId}" crashed:`, error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-6" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="text-[13px]">Plugin surface crashed</span>
          <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{this.state.error}</span>
          <button
            className="text-[12px] px-3 py-1.5 rounded"
            style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-primary)', border: 'none', cursor: 'pointer' }}
            onClick={this.props.onBack}
          >
            Back
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function samePluginSurfaceTarget(
  a: PluginSurfaceOpenTarget,
  b: PluginSurfaceOpenTarget,
): boolean {
  return a.source === b.source && a.pluginId === b.pluginId && a.surfaceId === b.surfaceId
}
