import { Component, type ReactNode, useEffect, useRef } from 'react'
import { useAppStore } from './store'
import type { ViewId } from './store'
import { initConfigDir } from './configInit'
import { Sidebar } from './components/Sidebar'
import { EditorView } from './views/EditorView'
import { ScriptsView } from './views/ScriptsView'
import { PluginEditorView } from './views/PluginEditorView'
import { PinnedRunnerView } from './views/PinnedRunnerView'
import { SettingsView } from './views/SettingsView'
import { CommandPalette } from './components/CommandPalette'
import { GlobalLauncher } from './components/GlobalLauncher'
import { loadInstalledPluginsFromStore } from './workspace/pluginRuntime'
import { registerBundledPluginPackages } from './workspace/bundledPluginLoader'
import { installGlobalPinnedLauncherHotkeys } from './hotkeys/globalPinnedLauncher'

// Register built-in panels
import './panels/register'

// Register core plugin and first-party product plugin packages
import './workspace/corePlugin'

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
    console.error('[FluxText] View render failed:', error)
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
  switch (viewId) {
    case 'editor': return <EditorView />
    case 'scripts': return <ScriptsView />
    case 'plugin-editor': return <PluginEditorView />
    case 'pinned-runner': return <PinnedRunnerView />
    case 'settings': return <SettingsView />
  }
}

export default function App() {
  return isLauncherWindow() ? <LauncherWindowApp /> : <MainApp />
}

function MainApp() {
  const activeView = useAppStore((s) => s.activeView)
  const fontSize = useAppStore((s) => s.settings.fontSize)
  const settings = useAppStore((s) => s.settings)
  const prunePinnedRuntimes = useAppStore((s) => s.prunePinnedRuntimes)
  const prevViewRef = useRef<ViewId>(activeView)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    initConfigDir().then(async (dir) => {
      if (dir) {
        const pluginDir = `${dir}/plugins/installed`
        const current = useAppStore.getState().settings.watchDirectory
        if (current === '~/FluxText/actions' || current === '~/.local/fluxtext/scripts') {
          useAppStore.getState().updateSetting('watchDirectory', pluginDir)
        }
      }
      if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
        try {
          await loadInstalledPluginsFromStore()
        } catch (e) {
          console.error('[FluxText] Failed to load plugins:', e)
        }
      }
    })
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
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        const state = useAppStore.getState()
        if (state.activeView !== 'editor') return
        e.preventDefault()
        e.stopPropagation()
        state.setCommandPaletteOpen(true)
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
      .then(({ listen }) => listen('fluxtext://open-pinned-launcher', () => {
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
        console.warn('[FluxText] Failed to listen for pinned launcher event:', error)
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => installGlobalPinnedLauncherHotkeys(), [])

  useEffect(() => {
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    let disposed = false
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen<{ id: string }>('fluxtext://run-pinned-action', (event) => {
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
        console.warn('[FluxText] Failed to listen for launcher action event:', error)
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
      data-theme={settings.theme}
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
    </div>
  )
}

function LauncherWindowApp() {
  const fontSize = useAppStore((s) => s.settings.fontSize)
  const theme = useAppStore((s) => s.settings.theme)
  const launcherWindowPosition = useAppStore((s) => s.settings.globalLauncherWindowPosition)

  useEffect(() => {
    const openLauncher = () => {
      void (async () => {
        await rehydratePersistedAppState()
        const position = useAppStore.getState().settings.globalLauncherWindowPosition
        useAppStore.getState().openGlobalLauncherOverlay('pinned-only')
        if (position && (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
          try {
            const { LogicalPosition } = await import('@tauri-apps/api/dpi')
            const { getCurrentWindow } = await import('@tauri-apps/api/window')
            await getCurrentWindow().setPosition(new LogicalPosition(position.x, position.y))
          } catch (error) {
            console.warn('[FluxText] Failed to restore launcher window position:', error)
          }
        }
      })()
    }
    openLauncher()

    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    let disposed = false
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('fluxtext://launcher-open', openLauncher))
      .then((cleanup) => {
        if (disposed) cleanup()
        else unlisten = cleanup
      })
      .catch((error) => {
        console.warn('[FluxText] Failed to listen for launcher open event:', error)
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  return (
    <div className="flux-spatial-shell launcher-window-shell" data-theme={theme} data-launcher-position={launcherWindowPosition ? 'stored' : 'default'} style={{ fontSize }}>
      <GlobalLauncher />
    </div>
  )
}

async function rehydratePersistedAppState() {
  try {
    await useAppStore.persist.rehydrate()
  } catch (error) {
    console.warn('[FluxText] Failed to rehydrate persisted settings:', error)
  }
}

function isLauncherWindow() {
  return new URLSearchParams(window.location.search).get('window') === 'launcher'
}
