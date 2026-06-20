import { Component, lazy, type ReactNode, Suspense, useEffect, useRef } from 'react'
import { useAppStore } from './store'
import type { GlobalLauncherPosition, ViewId } from './store'
import { initConfigDir } from './configInit'
import { Sidebar } from './components/Sidebar'
const EditorView = lazy(() => import('./views/EditorView').then(m => ({ default: m.EditorView })))
const ScriptsView = lazy(() => import('./views/ScriptsView').then(m => ({ default: m.ScriptsView })))
const PluginEditorView = lazy(() => import('./views/PluginEditorView').then(m => ({ default: m.PluginEditorView })))
const PinnedRunnerView = lazy(() => import('./views/PinnedRunnerView').then(m => ({ default: m.PinnedRunnerView })))
const SettingsView = lazy(() => import('./views/SettingsView').then(m => ({ default: m.SettingsView })))
import { CommandPalette } from './components/CommandPalette'
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
import { consumePendingPluginSurfaceOpenTarget, isPluginSurfaceOpenTarget } from './workspace/pluginSurfaceOpenRequest'
import { LAUNCHER_PROGRAMMATIC_MOVE_EVENT } from './workspace/launcherWindowEvents'

// Register built-in panels
import './panels/register'

// Register first-party product plugin packages
registerHostLauncherProviders()
registerBundledPluginPackages()

const VIEW_INDEX: Record<ViewId, number> = { editor: 0, scripts: 1, 'plugin-editor': 2, 'pinned-runner': 3, settings: 4 }

class ViewErrorBoundary extends Component<
  { viewId: ViewId; children: ReactNode },
  { error: Error | null; viewId: ViewId }
> {
  state = { error: null, viewId: this.props.viewId }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(props: { viewId: ViewId }, state: { error: Error | null; viewId: ViewId }) {
    if (props.viewId !== state.viewId) {
      return { error: null, viewId: props.viewId }
    }
    return null
  }

  componentDidCatch(error: Error) {
    console.error('[hiven] View render failed:', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6" style={{ color: 'var(--color-text-tertiary)' }}>
          <div className="scripts-title">View failed to render</div>
          <div className="max-w-[640px] text-center text-[12px]" style={{ color: 'var(--color-error-text)' }}>
            {this.state.error.message}
          </div>
          <button className="scripts-btn" onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      )
    }
    return this.props.children
  }
}

function ViewContent({ viewId }: { viewId: ViewId }) {
  return (
    <Suspense fallback={<div className="view-loading" />}>
      {viewId === 'editor' && <EditorView />}
      {viewId === 'scripts' && <ScriptsView />}
      {viewId === 'plugin-editor' && <PluginEditorView />}
      {viewId === 'pinned-runner' && <PinnedRunnerView />}
      {viewId === 'settings' && <SettingsView />}
    </Suspense>
  )
}

export default function App() {
  return isLauncherWindow() ? <LauncherWindowApp /> : <MainApp />
}

function MainApp() {
  const activeView = useAppStore((s) => s.activeView)
  const fontSize = useAppStore((s) => s.settings.fontSize)
  const theme = useAppStore((s) => s.settings.theme)
  const prunePinnedRuntimes = useAppStore((s) => s.prunePinnedRuntimes)
  const prevViewRef = useRef<ViewId>(activeView)
  const containerRef = useRef<HTMLDivElement>(null)

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
        } catch (e) {
          console.error('[hiven] Failed to load plugins:', e)
        }
      }

      if (disposed) return
      refreshHostApplicationIndexOnStartup()
      runPluginStartupHooks()
      try {
        initializePluginBackgrounds()
        cleanupSettingsWatcher = setupBackgroundSettingsWatcher()
        cleanupPermissionWatcher = setupBackgroundPermissionWatcher()
      } catch (err) {
        console.error('[hiven] Failed to initialize plugin backgrounds:', err)
      }
    })

    return () => {
      disposed = true
      cleanupSettingsWatcher?.()
      cleanupPermissionWatcher?.()
      void stopAllPluginBackgrounds()
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((window as unknown as { __FLUXTEXT_HOTKEY_RECORDING__?: boolean }).__FLUXTEXT_HOTKEY_RECORDING__) return
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        useAppStore.getState().openGlobalLauncher('full')
        return
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  useEffect(() => {
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    let disposed = false
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('hiven://open-pinned-launcher', () => {
        void (async () => {
          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('show_launcher_window')
        })()
      }))
      .then((cleanup) => {
        if (disposed) cleanup()
        else unlisten = cleanup
      })
      .catch((error) => {
        console.warn('[hiven] Failed to listen for pinned launcher event:', error)
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
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    let disposed = false
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('hiven://show-main-panel', () => {
        const state = useAppStore.getState()
        state.setActiveView('editor')
        state.setCommandPaletteOpen(false)
        state.setGlobalLauncherOpen(false)
      }))
      .then((cleanup) => {
        if (disposed) cleanup()
        else unlisten = cleanup
      })
      .catch((error) => {
        console.warn('[hiven] Failed to listen for show main panel event:', error)
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    let disposed = false
    let unlistenPlugins: (() => void) | undefined
    let unlistenSettings: (() => void) | undefined
    import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        unlistenPlugins = await listen('hiven://show-plugins-page', () => {
          const state = useAppStore.getState()
          state.setActiveView('scripts')
          state.setCommandPaletteOpen(false)
          state.setGlobalLauncherOpen(false)
        })
        unlistenSettings = await listen('hiven://show-settings-page', () => {
          const state = useAppStore.getState()
          state.setActiveView('settings')
          state.setCommandPaletteOpen(false)
          state.setGlobalLauncherOpen(false)
        })
      })
      .then(() => {
        if (disposed) {
          unlistenPlugins?.()
          unlistenSettings?.()
        }
      })
      .catch((error) => {
        console.warn('[hiven] Failed to listen for launcher page events:', error)
      })
    return () => {
      disposed = true
      unlistenPlugins?.()
      unlistenSettings?.()
    }
  }, [])

  useEffect(() => installGlobalPinnedLauncherHotkeys(), [])
  useEffect(() => installPluginSurfaceShortcutHotkeys(), [])

  useEffect(() => {
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    let disposed = false
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen<{ id: string }>('hiven://run-pinned-action', (event) => {
        void (async () => {
          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('show_and_focus_window')
          useAppStore.getState().openPinnedAction(event.payload.id)
        })()
      }))
      .then((cleanup) => {
        if (disposed) cleanup()
        else unlisten = cleanup
      })
      .catch((error) => {
        console.warn('[hiven] Failed to listen for launcher action event:', error)
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => prunePinnedRuntimes(), 30_000)
    return () => window.clearInterval(timer)
  }, [prunePinnedRuntimes])

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

  // Direction-aware view transition
  useEffect(() => {
    const el = containerRef.current?.firstElementChild as HTMLElement | null
    if (!el) return
    const prevIdx = VIEW_INDEX[prevViewRef.current]
    const nextIdx = VIEW_INDEX[activeView]
    const goingUp = nextIdx < prevIdx

    // Set initial state
    el.classList.add(goingUp ? 'view-enter-up' : 'view-enter')
    // Trigger transition on next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.classList.remove('view-enter', 'view-enter-up')
        el.classList.add(goingUp ? 'view-enter-up-active' : 'view-enter-active')
        // Clean up after transition
        const cleanup = () => {
          el.classList.remove('view-enter-active', 'view-enter-up-active')
          el.removeEventListener('transitionend', cleanup)
        }
        el.addEventListener('transitionend', cleanup)
      })
    })

    prevViewRef.current = activeView
  }, [activeView])

  const globalLauncherOverlay = useAppStore((s) => s.globalLauncherOverlay)

  return (
    <div
      className="flux-spatial-shell"
      data-theme={theme}
      style={{ fontSize }}
    >
      <div className="flux-main">
        {!globalLauncherOverlay && <Sidebar />}
        {!globalLauncherOverlay && (
          <main className="flux-content view-container" ref={containerRef}>
            <ViewErrorBoundary viewId={activeView}>
              <ViewContent viewId={activeView} />
            </ViewErrorBoundary>
          </main>
        )}
      </div>
      {!globalLauncherOverlay && activeView === 'editor' && <CommandPalette />}
      <GlobalLauncher />
      <PluginSettingsDialog />
    </div>
  )
}

function LauncherWindowApp() {
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

  useEffect(() => {
    const openLauncher = () => {
      void (async () => {
        await rehydratePersistedAppState()
        const pendingSurfaceTarget = consumePendingPluginSurfaceOpenTarget()
        if (pendingSurfaceTarget) {
          useAppStore.getState().openPluginSurfaceTool(pendingSurfaceTarget)
        }
        useAppStore.getState().openGlobalLauncherOverlay('pinned-only')
        // The window is centered on the cursor's monitor natively in
        // `center_launcher_window` before this event fires. Only override that
        // centering with a previously dragged position while it is still fresh
        // (within the TTL and on the same screen); otherwise the launcher falls
        // back to centered so it never gets stranded where it was last left.
        if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
        const settings = useAppStore.getState().settings
        const saved = settings.globalLauncherWindowPositionSource === 'user'
          ? settings.globalLauncherWindowPosition
          : undefined
        if (!saved || !isLauncherPositionFresh(saved)) return
        try {
          const { LogicalPosition } = await import('@tauri-apps/api/dpi')
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          suppressNextLauncherMovePersistence()
          await getCurrentWindow().setPosition(new LogicalPosition(saved.x, saved.y))
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
        useAppStore.getState().openPluginSurfaceTool(event.payload)
        useAppStore.getState().openGlobalLauncherOverlay('pinned-only')
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

    import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow()
        return win.onMoved(async ({ payload: position }) => {
          if (launcherProgrammaticMoveRef.current) {
            launcherProgrammaticMoveRef.current = false
            if (launcherProgrammaticMoveResetRef.current !== undefined) {
              window.clearTimeout(launcherProgrammaticMoveResetRef.current)
              launcherProgrammaticMoveResetRef.current = undefined
            }
            return
          }
          // Throttle: only persist position at most every 150ms
          lastMovePayload = position
          if (moveThrottleTimer !== undefined) return
          moveThrottleTimer = setTimeout(async () => {
            moveThrottleTimer = undefined
            const pos = lastMovePayload as typeof position
            if (!pos) return
            try {
              const scaleFactor = await win.scaleFactor()
              const logicalPosition = pos.toLogical(scaleFactor)
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
  const scroller = target?.closest('[data-launcher-scrollable], .global-launcher-body') as HTMLElement | null
  if (!scroller) return false
  if (scroller.scrollHeight <= scroller.clientHeight) return false
  if (event.deltaY < 0) return scroller.scrollTop > 0
  if (event.deltaY > 0) return scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1
  return true
}

async function rehydratePersistedAppState() {
  try {
    await useAppStore.persist.rehydrate()
  } catch (error) {
    console.warn('[hiven] Failed to rehydrate persisted settings:', error)
  }
}

function isLauncherWindow() {
  return new URLSearchParams(window.location.search).get('window') === 'launcher'
}

const LAUNCHER_POSITION_TTL_MS = 2 * 60 * 1000

// A dragged launcher position is only honored briefly (TTL) and on the same
// screen it was saved on; once stale it is ignored so the launcher reverts to
// being centered on the cursor's monitor.
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
