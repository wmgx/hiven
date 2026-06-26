import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useAppStore } from '../store'
import { initConfigDir } from '../configInit'
import { loadInstalledPluginsFromStore } from '../workspace/pluginRuntime'
import { registerBundledPluginPackages } from '../workspace/bundledPluginLoader'
import { registerHostLauncherProviders } from '../workspace/launcher/hostProvider'
import { EditorView } from '../views/EditorView'
import { CommandPalette } from './CommandPalette'
import { PluginSettingsDialog } from './PluginSettingsDialog'
import './EditorWindow.css'
import '../panels/register'

registerHostLauncherProviders()
registerBundledPluginPackages()

export function EditorWindow() {
  const theme = useAppStore((s) => s.settings.theme)
  const fontSize = useAppStore((s) => s.settings.fontSize)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    initConfigDir()
      .then(() => loadInstalledPluginsFromStore())
      .catch((err) => {
        if (!disposed) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!disposed) setReady(true)
      })
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const hasPrimary = event.metaKey || event.ctrlKey
      if (!hasPrimary || event.key.toLowerCase() !== 'w') return
      event.preventDefault()
      event.stopPropagation()
      void closeCurrentWindow()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return (
    <div className="flux-spatial-shell editor-window-shell" data-theme={theme} style={{ fontSize }}>
      <div className="editor-window-chrome" data-tauri-drag-region>
        <div className="editor-window-title" data-tauri-drag-region>Hiven · 编辑器</div>
        <button className="editor-window-close" type="button" onClick={() => { void closeCurrentWindow() }}>×</button>
      </div>
      <div className="editor-window-content">
        {!ready ? (
          <WindowStateMessage title="Loading editor…" />
        ) : error ? (
          <WindowStateMessage title="Editor runtime failed" message={error} />
        ) : (
          <EditorView />
        )}
      </div>
      <CommandPalette />
      <PluginSettingsDialog />
    </div>
  )
}

async function closeCurrentWindow(): Promise<void> {
  if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    await getCurrentWindow().close().catch(() => undefined)
    return
  }
  window.close()
}

function WindowStateMessage({ title, message }: { title: string; message?: string }) {
  return (
    <div className="editor-window-message">
      <div>{title}</div>
      {message && <small>{message}</small>}
    </div>
  )
}
