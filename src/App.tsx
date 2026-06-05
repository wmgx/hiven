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
  const activeView = useAppStore((s) => s.activeView)
  const fontSize = useAppStore((s) => s.settings.fontSize)
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
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        useAppStore.getState().setGlobalLauncherOpen(true)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        e.stopPropagation()
        useAppStore.getState().setCommandPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
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

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ fontFamily: 'var(--font-mono)', fontSize }}>
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden view-container" ref={containerRef}>
        <ViewErrorBoundary viewId={activeView}>
          <ViewContent viewId={activeView} />
        </ViewErrorBoundary>
      </main>
      <CommandPalette />
      <GlobalLauncher />
    </div>
  )
}
