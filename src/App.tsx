import { useEffect, useRef } from 'react'
import { useAppStore } from './store'
import type { GlobalLauncherPosition } from './store'
import { initConfigDir } from './configInit'
import { GlobalLauncher } from './components/GlobalLauncher'
import { PluginSettingsDialog } from './components/PluginSettingsDialog'
import { ToastContainer } from './components/workspace/ToastContainer'
import { loadInstalledPluginsFromStore } from './workspace/pluginRuntime'
import { registerBundledPluginPackages } from './workspace/bundledPluginLoader'
import { initializePluginBackgrounds, setupBackgroundPermissionWatcher, setupBackgroundSettingsWatcher, stopAllPluginBackgrounds } from './workspace/pluginBackgroundManager'
import { runPluginStartupHooks, setupStartupPermissionWatcher } from './workspace/pluginHookManager'
import { refreshHostApplicationIndexOnStartup } from './workspace/appLauncher/hostAppLauncher'
import { prefetchDesktopWindowsOnStartup } from './workspace/desktopControl/windows'
import { registerHostLauncherProviders } from './workspace/launcher/hostProvider'
import { installGlobalPinnedLauncherHotkeys, routeGlobalPinnedLauncherShortcut } from './hotkeys/globalPinnedLauncher'
import { installPluginSurfaceShortcutHotkeys } from './hotkeys/pluginSurfaceShortcuts'
import { installAppHotkeys } from './hotkeys/appHotkeys'
import { installQuickEditorHotkeys } from './hotkeys/quickEditor'
import { consumePendingPluginSurfaceOpenTarget, isPluginSurfaceOpenTarget, openLauncherHostedPluginSurface } from './workspace/pluginSurfaceOpenRequest'
import { LAUNCHER_HOST_SURFACE_OPEN_EVENT, consumePendingLauncherHostSurfaceOpen, isLauncherHostSurfaceOpenRequest, isLauncherHostSurfaceTarget, openLauncherHostSurfaceLocally, openLauncherHostSurfaceRequestLocally } from './workspace/launcherHostSurfaceBridge'
import { LAUNCHER_PROGRAMMATIC_MOVE_EVENT } from './workspace/launcherWindowEvents'
import { onCurrentLauncherWindowMoved, setCurrentLauncherWindowPosition, type LauncherWindowMovedPosition } from './workspace/windowManager/launcherWindow'
import {
  beginLauncherPerfOpenSession,
  launcherPerfNow,
  logLauncherPerfDuration,
} from './workspace/launcher/perf'
import { startClipboardAgeTracker } from './launcher/clipboard/clipboardSnapshot'
import { startLearningObserver } from './workspace/learning/observer'
import { startPureTransformRunnerSync } from './workspace/learning/registryRunners'
import { startNavigationSensor } from './workspace/learning/navigationSensor'
import { installLearningDebugHook } from './workspace/learning/learningController'
import { refreshLearnedUrlRules } from './workspace/learning/fire'

// Register built-in panels
import './panels/register'

/** Lightweight text-only read for age tracking (avoid file-path IPC every tick). */
async function readClipboardTextForAgeTracker(): Promise<string> {
  try {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
    return (await readText()) ?? ''
  } catch {
    try {
      return await navigator.clipboard.readText()
    } catch {
      return ''
    }
  }
}

// Register first-party product plugin packages
registerHostLauncherProviders()
registerBundledPluginPackages()

export default function App() {
  return <LauncherRuntimeApp />
}

function LauncherRuntimeApp() {
  const fontSize = useAppStore((s) => s.settings.fontSize)
  const theme = useAppStore((s) => s.settings.theme)
  const launcherWindowPosition = useAppStore((s) => s.settings.globalLauncherWindowPosition)
  const launcherProgrammaticMoveRef = useRef(false)
  const launcherProgrammaticMoveResetRef = useRef<number | undefined>(undefined)

  const suppressNextLauncherMovePersistence = () => {
    launcherProgrammaticMoveRef.current = true
    if (launcherProgrammaticMoveResetRef.current !== undefined) {
      window.clearTimeout(launcherProgrammaticMoveResetRef.current)
    }
    launcherProgrammaticMoveResetRef.current = window.setTimeout(() => {
      launcherProgrammaticMoveRef.current = false
      launcherProgrammaticMoveResetRef.current = undefined
    }, 600)
  }

  useEffect(() => {
    let disposed = false
    let cleanupSettingsWatcher: (() => void) | undefined
    let cleanupPermissionWatcher: (() => void) | undefined
    let cleanupStartupPermissionWatcher: (() => void) | undefined

    initConfigDir().then(async (dir) => {
      if (dir) {
        const pluginDir = `${dir}/plugins/installed`
        const current = useAppStore.getState().settings.watchDirectory
        if (
          current === '~/FluxText/actions' ||
          current === '~/.local/fluxtext/scripts' ||
          current === '~/.local/hiven/scripts'
        ) {
          useAppStore.getState().updateSetting('watchDirectory', pluginDir)
        }
      }
      if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
        try {
          await loadInstalledPluginsFromStore()
        } catch (error) {
          console.error('[hiven] Failed to load plugins:', error)
        }
      }

      if (disposed) return
      refreshHostApplicationIndexOnStartup()
      // Warm on-screen window list in idle time so first Global Launcher open is snappy.
      prefetchDesktopWindowsOnStartup()
      runPluginStartupHooks()
      cleanupStartupPermissionWatcher = setupStartupPermissionWatcher()
      try {
        initializePluginBackgrounds()
        cleanupSettingsWatcher = setupBackgroundSettingsWatcher()
        cleanupPermissionWatcher = setupBackgroundPermissionWatcher()
      } catch (error) {
        console.error('[hiven] Failed to initialize plugin backgrounds:', error)
      }
    })

    return () => {
      disposed = true
      cleanupSettingsWatcher?.()
      cleanupPermissionWatcher?.()
      cleanupStartupPermissionWatcher?.()
      void stopAllPluginBackgrounds()
    }
  }, [])

  useEffect(() => () => {
    if (launcherProgrammaticMoveResetRef.current !== undefined) {
      window.clearTimeout(launcherProgrammaticMoveResetRef.current)
    }
  }, [])

  useEffect(() => {
    const suppressProgrammaticMove = () => suppressNextLauncherMovePersistence()
    window.addEventListener(LAUNCHER_PROGRAMMATIC_MOVE_EVENT, suppressProgrammaticMove)
    return () => window.removeEventListener(LAUNCHER_PROGRAMMATIC_MOVE_EVENT, suppressProgrammaticMove)
  }, [])

  useEffect(() => installGlobalPinnedLauncherHotkeys(), [])
  useEffect(() => installPluginSurfaceShortcutHotkeys(), [])
  useEffect(() => installAppHotkeys(), [])
  useEffect(() => installQuickEditorHotkeys(), [])

  // Background clipboard age clock: first see = unknown baseline; real changes get known changedAt.
  // Prevents Global Launcher open from treating long-sitting clipboard as "just copied".
  useEffect(() => {
    const stopTracker = startClipboardAgeTracker(readClipboardTextForAgeTracker)
    const stopRunnerSync = startPureTransformRunnerSync()
    const stopObserver = startLearningObserver()
    const stopNavSensor = startNavigationSensor()
    // Load learned url-template rules into memory for reverse-fire (typed id → open).
    void refreshLearnedUrlRules()
    // Devtools verification hook (window.__hivenLearning) — no user-facing UI yet.
    installLearningDebugHook()
    return () => {
      stopNavSensor()
      stopObserver()
      stopRunnerSync()
      stopTracker()
    }
  }, [])

  useEffect(() => {
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    let disposed = false
    import('@tauri-apps/api/app')
      .then(async ({ setTheme }) => {
        if (disposed) return
        await setTheme(theme)
      })
      .catch((error) => {
        console.warn('[hiven] Failed to sync native window theme:', error)
      })
    return () => {
      disposed = true
    }
  }, [theme])

  useEffect(() => {
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    let disposed = false
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('hiven://route-global-pinned-launcher-shortcut', () => {
        void routeGlobalPinnedLauncherShortcut()
      }))
      .then((cleanup) => {
        if (disposed) cleanup()
        else unlisten = cleanup
      })
      .catch((error) => {
        console.warn('[hiven] Failed to listen for global launcher route event:', error)
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    const openLauncher = () => {
      const eventReceivedAt = launcherPerfNow()
      // Correlates all frontend samples for this open in launcher-perf.ndjson.
      beginLauncherPerfOpenSession({ trigger: 'hiven://launcher-open' })
      ;(window as unknown as { __hivenLauncherOpenT0?: number }).__hivenLauncherOpenT0 = eventReceivedAt
      // Open the store *synchronously*. Awaiting rehydrate first left the panel
      // visible with no mounted search input, so native first-responder could not
      // land on a real caret until the user clicked.
      const pendingHostSurfaceTarget = consumePendingLauncherHostSurfaceOpen()
      if (pendingHostSurfaceTarget) {
        openLauncherHostSurfaceRequestLocally(pendingHostSurfaceTarget)
      } else {
        const pendingSurfaceTarget = consumePendingPluginSurfaceOpenTarget()
        if (pendingSurfaceTarget) {
          openLauncherHostedPluginSurface(pendingSurfaceTarget)
        } else {
          useAppStore.getState().openGlobalLauncherOverlay()
        }
      }
      logLauncherPerfDuration('open:event-to-store-open', eventReceivedAt)

      void (async () => {
        // Throttle rehydrate: full persist.rehydrate() mid-open can re-render the
        // panel during first paint (p50 ~24ms, sometimes 70ms+). Settings rarely
        // change between rapid open/close; position restore still uses live store.
        const rehydrateStartedAt = launcherPerfNow()
        const didRehydrate = await rehydratePersistedAppState()
        logLauncherPerfDuration('open:rehydrate', rehydrateStartedAt, {
          skipped: !didRehydrate,
        })
        if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
        const settings = useAppStore.getState().settings
        const saved = settings.globalLauncherWindowPositionSource === 'user'
          ? settings.globalLauncherWindowPosition
          : undefined
        if (!saved || !isLauncherPositionFresh(saved)) return
        try {
          suppressNextLauncherMovePersistence()
          await setCurrentLauncherWindowPosition({ x: saved.x, y: saved.y })
        } catch (error) {
          console.warn('[hiven] Failed to restore launcher window position:', error)
        }
      })()
    }
    openLauncher()

    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    let disposed = false
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('hiven://launcher-open', openLauncher))
      .then((cleanup) => {
        if (disposed) cleanup()
        else unlisten = cleanup
      })
      .catch((error) => {
        console.warn('[hiven] Failed to listen for launcher open event:', error)
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    let disposed = false
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen(LAUNCHER_HOST_SURFACE_OPEN_EVENT, (event) => {
        if (isLauncherHostSurfaceOpenRequest(event.payload)) {
          openLauncherHostSurfaceRequestLocally(event.payload)
          return
        }
        if (isLauncherHostSurfaceTarget(event.payload)) {
          openLauncherHostSurfaceLocally(event.payload)
        }
      }))
      .then((cleanup) => {
        if (disposed) cleanup()
        else unlisten = cleanup
      })
      .catch((error) => {
        console.warn('[hiven] Failed to listen for launcher host surface open event:', error)
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    let disposed = false
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('hiven://open-plugin-surface', (event) => {
        if (!isPluginSurfaceOpenTarget(event.payload)) return
        openLauncherHostedPluginSurface(event.payload)
      }))
      .then((cleanup) => {
        if (disposed) cleanup()
        else unlisten = cleanup
      })
      .catch((error) => {
        console.warn('[hiven] Failed to listen for plugin surface open event:', error)
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    let disposed = false
    let unlisten: (() => void) | undefined
    let moveThrottleTimer: ReturnType<typeof setTimeout> | undefined
    let lastMovePayload: unknown = null

    onCurrentLauncherWindowMoved(async (position, { toLogical }) => {
      if (launcherProgrammaticMoveRef.current) {
        launcherProgrammaticMoveRef.current = false
        if (launcherProgrammaticMoveResetRef.current !== undefined) {
          window.clearTimeout(launcherProgrammaticMoveResetRef.current)
          launcherProgrammaticMoveResetRef.current = undefined
        }
        return
      }

      lastMovePayload = position
      if (moveThrottleTimer !== undefined) return
      moveThrottleTimer = setTimeout(async () => {
        moveThrottleTimer = undefined
        const pos = lastMovePayload as LauncherWindowMovedPosition | null
        if (!pos) return
        try {
          const logicalPosition = await toLogical(pos)
          useAppStore.getState().updateSetting('globalLauncherWindowPosition', {
            x: logicalPosition.x,
            y: logicalPosition.y,
            lastDraggedAt: Date.now(),
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
          })
          useAppStore.getState().updateSetting('globalLauncherWindowPositionSource', 'user')
        } catch (error) {
          console.warn('[hiven] Failed to persist launcher window position:', error)
        }
      }, 150)
    })
      .then((cleanup) => {
        if (disposed) cleanup()
        else unlisten = cleanup
      })
      .catch((error) => {
        console.warn('[hiven] Failed to listen for launcher movement:', error)
      })
    return () => {
      disposed = true
      unlisten?.()
      if (moveThrottleTimer !== undefined) clearTimeout(moveThrottleTimer)
    }
  }, [])

  useEffect(() => {
    const handleLauncherWheel = (event: WheelEvent) => {
      // Monaco editor manages its own scrolling — never intercept wheel events
      // inside an editor instance (capture-phase stopPropagation would block it).
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('.monaco-editor')) return

      if (shouldAllowLauncherListWheel(event)) {
        event.stopPropagation()
        return
      }
      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener('wheel', handleLauncherWheel, { passive: false, capture: true })
    return () => window.removeEventListener('wheel', handleLauncherWheel, true)
  }, [])

  return (
    <div className="flux-spatial-shell launcher-window-shell" data-theme={theme} data-launcher-position={launcherWindowPosition ? 'stored' : 'default'} style={{ fontSize }}>
      <GlobalLauncher />
      <PluginSettingsDialog />
      <ToastContainer />
    </div>
  )
}

function shouldAllowLauncherListWheel(event: WheelEvent) {
  const target = event.target instanceof Element ? event.target : null
  if (!target) return false

  // Plugin surfaces / data grids own their own 2D scrolling (incl. trackpad pan-x).
  // Do not block deltaX here — that was preventing horizontal table scroll.
  if (
    target.closest(
      '.global-launcher-body--surface, [data-launcher-scrollable], [role="grid"], .rdg, .csv-tools-surface',
    )
  ) {
    return true
  }

  // Result list: only vertical list scroll; ignore primarily-horizontal gestures.
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return false
  return findLauncherWheelScroller(target, event.deltaY, event.deltaX) !== null
}

function findLauncherWheelScroller(
  target: Element | null,
  deltaY: number,
  deltaX = 0,
): HTMLElement | null {
  const launcherBody = target?.closest('.global-launcher-body') as HTMLElement | null
  let candidate = target instanceof HTMLElement ? target : target?.parentElement ?? null
  while (candidate) {
    const isExplicitLauncherScroller = candidate.matches('[data-launcher-scrollable], .global-launcher-body')
    const isNestedLauncherScroller = launcherBody?.contains(candidate) ?? false
    if (
      (isExplicitLauncherScroller || isNestedLauncherScroller) &&
      canScrollLauncherElement(candidate, deltaY, deltaX)
    ) {
      return candidate
    }
    if (candidate === launcherBody) return null
    candidate = candidate.parentElement
  }
  return null
}

function canScrollLauncherElement(element: HTMLElement, deltaY: number, deltaX = 0) {
  const preferX = Math.abs(deltaX) > Math.abs(deltaY)
  if (preferX) {
    if (element.scrollWidth <= element.clientWidth + 1) return false
    if (deltaX < 0) return element.scrollLeft > 0
    if (deltaX > 0) return element.scrollLeft + element.clientWidth < element.scrollWidth - 1
    return true
  }
  if (element.scrollHeight <= element.clientHeight + 1) return false
  if (deltaY < 0) return element.scrollTop > 0
  if (deltaY > 0) return element.scrollTop + element.clientHeight < element.scrollHeight - 1
  return true
}

/** Skip rehydrate if we already did one this recently (open-path hot loop). */
const REHYDRATE_MIN_INTERVAL_MS = 3_000
let lastPersistedRehydrateAt = 0

/** @returns true when rehydrate actually ran */
async function rehydratePersistedAppState(): Promise<boolean> {
  const now = Date.now()
  if (now - lastPersistedRehydrateAt < REHYDRATE_MIN_INTERVAL_MS) {
    return false
  }
  lastPersistedRehydrateAt = now
  try {
    await useAppStore.persist.rehydrate()
    return true
  } catch (error) {
    console.warn('[hiven] Failed to rehydrate persisted settings:', error)
    return false
  }
}

const LAUNCHER_POSITION_TTL_MS = 2 * 60 * 1000

function isLauncherPositionFresh(position: GlobalLauncherPosition): boolean {
  if (position.lastDraggedAt == null) return false
  if (Date.now() - position.lastDraggedAt >= LAUNCHER_POSITION_TTL_MS) return false
  if (
    position.screenWidth != null &&
    position.screenHeight != null &&
    (position.screenWidth !== window.screen.width || position.screenHeight !== window.screen.height)
  ) {
    return false
  }
  return true
}
