import { useEffect, useRef, useState } from 'react'
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
import { registerGlobalShortcut, unregisterGlobalShortcut } from './utils/globalShortcut'

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
  const fontSize = useAppStore((s) => s.settings.fontSize)
  const globalShortcut = useAppStore((s) => s.settings.globalShortcut)
  const prevViewRef = useRef<ViewId>(activeView)
  const containerRef = useRef<HTMLDivElement>(null)
  const [windowLabel, setWindowLabel] = useState<string | null>(
    (window as any).__TAURI_INTERNALS__ ? null : 'main'
  )

  useEffect(() => {
    if (!(window as any).__TAURI_INTERNALS__) return

    async function setupWindowLabel() {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      setWindowLabel(getCurrentWindow().label)
    }

    setupWindowLabel().catch(() => setWindowLabel('main'))
  }, [])

  useEffect(() => {
    if (windowLabel !== 'main') return

    registerGlobalShortcut(globalShortcut)
      .catch((e) => console.error('[FluxText] Failed to register global shortcut:', e))

    return () => {
      unregisterGlobalShortcut().catch((e) => console.error('[FluxText] Failed to unregister global shortcut:', e))
    }
  }, [globalShortcut, windowLabel])

  useEffect(() => {
    initConfigDir().then(async (dir) => {
      if (dir) {
        const scriptsDir = `${dir}/scripts`
        const current = useAppStore.getState().settings.watchDirectory
        if (current === '~/FluxText/actions' || current === '~/.local/fluxtext/scripts') {
          useAppStore.getState().updateSetting('watchDirectory', scriptsDir)
        }
      }
      // 启动时加载脚本并注册到 Command Palette
      if ((window as any).__TAURI_INTERNALS__) {
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          const watchDir = useAppStore.getState().settings.watchDirectory
          const scripts = await invoke<{ name: string; path: string; content: string; builtin?: boolean }[]>('read_scripts_dir', { path: watchDir })

          // 从磁盘 builtin 脚本覆盖硬编码版本（支持远程更新生效）
          const builtinsFromDisk = scripts
            .filter(s => s.builtin)
            .map(s => parseScriptToAction(s.content))
            .filter((a): a is ActionDef => a !== null)
          if (builtinsFromDisk.length > 0) {
            useAppStore.getState().setBuiltinActionsFromDisk(builtinsFromDisk)
          }

          // 注册自定义脚本
          const customs = scripts
            .filter(s => !s.builtin)
            .map(s => parseScriptToAction(s.content))
            .filter((a): a is ActionDef => a !== null)
          useAppStore.getState().setCustomActions(customs)
        } catch (e) {
          console.error('[FluxText] Failed to load scripts:', e)
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

  useEffect(() => {
    if (windowLabel !== 'launcher') return

    let unlisten: (() => void) | undefined

    async function setup() {
      const { listen } = await import('@tauri-apps/api/event')
      const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
      unlisten = await listen('fluxtext://global-launch', async () => {
        const store = useAppStore.getState()
        const text = store.settings.useClipboardOnGlobalLaunch ? ((await readText()) ?? '') : ''
        store.setCommandPaletteInputOverride(text)
        if (store.settings.openCommandPaletteOnGlobalLaunch) {
          store.setCommandPaletteOpen(true)
        }
      })
    }

    setup().catch((e) => console.error('[FluxText] Failed to listen global launch:', e))
    return () => { unlisten?.() }
  }, [windowLabel])

  useEffect(() => {
    if (windowLabel !== 'main') return

    let unlistenOpen: (() => void) | undefined
    let unlistenResult: (() => void) | undefined

    async function setup() {
      const { listen } = await import('@tauri-apps/api/event')
      const { getCurrentWindow } = await import('@tauri-apps/api/window')

      unlistenOpen = await listen('fluxtext://open-command-palette', () => {
        useAppStore.getState().setCommandPaletteOpen(true)
      })

      unlistenResult = await listen<{ text: string; actionName: string }>('fluxtext://launcher-result', async ({ payload }) => {
        const store = useAppStore.getState()
        store.openQuickTabFromClipboard(payload.text)
        store.setLastResult(payload.text)
        store.setLastActionName(payload.actionName)
        store.setCommandPaletteOpen(false)

        const main = getCurrentWindow()
        await main.show()
        await main.unminimize()
        await main.setFocus()
      })
    }

    setup().catch((e) => console.error('[FluxText] Failed to listen main window events:', e))
    return () => {
      unlistenOpen?.()
      unlistenResult?.()
    }
  }, [windowLabel])

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

  if (!windowLabel) return null

  if (windowLabel === 'launcher') {
    return (
      <div className="h-full w-full overflow-hidden launcher-root" style={{ fontFamily: 'var(--font-mono)', fontSize }}>
        <CommandPalette variant="launcher" />
      </div>
    )
  }

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ fontFamily: 'var(--font-mono)', fontSize }}>
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden view-container" ref={containerRef}>
        <ViewContent viewId={activeView} />
      </main>
      <CommandPalette variant="app" />
    </div>
  )
}
