import { useEffect, useMemo } from 'react'
import { CommandPalette } from '../components/CommandPalette'
import { PluginSettingsDialog } from '../components/PluginSettingsDialog'
import { EditorView } from '../views/EditorView'
import { useAppStore } from '../store'
import { loadInstalledPluginsFromStore } from '../workspace/pluginRuntime'
import { usePluginSettingsStore } from '../workspace/pluginSettingsStore'
import { closeEditorWindow } from '../workspace/windowManager/editorWindow'
import { useWorkspaceStore } from '../workspace/workspaceStore'

let initialPayloadConsumed = false

export function EditorWindowApp() {
  const theme = useAppStore((s) => s.settings.theme)
  const fontSize = useAppStore((s) => s.settings.fontSize)
  const initialPayload = useMemo(() => readEditorWindowInitialPayload(), [])

  useEffect(() => {
    void useAppStore.persist.rehydrate()
    void usePluginSettingsStore.persist.rehydrate()
    if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      void loadInstalledPluginsFromStore().catch((error) => {
        console.warn('[hiven] Failed to load plugins for editor window:', error)
      })
    }
  }, [])

  useEffect(() => {
    if (initialPayloadConsumed || !initialPayload) return
    initialPayloadConsumed = true
    useWorkspaceStore.getState().createPane({
      text: initialPayload.initialText ?? '',
      language: initialPayload.language,
      title: initialPayload.title,
      focus: true,
      direction: 'right',
    })
  }, [initialPayload])

  useEffect(() => {
    const title = initialPayload?.title?.trim() || 'Hiven Editor'
    document.title = title
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
      .catch((error) => {
        console.warn('[hiven] Failed to sync editor window title:', error)
      })
  }, [initialPayload])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((window as unknown as { __FLUXTEXT_HOTKEY_RECORDING__?: boolean }).__FLUXTEXT_HOTKEY_RECORDING__) return
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        event.stopPropagation()
        useAppStore.getState().setCommandPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  return (
    <div className="flux-spatial-shell editor-window-shell" data-theme={theme} style={{ fontSize }}>
      <div className="editor-window-chrome glass" data-tauri-drag-region>
        <div className="editor-window-title" data-tauri-drag-region>
          {initialPayload?.title?.trim() || 'Editor'}
        </div>
        <button
          type="button"
          className="editor-topbar-button"
          onClick={() => { void closeEditorWindow() }}
          title="Close Editor"
        >
          Close
        </button>
      </div>
      <main className="editor-window-content">
        <EditorView />
      </main>
      <CommandPalette />
      <PluginSettingsDialog />
    </div>
  )
}

function readEditorWindowInitialPayload() {
  const params = new URLSearchParams(window.location.search)
  const initialText = params.get('initialText') ?? undefined
  const language = params.get('language') ?? undefined
  const title = params.get('title') ?? undefined
  if (initialText === undefined && language === undefined && title === undefined) return null
  return { initialText, language, title }
}
