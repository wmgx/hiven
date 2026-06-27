import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { localized, useAppStore, type LauncherHostSurfaceId, type PluginSurfaceOpenTarget } from '../store'
import { t, type Locale } from '../i18n'
import { pluginRegistry, usePluginRegistryVersion } from '../workspace/pluginRegistry'
import { usePluginSettingsStore } from '../workspace/pluginSettingsStore'
import type { CollectInputFrame, ParamInputFrame, ResultFrame } from '../workspace/launcher/controller'
import type { LauncherItem as DomainLauncherItem } from '../workspace/launcher/types'
import { PluginSettingsContent } from './PluginSettingsDialog'
import { shouldCustomizeParams, supportsDefaultParamRun } from './launcher/launcherParamShortcuts'
import type { PluginPermission } from '../workspace/pluginTypes'
import { getPluginPermissionSnapshot, missingPluginPermissions, usePluginPermissionStore } from '../workspace/pluginPermissions'
import { restartPluginBackground } from '../workspace/pluginBackgroundManager'
import type { PluginSettingsSource } from '../workspace/pluginSettingsStore'
import { LAUNCHER_PROGRAMMATIC_MOVE_EVENT } from '../workspace/launcherWindowEvents'
import { PluginSurfacePermissionGate, PluginSurfaceRenderer } from './pluginSurface/PluginSurfaceRenderer'
import { resolvePluginSurface } from './pluginSurface/pluginSurfaceResolver'
import type { LauncherHostConfig } from '../launcher/LauncherHostConfig'
import { useLauncherSession } from '../launcher/useLauncherSession'
import {
  CollectInputStep as SharedCollectInputStep,
  LauncherParamStep as SharedLauncherParamStep,
  LauncherSearch,
  LauncherShell,
  ResultStep as SharedResultStep,
} from '../launcher/ui'

const ScriptsView = lazy(() => import('../views/ScriptsView').then(m => ({ default: m.ScriptsView })))
const PluginEditorView = lazy(() => import('../views/PluginEditorView').then(m => ({ default: m.PluginEditorView })))
const SettingsView = lazy(() => import('../views/SettingsView').then(m => ({ default: m.SettingsView })))

const GLOBAL_LAUNCHER_PANEL_WIDTH = 760
const STANDALONE_LAUNCHER_WIDTH = 808
const STANDALONE_LAUNCHER_MIN_HEIGHT = 334
const STANDALONE_LAUNCHER_MAX_HEIGHT = 430
const STANDALONE_SURFACE_MAX_WIDTH = 920
const STANDALONE_SURFACE_MAX_HEIGHT = 760
const STANDALONE_LAUNCHER_VERTICAL_PADDING = 24
const STANDALONE_LAUNCHER_HORIZONTAL_PADDING = 24
const STANDALONE_LAUNCHER_LIST_MAX_HEIGHT = 340
const GLOBAL_LAUNCHER_SETTINGS_WIDTH = 720
const GLOBAL_LAUNCHER_SETTINGS_HEIGHT = 560
const GLOBAL_LAUNCHER_HOST_SURFACE_WIDTH = 1040
const GLOBAL_LAUNCHER_HOST_SURFACE_HEIGHT = 720
const PLUGIN_SURFACE_BACK_EVENT = 'hiven:plugin-surface-back'
const PLUGIN_SURFACE_CLOSE_EVENT = 'hiven:plugin-surface-close'

const GLOBAL_LAUNCHER_HOST_CONFIG: LauncherHostConfig = {
  hostId: 'global-launcher',
  capabilities: ['global-search', 'plugin-surfaces', 'pinned-actions', 'collect-input', 'param-input', 'result-choice'],
  presentation: {
    shellClassName: 'global-launcher-panel overflow-hidden outline-none palette-panel',
    panelClassName: 'global-launcher-panel overflow-hidden outline-none palette-panel',
    overlayZIndex: 1100,
    topOffset: 54,
  },
  closeBehavior: {
    restoreFocus: true,
    requestClose: () => {},
  },
}

export function GlobalLauncher() {
  const open = useAppStore((s) => s.globalLauncherOpen)
  const mode = useAppStore((s) => s.globalLauncherMode)
  const overlay = useAppStore((s) => s.globalLauncherOverlay)
  const setOpen = useAppStore((s) => s.setGlobalLauncherOpen)
  const openPinnedAction = useAppStore((s) => s.openPinnedAction)
  const pinnedActions = useAppStore((s) => s.pinnedActions)
  const launcherHostSurface = useAppStore((s) => s.launcherHostSurface)
  const closeLauncherHostSurface = useAppStore((s) => s.closeLauncherHostSurface)
  const locale = useAppStore((s) => s.locale)
  const pluginRegistryVersion = usePluginRegistryVersion()
  const grantPluginPermissions = usePluginPermissionStore((s) => s.grantPermissions)
  const launcherUsageBySurface = useAppStore((s) => s.launcherUsageBySurface)
  const recordLauncherSelection = useAppStore((s) => s.recordLauncherSelection)
  const pluginSurfaceToolTarget = useAppStore((s) => s.pluginSurfaceToolTarget)
  const clearPluginSurfaceTool = useAppStore((s) => s.clearPluginSurfaceTool)
  const settingsDialogTarget = usePluginSettingsStore((s) => s.settingsDialogTarget)
  const closeSettingsDialog = usePluginSettingsStore((s) => s.closeSettingsDialog)
  const closeAfterActionRef = useRef<() => void>(() => {})
  const sessionRef = useRef<ReturnType<typeof useLauncherSession> | null>(null)
  const [surfaceFrame, setSurfaceFrame] = useState<{ source: PluginSettingsSource; pluginId: string; surfaceId: string } | null>(null)
  const [itemPermissionFrame, setItemPermissionFrame] = useState<{
    item: DomainLauncherItem
    source: PluginSettingsSource
    pluginId: string
    permissions: PluginPermission[]
    customizeParams: boolean
  } | null>(null)
  const [surfaceFocusVersion, setSurfaceFocusVersion] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const standaloneLauncher = isStandaloneLauncherWindow()
  const launcherSettingsTarget = settingsDialogTarget?.presentation === 'global-launcher'
    ? settingsDialogTarget
    : null

  const hostConfig = useMemo<LauncherHostConfig>(() => ({
    ...GLOBAL_LAUNCHER_HOST_CONFIG,
    closeBehavior: {
      ...GLOBAL_LAUNCHER_HOST_CONFIG.closeBehavior,
      requestClose: () => closeAfterActionRef.current(),
    },
  }), [])

  const session = useLauncherSession({
    open,
    hostConfig,
    locale,
    launcherUsageBySurface,
    pluginRegistryVersion,
    recordSelection: recordLauncherSelection,
    collectForEmptyQuery: true,
  })
  useEffect(() => {
    sessionRef.current = session
  }, [session])

  const {
    controllerRef,
    controllerState,
    inControllerFrame,
    inputRef,
    isKeyboardNavRef,
    query,
    rankedLauncherItems,
    selectedIndex,
    selectedItem: sessionSelectedItem,
    setSearchQuery,
    setSelectedIndex,
    topFrame,
  } = session

  const openPluginSurface = useCallback((target: { source: PluginSettingsSource; pluginId: string; surfaceId: string }) => {
    setSurfaceFrame(target)
    setSurfaceFocusVersion((version) => version + 1)
  }, [])

  useEffect(() => {
    if (open) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setSurfaceFrame(null)
      setItemPermissionFrame(null)
    })
    return () => { cancelled = true }
  }, [open])

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
    return resolvePluginSurface(surfaceFrame)
  }, [surfaceFrame, pluginRegistryVersion])

  const pinnedLauncherItems = useMemo<DomainLauncherItem[]>(() => {
    const pinnedLabel = t(locale, 'palette.globalPinned')
    return pinnedActions.map((item) => ({
      systemKey: `pinned:${item.id}`,
      kind: 'host',
      display: {
        title: localized(item.title, item.titleI18n, locale),
        subtitle: pinnedLabel,
        icon: item.icon,
        aliases: [item.actionId],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      pinnable: false,
      execute: async () => {
        if (standaloneLauncher && (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
          const { emitTo } = await import('@tauri-apps/api/event')
          await emitTo('main', 'hiven://run-pinned-action', { id: item.id })
        } else {
          openPinnedAction(item.id)
        }
        return { ok: true }
      },
    }))
  }, [locale, openPinnedAction, pinnedActions, standaloneLauncher])

  const visibleLauncherItems = useMemo(() => {
    if (mode !== 'pinned-only') return rankedLauncherItems
    const q = query.trim().toLowerCase()
    if (!q) return pinnedLauncherItems
    return pinnedLauncherItems.filter((item) => [
      item.systemKey,
      item.display.title,
      item.display.subtitle,
      ...(item.display.aliases ?? []),
    ].some((value) => value?.toLowerCase().includes(q)))
  }, [mode, pinnedLauncherItems, query, rankedLauncherItems])
  const selectedLauncherItem = mode === 'pinned-only'
    ? (visibleLauncherItems.length === 1
      ? visibleLauncherItems[0]
      : visibleLauncherItems[Math.min(selectedIndex, Math.max(0, visibleLauncherItems.length - 1))])
    : sessionSelectedItem

  const resetLauncherSession = useCallback(() => {
    clearPluginSurfaceTool()
    closeLauncherHostSurface()
    setSurfaceFrame(null)
    setItemPermissionFrame(null)
    if (usePluginSettingsStore.getState().settingsDialogTarget?.presentation === 'global-launcher') {
      closeSettingsDialog()
    }
    sessionRef.current?.resetSession()
  }, [clearPluginSurfaceTool, closeLauncherHostSurface, closeSettingsDialog])

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
        sessionRef.current?.restoreFocus()
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
        sessionRef.current?.restoreFocus()
      })()
      return
    }
    setOpen(false)
    sessionRef.current?.restoreFocus()
  }, [overlay, resetLauncherSession, setOpen, standaloneLauncher])

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
        sessionRef.current?.restoreFocus()
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
        sessionRef.current?.restoreFocus()
      })()
      return
    }
    setOpen(false)
    sessionRef.current?.restoreFocus()
  }, [overlay, resetLauncherSession, setOpen, standaloneLauncher])

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

  const focusSearchInputAfterBack = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [inputRef])

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
  }, [controllerRef, controllerState, open])

  useLayoutEffect(() => {
    if (!open || !standaloneLauncher) return
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return

    const timer = window.setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      const surfaceShell = activeSurfaceFrame?.surface.shell
      const desiredPanelHeight = launcherSettingsTarget
        ? GLOBAL_LAUNCHER_SETTINGS_HEIGHT
        : surfaceShell?.defaultHeight
        ? surfaceShell.defaultHeight
        : measureStandaloneLauncherPanelHeight(panel)
      const nextHeight = clamp(
        Math.ceil(desiredPanelHeight + STANDALONE_LAUNCHER_VERTICAL_PADDING),
        STANDALONE_LAUNCHER_MIN_HEIGHT,
        surfaceShell || launcherSettingsTarget ? STANDALONE_SURFACE_MAX_HEIGHT : STANDALONE_LAUNCHER_MAX_HEIGHT,
      )
      const desiredPanelWidth = launcherSettingsTarget
        ? GLOBAL_LAUNCHER_SETTINGS_WIDTH
        : surfaceShell?.defaultWidth ?? GLOBAL_LAUNCHER_PANEL_WIDTH
      const nextWidth = clamp(
        Math.ceil(desiredPanelWidth + STANDALONE_LAUNCHER_HORIZONTAL_PADDING),
        STANDALONE_LAUNCHER_WIDTH,
        surfaceShell || launcherSettingsTarget ? STANDALONE_SURFACE_MAX_WIDTH : STANDALONE_LAUNCHER_WIDTH,
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
    visibleLauncherItems.length,
    mode,
    open,
    controllerState,
    standaloneLauncher,
    activeSurfaceFrame,
    launcherSettingsTarget,
  ])

  const selectItem = (item: DomainLauncherItem | undefined, customizeParams = false) => {
    if (!item) return

    // Intercept plugin surface items — render surface instead of execute
    if (item.systemKey.startsWith('plugin-surface:')) {
      const parts = item.systemKey.split(':')
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

    const missingPermissions = missingPluginItemPermissions(item)
    if (missingPermissions.length > 0 && item.pluginId && item.source) {
      setItemPermissionFrame({
        item,
        source: item.source,
        pluginId: item.pluginId,
        permissions: missingPermissions,
        customizeParams,
      })
      return
    }

    executeDomainItem(item, customizeParams)
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

  const cancelItemPermissionPrompt = useCallback(() => {
    setItemPermissionFrame(null)
    focusSearchInputAfterBack()
  }, [focusSearchInputAfterBack])

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

  const handleHostEscape = useCallback((event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    if (sessionRef.current?.shouldIgnoreKeyDown(event)) return
    if (event.key === 'Escape' && launcherSettingsTarget) {
      event.preventDefault()
      event.stopPropagation()
      closeSettingsDialog()
      focusSearchInputAfterBack()
      return
    }
    if (event.key === 'Escape' && launcherHostSurface) {
      event.preventDefault()
      event.stopPropagation()
      closeLauncherHostSurface()
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

    if (itemPermissionFrame) {
      cancelItemPermissionPrompt()
      return
    }

    if (controllerRef.current?.back()) {
      focusSearchInputAfterBack()
      return
    }

    closeLauncher()
  }, [cancelItemPermissionPrompt, closeLauncher, closeLauncherHostSurface, closeSettingsDialog, controllerRef, focusSearchInputAfterBack, itemPermissionFrame, launcherHostSurface, launcherSettingsTarget, leaveSurface, settingsDialogTarget, surfaceFrame])

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
    '--launcher-panel-width': launcherSettingsTarget
      ? `${GLOBAL_LAUNCHER_SETTINGS_WIDTH}px`
      : launcherHostSurface
      ? `${GLOBAL_LAUNCHER_HOST_SURFACE_WIDTH}px`
      : activeSurfaceFrame?.surface.shell?.defaultWidth
      ? `${activeSurfaceFrame.surface.shell.defaultWidth}px`
      : `${GLOBAL_LAUNCHER_PANEL_WIDTH}px`,
    width: launcherSettingsTarget
      ? `min(${GLOBAL_LAUNCHER_SETTINGS_WIDTH}px, calc(100vw - 24px))`
      : launcherHostSurface
      ? `min(${GLOBAL_LAUNCHER_HOST_SURFACE_WIDTH}px, calc(100vw - 24px))`
      : activeSurfaceFrame?.surface.shell?.defaultWidth
      ? `min(${activeSurfaceFrame.surface.shell.defaultWidth}px, calc(100vw - 24px))`
      : undefined,
    maxHeight: launcherSettingsTarget
      ? `min(${GLOBAL_LAUNCHER_SETTINGS_HEIGHT}px, calc(100vh - 24px))`
      : launcherHostSurface
      ? `min(${GLOBAL_LAUNCHER_HOST_SURFACE_HEIGHT}px, calc(100vh - 24px))`
      : activeSurfaceFrame?.surface.shell?.defaultHeight
      ? `min(${activeSurfaceFrame.surface.shell.defaultHeight}px, calc(100vh - 24px))`
      : undefined,
    left: '50%',
    top: standaloneLauncher ? 12 : 54,
    transform: 'translateX(-50%)',
  }

  useLayoutEffect(() => {
    if (!surfaceFrame && !launcherSettingsTarget && !launcherHostSurface) return
    const frame = window.requestAnimationFrame(() => {
      const shell = panelRef.current?.querySelector<HTMLElement>('.global-launcher-surface-shell, .global-launcher-settings-shell, .global-launcher-host-surface-shell')
      const focusTarget =
        shell?.querySelector<HTMLElement>('[data-plugin-surface-autofocus]') ??
        shell
      focusTarget?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [launcherHostSurface, launcherSettingsTarget, surfaceFrame, surfaceFocusVersion])

  if (!open) return null

  return (
    <LauncherShell
      open={open}
      overlayClassName="fixed inset-0 palette-overlay global-launcher-overlay open"
      style={{ pointerEvents: 'auto', visibility: 'visible', zIndex: 1100 }}
      panelRef={panelRef}
      panelClassName={hostConfig.presentation.panelClassName}
      panelStyle={panelStyle}
      onOverlayClick={(event) => { if (event.target === event.currentTarget) closeLauncher() }}
      onPointerDown={beginDrag}
      onContextMenu={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest('input, textarea')) return
        event.preventDefault()
      }}
      onCompositionStart={session.handleCompositionStart}
      onCompositionEnd={session.handleCompositionEnd}
      onKeyDown={(event) => {
        if (session.shouldIgnoreKeyDown(event.nativeEvent)) return
        if (event.defaultPrevented) return
        if (event.key === 'Escape' && launcherSettingsTarget) {
          event.preventDefault()
          event.stopPropagation()
          closeSettingsDialog()
          focusSearchInputAfterBack()
          return
        }
        if (launcherSettingsTarget) return
        if (launcherHostSurface) {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeLauncherHostSurface()
            focusSearchInputAfterBack()
          }
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
        if (inControllerFrame) return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          closeLauncher()
          return
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          isKeyboardNavRef.current = true
          setSelectedIndex((index) => Math.min(index + 1, Math.max(0, visibleLauncherItems.length - 1)))
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          isKeyboardNavRef.current = true
          setSelectedIndex((index) => Math.max(index - 1, 0))
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          selectItem(selectedLauncherItem, shouldCustomizeParams(event.metaKey, event.ctrlKey))
        }
      }}
    >
        {launcherSettingsTarget ? (
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
        ) : launcherHostSurface ? (
          <LauncherHostSurface
            surface={launcherHostSurface}
            locale={locale}
            onBack={() => {
              closeLauncherHostSurface()
              focusSearchInputAfterBack()
            }}
          />
        ) : surfaceFrame ? (() => {
          if (!activeSurfaceFrame) {
            return <div className="p-4 text-center text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>Surface not found</div>
          }
          const { surface } = activeSurfaceFrame
          const shellHeight = surface.shell?.defaultHeight ?? 480
          return (
            <PluginSurfaceRenderer
              target={surfaceFrame}
              locale={locale}
              className="global-launcher-surface-shell flex flex-col min-h-0 outline-none"
              style={{ height: shellHeight }}
              bodyClassName="global-launcher-body"
              bodyStyle={{ maxHeight: shellHeight, height: shellHeight, overflow: 'hidden' }}
              onBack={requestSurfaceBack}
              onClose={requestSurfaceClose}
              onOpenSettings={() => {
                usePluginSettingsStore.getState().openSettingsDialog({
                  pluginId: surfaceFrame.pluginId,
                  source: surfaceFrame.source,
                  presentation: 'global-launcher',
                  context: { surfaceId: 'global-launcher' },
                })
              }}
            />
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
        ) : topFrame?.kind === 'param-input' ? (
          <SharedLauncherParamStep
            frame={topFrame as ParamInputFrame}
            error={controllerState?.error ?? null}
            busy={controllerState?.busy ?? false}
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
        ) : topFrame?.kind === 'collect-input' ? (
          <SharedCollectInputStep
            frame={topFrame as CollectInputFrame}
            error={controllerState?.error ?? null}
            busy={controllerState?.busy ?? false}
            onInputChange={(text) => controllerRef.current?.setInputText(text)}
            onSubmit={() => controllerRef.current?.submitInput()}
            onBack={() => {
              controllerRef.current?.back()
              focusSearchInputAfterBack()
            }}
            locale={locale}
          />
        ) : topFrame?.kind === 'result' ? (
          <SharedResultStep
            frame={topFrame as ResultFrame}
            error={controllerState?.error ?? null}
            busy={controllerState?.busy ?? false}
            onActivateChoice={(choice) => controllerRef.current?.activateChoice(choice)}
            onActivateSecondary={(choice, actionId) => controllerRef.current?.activateSecondary(choice, actionId)}
            onSubmitSelection={(choices) => controllerRef.current?.submitResultSelection(choices)}
            onBack={() => {
              controllerRef.current?.back()
              focusSearchInputAfterBack()
            }}
            locale={locale}
          />
        ) : (
          <LauncherSearch
            inputRef={inputRef}
            query={query}
            setQuery={setSearchQuery}
            items={visibleLauncherItems}
            selectedIndex={selectedIndex}
            selectItem={selectItem}
            setSelectedIndex={setSelectedIndex}
            isKeyboardNavigation={() => isKeyboardNavRef.current}
            onMouseNavigation={() => { isKeyboardNavRef.current = false }}
            locale={locale}
            error={controllerState?.error ?? null}
            busy={controllerState?.busy ?? false}
          />
        )}
    </LauncherShell>
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

function LauncherHostSurface({
  surface,
  locale,
  onBack,
}: {
  surface: LauncherHostSurfaceId
  locale: Locale
  onBack: () => void
}) {
  const title =
    surface === 'settings'
      ? t(locale, 'settings.title')
      : surface === 'plugins'
        ? t(locale, 'scripts.title')
        : t(locale, 'pluginEditor.title')

  return (
    <div
      className="global-launcher-host-surface-shell flex flex-col min-h-0 outline-none"
      tabIndex={-1}
      style={{ height: GLOBAL_LAUNCHER_HOST_SURFACE_HEIGHT }}
    >
      <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
        <button className="back" type="button" onClick={onBack}>‹</button>
        <span className="title">{title}</span>
      </div>
      <div className="global-launcher-body min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<div className="view-loading" />}>
          {surface === 'settings' && <SettingsView />}
          {surface === 'plugins' && <ScriptsView />}
          {surface === 'plugin-editor' && <PluginEditorView />}
        </Suspense>
      </div>
    </div>
  )
}

function samePluginSurfaceTarget(
  a: PluginSurfaceOpenTarget,
  b: PluginSurfaceOpenTarget,
): boolean {
  return a.source === b.source && a.pluginId === b.pluginId && a.surfaceId === b.surfaceId
}
