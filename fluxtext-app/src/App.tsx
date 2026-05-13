import { useEffect, useRef, useCallback } from 'react'
import { useAppStore } from './store'
import type { ViewId, ActionDef } from './store'
import { initConfigDir } from './configInit'
import { parseScriptToAction } from './store'
import { Sidebar } from './components/Sidebar'
import { EditorView } from './views/EditorView'
import { ScriptsView } from './views/ScriptsView'
import { DebuggerView } from './views/DebuggerView'
import { SettingsView } from './views/SettingsView'
import { CommandPalette } from './components/CommandPalette'

const VIEW_INDEX: Record<ViewId, number> = { editor: 0, scripts: 1, debugger: 2, settings: 3 }

function ViewContent({ viewId }: { viewId: ViewId }) {
  switch (viewId) {
    case 'editor': return <EditorView />
    case 'scripts': return <ScriptsView />
    case 'debugger': return <DebuggerView />
    case 'settings': return <SettingsView />
  }
}

export default function App() {
  const activeView = useAppStore((s) => s.activeView)
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const fontSize = useAppStore((s) => s.settings.fontSize)
  const prevViewRef = useRef<ViewId>(activeView)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    initConfigDir().then(async (dir) => {
      if (dir) {
        const scriptsDir = `${dir}/scripts`
        const current = useAppStore.getState().settings.watchDirectory
        if (current === '~/FluxText/actions' || current === '~/.local/fluxtext/scripts') {
          useAppStore.getState().updateSetting('watchDirectory', scriptsDir)
        }
      }
      // 启动时加载自定义脚本并注册到 Command Palette
      if ((window as any).__TAURI_INTERNALS__) {
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          const watchDir = useAppStore.getState().settings.watchDirectory
          const scripts = await invoke<{ name: string; path: string; content: string; builtin?: boolean }[]>('read_scripts_dir', { path: watchDir })
          const customs = scripts
            .filter(s => !s.builtin)
            .map(s => parseScriptToAction(s.content))
            .filter((a): a is ActionDef => a !== null)
          useAppStore.getState().setCustomActions(customs)
        } catch (e) {
          console.error('[FluxText] Failed to load custom scripts:', e)
        }
      }
    })
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        e.stopPropagation()
        useAppStore.getState().setCommandPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

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
        <ViewContent viewId={activeView} />
      </main>
      <CommandPalette />
    </div>
  )
}
