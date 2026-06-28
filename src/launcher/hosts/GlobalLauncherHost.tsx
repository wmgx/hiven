import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Pin, Search } from 'lucide-react'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { localized, useAppStore, type LauncherHostSurfaceTarget, type PluginSurfaceOpenTarget } from '../../store'
import { t, type Locale } from '../../i18n'
import { resolveIcon } from '../../utils/resolveIcon'
import { pluginRegistry, usePluginRegistryVersion } from '../../workspace/pluginRegistry'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from '../../utils/imeKeyboard'
import { usePluginSettingsStore } from '../../workspace/pluginSettingsStore'
import { scoreSearchableFields, searchableFieldsMatch, type SearchableFields } from '../../workspace/searchRanking'
import type { CollectInputFrame, ParamInputFrame, ResultFrame } from '../../workspace/launcher/controller'
import { resolveDisplayTitle, resolveDisplaySubtitle } from '../../workspace/launcher/display'
import type { LauncherItem as DomainLauncherItem, LauncherResultChoice } from '../../workspace/launcher/types'
import { LauncherParamStep, resolveParamValueLabel } from '../../components/launcher/LauncherParamStep'
import { LauncherView } from '../../components/launcher/LauncherView'
import { PluginSettingsContent } from '../../components/PluginSettingsDialog'
import { getPlatformShortcutMeta, shouldCustomizeParams, supportsDefaultParamRun, supportsParamCustomization } from '../../components/launcher/launcherParamShortcuts'
import type { PluginDefinition, PluginPermission } from '../../workspace/pluginTypes'
import { getPluginPermissionSnapshot, missingPluginPermissions, usePluginPermissionStore } from '../../workspace/pluginPermissions'
import { restartPluginBackground } from '../../workspace/pluginBackgroundManager'
import type { PluginSettingsSource } from '../../workspace/pluginSettingsStore'
import { LAUNCHER_PROGRAMMATIC_MOVE_EVENT } from '../../workspace/launcherWindowEvents'
import { PluginSurfacePermissionGate, PluginSurfaceRenderer } from '../../components/pluginSurface/PluginSurfaceRenderer'
import { useLauncherSession } from '../../workspace/launcher/useLauncherSession'
import { markSurfaceInstanceState, upsertSurfaceInstance } from '../../surfaces/registry'
import { pluginSurfaceInstanceId } from '../../workspace/pluginSurfaceWindows'
import { hideLauncherWindow } from '../../workspace/windowManager/launcherWindow'

type LauncherItem =
  | { kind: 'domain'; id: string; title: string; subtitle: string; icon?: string; aliases?: string[]; domainItem: DomainLauncherItem }
  | { kind: 'pinned'; id: string; title: string; subtitle: string; icon?: string; aliases?: string[]; actionId: string }

const GLOBAL_LAUNCHER_PANEL_WIDTH = 680
const STANDALONE_LAUNCHER_WIDTH = 728
const STANDALONE_LAUNCHER_MIN_HEIGHT = 294
const STANDALONE_LAUNCHER_MAX_HEIGHT = 390
const STANDALONE_SURFACE_MAX_WIDTH = 920
const STANDALONE_SURFACE_MAX_HEIGHT = 760
const STANDALONE_LAUNCHER_VERTICAL_PADDING = 24
const STANDALONE_LAUNCHER_HORIZONTAL_PADDING = 24
const STANDALONE_LAUNCHER_LIST_MAX_HEIGHT = 300
const GLOBAL_LAUNCHER_SETTINGS_WIDTH = 720
const GLOBAL_LAUNCHER_SETTINGS_HEIGHT = 560
const PLUGIN_SURFACE_BACK_EVENT = 'hiven:plugin-surface-back'
const PLUGIN_SURFACE_CLOSE_EVENT = 'hiven:plugin-surface-close'
const SettingsSurfaceView = lazy(() => import('../../views/SettingsView').then((mod) => ({ default: mod.SettingsView })))
const ScriptsSurfaceView = lazy(() => import('../../views/ScriptsView').then((mod) => ({ default: mod.ScriptsView })))

export function GlobalLauncherHost() {
  const open = useAppStore((s) => s.globalLauncherOpen)
  const mode = useAppStore((s) => s.globalLauncherMode)
  const overlay = useAppStore((s) => s.globalLauncherOverlay)
  const setOpen = useAppStore((s) => s.setGlobalLauncherOpen)
  const openPinnedAction = useAppStore((s) => s.openPinnedAction)
  const pinnedActions = useAppStore((s) => s.pinnedActions)
  const recentActionNames = useAppStore((s) => s.actionUsageBySource['global-launcher'].recentActionNames)
  const actionUsageCounts = useAppStore((s) => s.actionUsageBySource['global-launcher'].actionUsageCounts)
  const locale = useAppStore((s) => s.locale)
  const pluginRegistryVersion = usePluginRegistryVersion()
  const pluginPermissionVersion = usePluginPermissionStore((s) => s.version)
  const grantPluginPermissions = usePluginPermissionStore((s) => s.grantPermissions)
  const pluginSurfaceToolTarget = useAppStore((s) => s.pluginSurfaceToolTarget)
  const clearPluginSurfaceTool = useAppStore((s) => s.clearPluginSurfaceTool)
  const launcherHostSurfaceTarget = useAppStore((s) => s.launcherHostSurfaceTarget)
  const clearLauncherHostSurface = useAppStore((s) => s.clearLauncherHostSurface)
  const settingsDialogTarget = usePluginSettingsStore((s) => s.settingsDialogTarget)
  const closeSettingsDialog = usePluginSettingsStore((s) => s.closeSettingsDialog)
  const closeAfterActionRef = useRef<() => void>(() => {})
  const [surfaceFrame, setSurfaceFrame] = useState<{ source: PluginSettingsSource; pluginId: string; surfaceId: string } | null>(null)
  const [itemPermissionFrame, setItemPermissionFrame] = useState<{
    item: DomainLauncherItem
    source: PluginSettingsSource
    pluginId: string
    permissions: PluginPermission[]
    customizeParams: boolean
  } | null>(null)
  const [surfaceFocusVersion, setSurfaceFocusVersion] = useState(0)
  const [resultSelectedIndex, setResultSelectedIndex] = useState(0)
  const [selectedResultChoiceIds, setSelectedResultChoiceIds] = useState<Set<string>>(() => new Set())
  const isKeyboardNavRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const isImeComposingRef = useRef(false)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const standaloneLauncher = isStandaloneLauncherWindow()
  const launcherSettingsTarget = settingsDialogTarget?.presentation === 'global-launcher'
    ? settingsDialogTarget
    : null
  const hostSurfaceTarget = launcherHostSurfaceTarget
  const {
    query,
    setQuery,
    selectedIndex,
    setSelectedIndex,
    controller,
    controllerRef,
    controllerState,
    rankedItems: rankedLauncherItems,
  } = useLauncherSession({
    hostId: 'global-launcher',
    open,
    requestClose: () => closeAfterActionRef.current(),
    collectDynamicWhenEmpty: true,
  })

  const openPluginSurface = useCallback(async (target: { source: PluginSettingsSource; pluginId: string; surfaceId: string }) => {
    const def = pluginRegistry.getPluginDefinition(target.pluginId, target.source) as PluginDefinition<unknown> | undefined
    const surface = def?.ui?.surfaces?.find((candidate) => candidate.id === target.surfaceId)
    if (!surface) return

    setSurfaceFrame(target)
    setSurfaceFocusVersion((version) => version + 1)
  }, [pluginRegistryVersion])

  useEffect(() => {
    if (!open) return
    upsertSurfaceInstance({
      id: 'launcher',
      kind: 'launcher',
      windowLabel: standaloneLauncher ? 'launcher' : 'main',
      title: 'Hiven Launcher',
      state: 'visible',
      canReceiveText: true,
    })
    previousFocusRef.current = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => {
      setQuery('')
      setSelectedIndex(0)
      inputRef.current?.focus()
    })
  }, [open])

  useEffect(() => {
    if (open) return
    markSurfaceInstanceState('launcher', 'hidden')
    setSurfaceFrame(null)
    controllerRef.current?.reset()
  }, [open])

  useEffect(() => {
    if (!open || !launcherSettingsTarget) return
    upsertSurfaceInstance({
      id: `settings:${launcherSettingsTarget.source}:${launcherSettingsTarget.pluginId}`,
      kind: 'settings',
      windowLabel: standaloneLauncher ? 'launcher' : 'main',
      title: 'Plugin Settings',
      pluginId: launcherSettingsTarget.pluginId,
      state: 'visible',
      canReceiveText: false,
      canProvideText: false,
    })
  }, [launcherSettingsTarget, open, standaloneLauncher])

  useEffect(() => {
    if (!open || !hostSurfaceTarget) return
    upsertSurfaceInstance({
      id: `host-surface:${hostSurfaceTarget}`,
      kind: hostSurfaceTarget === 'plugins' ? 'plugins' : 'settings',
      windowLabel: standaloneLauncher ? 'launcher' : 'main',
      title: hostSurfaceTarget === 'plugins' ? 'Plugins' : 'Settings',
      state: 'visible',
      canReceiveText: false,
      canProvideText: false,
    })
  }, [hostSurfaceTarget, open, standaloneLauncher])

  useEffect(() => {
    if (!open || !pluginSurfaceToolTarget) return
    const timer = window.setTimeout(() => {
      void openPluginSurface(pluginSurfaceToolTarget)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open, pluginSurfaceToolTarget, openPluginSurface])

  const activeSurfaceFrame = useMemo(() => {
    void pluginRegistryVersion
    if (!surfaceFrame) return null
    const def = pluginRegistry.getPluginDefinition(surfaceFrame.pluginId, surfaceFrame.source) as PluginDefinition<unknown> | undefined
    const surface = def?.ui?.surfaces?.find((s) => s.id === surfaceFrame.surfaceId)
    if (!def || !surface) return null
    return { definition: def, surface }
  }, [surfaceFrame, pluginRegistryVersion])

  useEffect(() => {
    if (!open || !surfaceFrame) return
    upsertSurfaceInstance({
      id: pluginSurfaceInstanceId(surfaceFrame),
      kind: 'plugin-surface',
      windowLabel: standaloneLauncher ? 'launcher' : 'main',
      title: activeSurfaceFrame?.surface.title ?? surfaceFrame.surfaceId,
      pluginId: surfaceFrame.pluginId,
      surfaceId: surfaceFrame.surfaceId,
      state: 'visible',
      canReceiveText: true,
      canProvideText: true,
      canAttachToEditor: true,
    })
  }, [activeSurfaceFrame?.surface.title, open, standaloneLauncher, surfaceFrame])

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
    return pinned
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
      aliases: domainItem.display.aliases,
      domainItem,
    }))

    return [...domainItems, ...sortedBase]
  }, [items, query, locale, pluginRegistryVersion, recentActionNames, actionUsageCounts, rankedLauncherItems])
  const visibleFiltered = filtered

  const restoreFocus = useCallback(() => {
    const el = previousFocusRef.current
    if (el && typeof el.focus === 'function') {
      requestAnimationFrame(() => el.focus())
    }
    previousFocusRef.current = null
  }, [])

  const resetLauncherSession = useCallback(() => {
    clearPluginSurfaceTool()
    clearLauncherHostSurface()
    setSurfaceFrame(null)
    setItemPermissionFrame(null)
    if (usePluginSettingsStore.getState().settingsDialogTarget?.presentation === 'global-launcher') {
      closeSettingsDialog()
    }
    setQuery('')
    setSelectedIndex(0)
    controllerRef.current?.reset()
  }, [clearLauncherHostSurface, clearPluginSurfaceTool, closeSettingsDialog])

  const closeLauncher = useCallback(() => {
    const wasOverlay = overlay
    resetLauncherSession()
    if (standaloneLauncher) {
      void (async () => {
        try {
          await hideLauncherWindow()
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
          await hideLauncherWindow()
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

    const closeOnBlur = activeSurfaceFrame?.surface.shell?.closeOnBlur
    let disposed = false
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (!focused && closeOnBlur !== false) closeLauncher()
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
  }, [activeSurfaceFrame?.surface.shell?.closeOnBlur, closeLauncher, open, standaloneLauncher])

  const clampedSelectedIndex = Math.min(selectedIndex, Math.max(0, visibleFiltered.length - 1))
  const selectedItem = visibleFiltered.length === 1 ? visibleFiltered[0] : visibleFiltered[clampedSelectedIndex]
  const activeResultFrame = controllerState?.frames.length
    ? controllerState.frames[controllerState.frames.length - 1]
    : null

  useEffect(() => {
    if (activeResultFrame?.kind !== 'result') return
    setResultSelectedIndex(0)
    setSelectedResultChoiceIds(new Set())
  }, [activeResultFrame?.kind, activeResultFrame?.kind === 'result' ? activeResultFrame.sourceTitle : undefined])

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

    const timer = window.setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      const surfaceShell = activeSurfaceFrame?.surface.shell
      const desiredPanelHeight = hostSurfaceTarget
        ? STANDALONE_SURFACE_MAX_HEIGHT
        : launcherSettingsTarget
        ? GLOBAL_LAUNCHER_SETTINGS_HEIGHT
        : surfaceShell?.defaultHeight
        ? surfaceShell.defaultHeight
        : measureStandaloneLauncherPanelHeight(panel)
      const nextHeight = clamp(
        Math.ceil(desiredPanelHeight + STANDALONE_LAUNCHER_VERTICAL_PADDING),
        STANDALONE_LAUNCHER_MIN_HEIGHT,
        surfaceShell || launcherSettingsTarget || hostSurfaceTarget ? STANDALONE_SURFACE_MAX_HEIGHT : STANDALONE_LAUNCHER_MAX_HEIGHT,
      )
      const desiredPanelWidth = hostSurfaceTarget
        ? STANDALONE_SURFACE_MAX_WIDTH
        : launcherSettingsTarget
        ? GLOBAL_LAUNCHER_SETTINGS_WIDTH
        : surfaceShell?.defaultWidth ?? GLOBAL_LAUNCHER_PANEL_WIDTH
      const nextWidth = clamp(
        Math.ceil(desiredPanelWidth + STANDALONE_LAUNCHER_HORIZONTAL_PADDING),
        STANDALONE_LAUNCHER_WIDTH,
        surfaceShell || launcherSettingsTarget || hostSurfaceTarget ? STANDALONE_SURFACE_MAX_WIDTH : STANDALONE_LAUNCHER_WIDTH,
      )
      window.dispatchEvent(new CustomEvent(LAUNCHER_PROGRAMMATIC_MOVE_EVENT))
      void getCurrentWindow()
        .setSize(new LogicalSize(nextWidth, nextHeight))
        .catch((error) => {
          console.warn('[hiven] Failed to resize launcher window:', error)
        })
    }, 50)

    return () => window.clearTimeout(timer)
  }, [
    visibleFiltered.length,
    mode,
    open,
    controllerState,
    standaloneLauncher,
    activeSurfaceFrame,
    hostSurfaceTarget,
    launcherSettingsTarget,
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
          void openPluginSurface({ source, pluginId, surfaceId })
          return
        }
      }

      const missingPermissions = missingPluginItemPermissions(item.domainItem)
      if (missingPermissions.length > 0 && item.domainItem.pluginId && item.domainItem.source) {
        setItemPermissionFrame({
          item: item.domainItem,
          source: item.domainItem.source,
          pluginId: item.domainItem.pluginId,
          permissions: missingPermissions,
          customizeParams,
        })
        return
      }

      executeDomainItem(item.domainItem, customizeParams)
      return
    }

    if (standaloneLauncher) {
      void (async () => {
        try {
          if (item.kind === 'pinned') {
            openPinnedAction(item.id)
          }
          await hideLauncherWindow()
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
      })()
    } else {
      setOpen(false)
      restoreFocus()
      if (item.kind === 'pinned') {
        openPinnedAction(item.id)
        return
      }
    }
  }

  function executeDomainItem(item: DomainLauncherItem, customizeParams = false) {
    const controller = controllerRef.current
    if (!controller) {
      console.warn('[hiven] Cannot select domain launcher item before controller is ready:', item.systemKey)
      return
    }
    if (!customizeParams && !supportsDefaultParamRun(item)) {
      void controller.selectItem(item, { customizeParams: true })
      return
    }
    void controller.selectItem(item, { customizeParams })
  }

  function missingPluginItemPermissions(item: DomainLauncherItem): PluginPermission[] {
    if (!item.pluginId || !item.source) return []
    const requestedPermissions = pluginRegistry.getPluginPermissions(item.pluginId, item.source)
    if (requestedPermissions.length === 0) return []
    const permissions = getPluginPermissionSnapshot(item.source, item.pluginId, requestedPermissions)
    return missingPluginPermissions(permissions, requestedPermissions)
  }

  function grantItemPermissionsAndRun() {
    if (!itemPermissionFrame) return
    grantPluginPermissions(itemPermissionFrame.source, itemPermissionFrame.pluginId, itemPermissionFrame.permissions)
    void restartPluginBackground(itemPermissionFrame.pluginId, itemPermissionFrame.source)
    const item = itemPermissionFrame.item
    const customizeParams = itemPermissionFrame.customizeParams
    setItemPermissionFrame(null)
    executeDomainItem(item, customizeParams)
  }

  function cancelItemPermissionPrompt() {
    setItemPermissionFrame(null)
    focusSearchInputAfterBack()
  }

  const activateResultChoice = useCallback((choice: LauncherResultChoice) => {
    void controller?.activateChoice(choice)
  }, [controller])

  const toggleResultChoice = useCallback((choice: LauncherResultChoice, frame: ResultFrame) => {
    const selection = frame.output.selection
    if (selection?.type !== 'multi') {
      activateResultChoice(choice)
      return
    }
    setSelectedResultChoiceIds((current) => {
      const next = new Set(current)
      if (next.has(choice.id)) {
        next.delete(choice.id)
      } else if (next.size < selection.max) {
        next.add(choice.id)
      }
      if (next.size >= selection.max) {
        const selectedChoices = frame.output.choices.filter((item) => next.has(item.id))
        queueMicrotask(() => { void controller?.submitResultSelection(selectedChoices) })
      }
      return next
    })
  }, [activateResultChoice, controller])

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
    if (event.key === 'Escape' && launcherSettingsTarget) {
      event.preventDefault()
      event.stopPropagation()
      closeSettingsDialog()
      focusSearchInputAfterBack()
      return
    }
    if (settingsDialogTarget) return
    event.preventDefault()
    event.stopPropagation()

    if (surfaceFrame) {
      leaveSurface()
      return
    }

    if (hostSurfaceTarget) {
      clearLauncherHostSurface()
      focusSearchInputAfterBack()
      return
    }

    if (itemPermissionFrame) {
      cancelItemPermissionPrompt()
      return
    }

    if (controllerRef.current?.back()) {
      focusSearchInputAfterBack()
      return
    }

    closeLauncher()
  }, [clearLauncherHostSurface, closeLauncher, closeSettingsDialog, hostSurfaceTarget, itemPermissionFrame, launcherSettingsTarget, leaveSurface, settingsDialogTarget, surfaceFrame])

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
    // Only the standalone launcher window is draggable, via the native Tauri
    // window drag. Its position (with TTL) is persisted in App.tsx `onMoved`.
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
    }
  }, [standaloneLauncher])

  // The launcher is always horizontally centered. In the standalone window the
  // window itself is positioned natively (see `center_launcher_window`); here
  // the panel just centers within whatever window renders it.
  const panelStyle: CSSProperties & Record<'--launcher-panel-width', string> = {
    background: 'var(--panel, #ffffff)',
    border: '1px solid var(--border, #ececed)',
    borderRadius: 'var(--radius, 10px)',
    '--launcher-panel-width': hostSurfaceTarget
      ? `${STANDALONE_SURFACE_MAX_WIDTH}px`
      : launcherSettingsTarget
      ? `${GLOBAL_LAUNCHER_SETTINGS_WIDTH}px`
      : activeSurfaceFrame?.surface.shell?.defaultWidth
      ? `${activeSurfaceFrame.surface.shell.defaultWidth}px`
      : `${GLOBAL_LAUNCHER_PANEL_WIDTH}px`,
    width: hostSurfaceTarget
      ? `min(${STANDALONE_SURFACE_MAX_WIDTH}px, calc(100vw - 24px))`
      : launcherSettingsTarget
      ? `min(${GLOBAL_LAUNCHER_SETTINGS_WIDTH}px, calc(100vw - 24px))`
      : activeSurfaceFrame?.surface.shell?.defaultWidth
      ? `min(${activeSurfaceFrame.surface.shell.defaultWidth}px, calc(100vw - 24px))`
      : undefined,
    maxHeight: hostSurfaceTarget
      ? `min(${STANDALONE_SURFACE_MAX_HEIGHT}px, calc(100vh - 24px))`
      : launcherSettingsTarget
      ? `min(${GLOBAL_LAUNCHER_SETTINGS_HEIGHT}px, calc(100vh - 24px))`
      : activeSurfaceFrame?.surface.shell?.defaultHeight
      ? `min(${activeSurfaceFrame.surface.shell.defaultHeight}px, calc(100vh - 24px))`
      : undefined,
    left: '50%',
    top: standaloneLauncher ? 12 : 54,
    transform: 'translateX(-50%)',
  }

  useLayoutEffect(() => {
    if (!surfaceFrame && !launcherSettingsTarget && !hostSurfaceTarget) return
    const frame = window.requestAnimationFrame(() => {
      const shell = panelRef.current?.querySelector<HTMLElement>('.global-launcher-surface-shell, .global-launcher-settings-shell, .global-launcher-host-surface-shell')
      const focusTarget =
        shell?.querySelector<HTMLElement>('[data-plugin-surface-autofocus]') ??
        shell
      focusTarget?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [hostSurfaceTarget, launcherSettingsTarget, surfaceFrame, surfaceFocusVersion])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 palette-overlay global-launcher-overlay open"
      style={{ pointerEvents: 'auto', visibility: 'visible', zIndex: 1100 }}
      onClick={(event) => { if (event.target === event.currentTarget) closeLauncher() }}
    >
      <LauncherView
        hostId="global-launcher"
        ref={panelRef}
        busy={controllerState?.busy ?? false}
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
          if (event.key === 'Escape' && launcherSettingsTarget) {
            event.preventDefault()
            event.stopPropagation()
            closeSettingsDialog()
            focusSearchInputAfterBack()
            return
          }
          if (launcherSettingsTarget) {
            return
          }
          if (surfaceFrame) {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              leaveSurface()
            }
            return
          }
          if (itemPermissionFrame) {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              cancelItemPermissionPrompt()
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
              const choices = (topFrame as ResultFrame).output.choices
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setResultSelectedIndex((index) => Math.min(index + 1, Math.max(0, choices.length - 1)))
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setResultSelectedIndex((index) => Math.max(index - 1, 0))
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                const choice = choices[Math.min(resultSelectedIndex, Math.max(0, choices.length - 1))]
                if (choice) {
                  toggleResultChoice(choice, topFrame as ResultFrame)
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
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            isKeyboardNavRef.current = true
            setSelectedIndex((index) => Math.min(index + 1, Math.max(0, visibleFiltered.length - 1)))
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            isKeyboardNavRef.current = true
            setSelectedIndex((index) => Math.max(index - 1, 0))
          }
          if (event.key === 'Tab' && isWorkflowObjectLauncherItem(selectedItem)) {
            event.preventDefault()
            selectItem(selectedItem)
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            selectItem(selectedItem, shouldCustomizeParams(event.metaKey, event.ctrlKey))
          }
        }}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      >
        {hostSurfaceTarget ? (
          <div
            className="global-launcher-host-surface-shell flex flex-col min-h-0 outline-none"
            tabIndex={-1}
            style={{ height: STANDALONE_SURFACE_MAX_HEIGHT }}
          >
            <HostSurfaceView target={hostSurfaceTarget} />
          </div>
        ) : launcherSettingsTarget ? (
          <div
            className="global-launcher-settings-shell flex flex-col min-h-0 outline-none"
            tabIndex={-1}
            style={{ height: GLOBAL_LAUNCHER_SETTINGS_HEIGHT }}
          >
            <PluginSettingsContent
              pluginId={launcherSettingsTarget.pluginId}
              source={launcherSettingsTarget.source}
              locale={locale}
              onClose={() => {
                closeSettingsDialog()
                focusSearchInputAfterBack()
              }}
            />
          </div>
        ) : surfaceFrame ? (() => {
          if (!activeSurfaceFrame) {
            return <div className="p-4 text-center text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>Surface not found</div>
          }
          const { surface } = activeSurfaceFrame
          const shellHeight = surface.shell?.defaultHeight ?? 480
          return (
            <div
              className="global-launcher-surface-shell flex flex-col min-h-0 outline-none"
              tabIndex={-1}
              style={{ height: shellHeight }}
            >
              <div className="global-launcher-body" style={{ maxHeight: shellHeight, height: shellHeight, overflow: 'hidden' }}>
                <PluginSurfaceRenderer
                  target={surfaceFrame}
                  locale={locale}
                  presentation="global-launcher"
                  contextSurfaceId="global-launcher"
                  onBack={requestSurfaceBack}
                  onClose={requestSurfaceClose}
                />
              </div>
            </div>
          )
        })() : itemPermissionFrame ? (
          <div className="global-launcher-body" style={{ height: 260 }}>
            <PluginSurfacePermissionGate
              permissions={itemPermissionFrame.permissions}
              locale={locale}
              onBack={cancelItemPermissionPrompt}
              onGrant={grantItemPermissionsAndRun}
            />
          </div>
        ) : controllerState && controllerState.frames.length > 1 && controllerState.frames[controllerState.frames.length - 1].kind === 'param-input' ? (() => {
          const frame = controllerState.frames[controllerState.frames.length - 1] as ParamInputFrame
          return (
            <LauncherParamStep
              frame={frame}
              error={controllerState.error}
              busy={controllerState.busy}
              locale={locale}
              headerClassName="global-launcher-header l-search"
              bodyClassName="global-launcher-body l-list opt"
              footerClassName="global-launcher-footer l-foot"
              onQueryChange={(value) => controllerRef.current?.setParamQuery(value)}
              onSelectedIndexChange={(index) => controllerRef.current?.setParamSelectedIndex(index)}
              onCommit={(value) => { void controllerRef.current?.commitCurrentParam(value) }}
              onMultiToggle={(value) => controllerRef.current?.toggleCurrentMultiParamValue(value)}
              onBack={() => {
                controllerRef.current?.back()
                focusSearchInputAfterBack()
              }}
            />
          )
        })() : controllerState && controllerState.frames.length > 1 && controllerState.frames[controllerState.frames.length - 1].kind === 'collect-input' ? (() => {
          const frame = controllerState.frames[controllerState.frames.length - 1] as CollectInputFrame
          const placeholder = frame.input.placeholder ?? ''
          const previewChoices = frame.previewOutput?.choices ?? []
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
              <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
                <button className="back" type="button" onClick={() => { controllerRef.current?.back(); focusSearchInputAfterBack() }}>‹</button>
                <span className="title">
                  <span className="t-ico">{resolveIcon(frame.item.display.icon, 14, resolveDisplayTitle(frame.item.display, locale))}</span>
                  {resolveDisplayTitle(frame.item.display, locale)}
                </span>
                {paramChips.map((chip) => (
                  <span
                    key={chip.label}
                    className="kbd shrink-0 max-w-[100px] truncate"
                    title={`${chip.label}: ${chip.value}`}
                  >
                    {chip.value}
                  </span>
                ))}
                <span className="vbar" />
                <input
                  ref={inputRef}
                  value={frame.inputText}
                  onChange={(event) => controllerRef.current?.setInputText(event.target.value)}
                  placeholder={placeholder}
                  className="mono"
                />
                {controllerState.busy && (
                  <span className="meta">...</span>
                )}
              </div>
              {controllerState.error && (
                <div className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
                  {controllerState.error}
                </div>
              )}
              {previewChoices.length > 0 && (
                <div className="global-launcher-body l-results">
                  {previewChoices.map((choice, index) => (
                    <ResultChoiceRow
                      key={choice.id}
                      choice={choice}
                      index={index}
                      selected={index === 0}
                      onSelect={() => activateResultChoice(choice)}
                    />
                  ))}
                </div>
              )}
              <div className="global-launcher-footer l-foot">
                {previewChoices.length > 0
                  ? <HintText label={t(locale, 'palette.enterToCopy')} />
                  : <HintKey keys="↵" label={t(locale, 'palette.quickEntryRun')} />}
                <HintKey keys="esc" label={t(locale, 'palette.back')} />
              </div>
            </>
          )
        })() : controllerState && controllerState.frames.length > 1 && controllerState.frames[controllerState.frames.length - 1].kind === 'result' ? (() => {
          const frame = controllerState.frames[controllerState.frames.length - 1] as ResultFrame
          const choices = frame.output.choices
          const selection = frame.output.selection
          const clampedResultSelectedIndex = Math.min(resultSelectedIndex, Math.max(0, choices.length - 1))
          const selectedCount = selectedResultChoiceIds.size
          const countLabel = selection?.type === 'multi'
            ? t(locale, 'palette.selectedCountMax', { count: selectedCount, max: selection.max })
            : null
          return (
            <>
              <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
                <button className="back" type="button" onClick={() => { controllerRef.current?.back(); focusSearchInputAfterBack() }}>‹</button>
                <span className="title">
                  {frame.sourceTitle}
                </span>
              </div>
              <div className="global-launcher-body l-results">
                {choices.map((choice, index) => {
                  const checked = selectedResultChoiceIds.has(choice.id)
                  const disabled = selection?.type === 'multi' && selectedCount >= selection.max && !checked
                  return (
                  <ResultChoiceRow
                    key={choice.id}
                    choice={choice}
                    index={index}
                    selected={index === clampedResultSelectedIndex}
                    checked={checked}
                    disabled={disabled}
                    multi={selection?.type === 'multi'}
                    onHover={() => setResultSelectedIndex(index)}
                    onSelect={() => toggleResultChoice(choice, frame)}
                  />
                  )
                })}
              </div>
              {controllerState.error && (
                <div className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
                  {controllerState.error}
                </div>
              )}
              <div className="global-launcher-footer l-foot">
                {countLabel && <HintText label={countLabel} />}
                <HintKey keys="↵" label={selection?.type === 'multi' ? t(locale, 'palette.select') : t(locale, 'palette.confirm')} />
                <HintKey keys="esc" label={t(locale, 'palette.back')} />
              </div>
            </>
          )
        })() : (
          <>
            <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
              <Search className="ico" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0) }}
                placeholder={t(locale, 'palette.globalPlaceholder')}
              />
            </div>
            {controllerState?.error && (
              <div className="px-3.5 py-1.5 text-[12px]" style={{ color: 'var(--color-error)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                {controllerState.error}
              </div>
            )}
            <div className="global-launcher-body l-list" onMouseMove={() => { isKeyboardNavRef.current = false }}>
              <LauncherList
                items={visibleFiltered}
                selected={selectedItem}
                locale={locale}
                onSelect={(item) => selectItem(item)}
                onHoverIndex={(index) => { if (!isKeyboardNavRef.current) setSelectedIndex(index) }}
              />
            </div>
            <div className="global-launcher-footer l-foot">
              <HintKey keys="↑↓" label={t(locale, 'palette.select')} />
              <HintKey keys="↵" label={t(locale, 'palette.confirm')} />
              {selectedItem?.kind === 'domain' && supportsParamCustomization(selectedItem.domainItem) && (
                <HintKey keys={`${getPlatformShortcutMeta().label}↵`} label={t(locale, 'palette.customizeParamsLabel')} />
              )}
              {isWorkflowObjectLauncherItem(selectedItem) && (
                <HintKey keys="tab" label={t(locale, 'palette.select')} />
              )}
              <HintKey keys="esc" label={t(locale, 'palette.back')} />
            </div>
          </>
        )}
      </LauncherView>
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

function isWorkflowObjectLauncherItem(item?: LauncherItem): boolean {
  return item?.kind === 'domain' && item.domainItem.systemKey.startsWith('workflow:object:')
}

function isAppIconRef(icon?: string): boolean {
  return icon?.startsWith('app-icon:') === true
}

function LauncherList({
  items,
  selected,
  locale,
  onSelect,
  onHoverIndex,
}: {
  items: LauncherItem[]
  selected?: LauncherItem
  locale: Locale
  onSelect: (item: LauncherItem) => void
  onHoverIndex?: (index: number) => void
}) {
  if (items.length === 0) return null
  return (
    <>
      {items.map((item, index) => {
        const isSelected = selected?.kind === item.kind && selected.id === item.id
        return (
          <LauncherListItem
            key={`${item.kind}:${item.id}`}
            item={item}
            selected={isSelected}
            locale={locale}
            onSelect={onSelect}
            onMouseEnter={() => onHoverIndex && onHoverIndex(index)}
          />
        )
      })}
    </>
  )
}

const LauncherListItem = memo(function LauncherListItem({
  item,
  selected,
  locale,
  onSelect,
  onMouseEnter,
}: {
  item: LauncherItem
  selected: boolean
  locale: Locale
  onSelect: (item: LauncherItem) => void
  onMouseEnter?: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const appIcon = isAppIconRef(item.icon)
  const tag = getLauncherItemKindLabel(item, locale)

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <button
      ref={ref}
      className={`l-row cmd-item w-full border-none text-left ${selected ? 'sel selected' : ''}`}
      onClick={() => onSelect(item)}
      onMouseEnter={onMouseEnter}
    >
      <span
        className={appIcon ? 'r-app' : 'r-ico'}
      >
        {appIcon ? (
          <span className="app-icon">
            {item.kind === 'domain'
              ? resolveIcon(item.icon, 16, item.title)
              : (resolveIcon(item.icon, 16, item.title) || <Pin size={16} />)}
          </span>
        ) : (
          item.kind === 'domain'
            ? resolveIcon(item.icon, 16, item.title)
            : (resolveIcon(item.icon, 16, item.title) || <Pin size={16} />)
        )}
      </span>

      <div
        className="r-main"
      >
        <span className="r-title launcher-item-title">
          {item.title}
        </span>
        {item.subtitle && (
          <span className="r-desc">{item.subtitle}</span>
        )}
      </div>
      <span className="r-tag launcher-kind-tag">
        {tag}
      </span>
      {selected && <span className="r-kbd">↵</span>}
    </button>
  )
})

function getLauncherItemKindLabel(item: LauncherItem, locale: Locale) {
  if (item.kind === 'pinned') return t(locale, 'palette.kindPinned')
  if (isAppIconRef(item.icon)) return t(locale, 'palette.kindApp')
  return t(locale, 'palette.kindCommand')
}

function ResultChoiceRow({
  choice,
  index,
  selected,
  checked = false,
  disabled = false,
  multi = false,
  onHover,
  onSelect,
}: {
  choice: LauncherResultChoice
  index: number
  selected: boolean
  checked?: boolean
  disabled?: boolean
  multi?: boolean
  onHover?: () => void
  onSelect: () => void
}) {
  const bodyText = choice.preview ?? choice.title
  const longResult = isLongResultText(bodyText)
  const className = `global-launcher-result-row ${longResult ? 'l-result-block' : 'l-result'} ${selected ? 'sel is-selected' : ''} ${disabled ? 'disabled' : ''}`
  return (
    <button
      className={className}
      onMouseEnter={onHover}
      onClick={onSelect}
      disabled={disabled}
    >
      {multi ? (
        <span className={`check ${checked ? 'on' : ''}`}>{checked ? '✓' : ''}</span>
      ) : (
        <span className="ri">{index === 0 ? '=' : '#'}</span>
      )}
      <span className={longResult ? 'block-main' : 'rtext'}>{bodyText}</span>
      {!longResult && choice.subtitle && (
        <span className="rkind">{choice.subtitle}</span>
      )}
      {!multi && <span className="rkbd">↵</span>}
    </button>
  )
}

function isLongResultText(text: string): boolean {
  return text.includes('\n') || text.length > 88
}

function HintKey({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="grp">
      <kbd>{keys}</kbd>
      {label}
    </span>
  )
}

function HintText({ label }: { label: string }) {
  return (
    <span className="grp primary">
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
    aliases: item.aliases,
    usageKey: launcherItemUsageKey(item),
  }
}

function launcherItemSearchId(item: LauncherItem): string {
  if (item.kind === 'pinned') return item.actionId
  return item.id
}

function launcherItemUsageKey(item: LauncherItem): string {
  if (item.kind === 'pinned') return item.actionId
  return item.id
}

function HostSurfaceView({ target }: { target: LauncherHostSurfaceTarget }) {
  return (
    <div className="global-launcher-body" style={{ height: STANDALONE_SURFACE_MAX_HEIGHT, maxHeight: STANDALONE_SURFACE_MAX_HEIGHT, overflow: 'hidden' }}>
      <Suspense fallback={<div className="view-loading" />}>
        {target === 'settings' ? <SettingsSurfaceView /> : <ScriptsSurfaceView />}
      </Suspense>
    </div>
  )
}

function samePluginSurfaceTarget(
  a: PluginSurfaceOpenTarget,
  b: PluginSurfaceOpenTarget,
): boolean {
  return a.source === b.source && a.pluginId === b.pluginId && a.surfaceId === b.surfaceId
}
