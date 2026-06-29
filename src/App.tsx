import { useEffect, useRef } from 'react'
import { useAppStore } from './store'
import type { GlobalLauncherPosition } from './store'
import { initConfigDir } from './configInit'
import { GlobalLauncher } from './components/GlobalLauncher'
import { PluginSettingsDialog } from './components/PluginSettingsDialog'
import { loadInstalledPluginsFromStore } from './workspace/pluginRuntime'
import { registerBundledPluginPackages } from './workspace/bundledPluginLoader'
import { initializePluginBackgrounds, setupBackgroundPermissionWatcher, setupBackgroundSettingsWatcher, stopAllPluginBackgrounds } from './workspace/pluginBackgroundManager'
import { runPluginStartupHooks } from './workspace/pluginHookManager'
import { refreshHostApplicationIndexOnStartup } from './workspace/appLauncher/hostAppLauncher'
import { registerHostLauncherProviders } from './workspace/launcher/hostProvider'
import { installGlobalPinnedLauncherHotkeys, routeGlobalPinnedLauncherShortcut } from './hotkeys/globalPinnedLauncher'
import { installPluginSurfaceShortcutHotkeys } from './hotkeys/pluginSurfaceShortcuts'
import { consumePendingPluginSurfaceOpenTarget, isPluginSurfaceOpenTarget, openLauncherHostedPluginSurface } from './workspace/pluginSurfaceOpenRequest'
import { LAUNCHER_PROGRAMMATIC_MOVE_EVENT } from './workspace/launcherWindowEvents'
import { onCurrentLauncherWindowMoved, setCurrentLauncherWindowPosition, type LauncherWindowMovedPosition } from './workspace/windowManager/launcherWindow'

// Register built-in panels
import './panels/register'

// Register first-party product plugin packages
registerHostLauncherProviders()
registerBundledPluginPackages()

const PINNED_RUNTIME_PRUNE_INTERVAL_MS = 60_000

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
      runPluginStartupHooks()
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

  useEffect(() => {
    const prunePinnedRuntimes = () => useAppStore.getState().prunePinnedRuntimes()
    prunePinnedRuntimes()
    const timer = window.setInterval(prunePinnedRuntimes, PINNED_RUNTIME_PRUNE_INTERVAL_MS)
    return () => window.clearInterval(timer)
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
      void (async () => {
        await rehydratePersistedAppState()
        const pendingSurfaceTarget = consumePendingPluginSurfaceOpenTarget()
        if (pendingSurfaceTarget) {
          openLauncherHostedPluginSurface(pendingSurfaceTarget)
        } else {
          useAppStore.getState().openGlobalLauncherOverlay('pinned-only')
        }
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
    </div>
  )
}

function shouldAllowLauncherListWheel(event: WheelEvent) {
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return false
  const target = event.target instanceof Element ? event.target : null
  return findLauncherWheelScroller(target, event.deltaY) !== null
}

function findLauncherWheelScroller(target: Element | null, deltaY: number): HTMLElement | null {
  let candidate = target?.closest('[data-launcher-scrollable], .global-launcher-body') as HTMLElement | null
  while (candidate) {
    if (canScrollLauncherElement(candidate, deltaY)) return candidate
    candidate = candidate.parentElement?.closest('[data-launcher-scrollable], .global-launcher-body') as HTMLElement | null
  }
  return null
}

function canScrollLauncherElement(element: HTMLElement, deltaY: number) {
  if (element.scrollHeight <= element.clientHeight) return false
  if (deltaY < 0) return element.scrollTop > 0
  if (deltaY > 0) return element.scrollTop + element.clientHeight < element.scrollHeight - 1
  return true
}

async function rehydratePersistedAppState() {
  try {
    await useAppStore.persist.rehydrate()
  } catch (error) {
    console.warn('[hiven] Failed to rehydrate persisted settings:', error)
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
