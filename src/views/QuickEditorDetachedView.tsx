import { useCallback, useEffect, type PointerEvent as ReactPointerEvent } from 'react'
import { Search, Sparkles, WrapText, X } from 'lucide-react'
import { useAppStore } from '../store'
import { loadInstalledPluginsFromStore } from '../workspace/pluginRuntime'
import { registerBundledPluginPackages } from '../workspace/bundledPluginLoader'
import { registerHostLauncherProviders } from '../workspace/launcher/hostProvider'
import { useQuickEditorStore } from '../workspace/quickEditor/quickEditorStore'
import {
  applyQuickEditorOverwrite,
  applyQuickEditorPaneRequest,
  applyQuickEditorSetPaneText,
  isQuickEditorOverwriteRequest,
  isQuickEditorPaneRequest,
  isQuickEditorSetPaneTextRequest,
  QUICK_EDITOR_CREATE_PANE_EVENT,
  QUICK_EDITOR_OVERWRITE_EVENT,
  QUICK_EDITOR_SET_PANE_TEXT_EVENT,
} from '../workspace/quickEditor/quickEditorRequests'
import { getLanguageOptionLabel } from '../workspace/languageOptions'
import { QuickEditorPanel } from '../components/quickEditor/QuickEditorPanel'
import { ToastContainer } from '../components/workspace/ToastContainer'
import {
  closeQuickEditorWindow,
  startQuickEditorWindowDrag,
  startQuickEditorWindowResize,
} from '../workspace/windowManager/quickEditorWindow'
import { quickEditorImperative } from '../components/quickEditor/quickEditorImperative'
import { suppressStandaloneLauncherBlur } from '../workspace/launcherBlurGuard'
import { useT } from '../i18n'
import type { ResizeDirection } from '@tauri-apps/api/window'
import '../panels/register'

registerHostLauncherProviders()
registerBundledPluginPackages()

const resizeHandles: Array<{ direction: ResizeDirection; className: string }> = [
  { direction: 'North', className: 'quick-editor-resize-handle quick-editor-resize-handle--n' },
  { direction: 'South', className: 'quick-editor-resize-handle quick-editor-resize-handle--s' },
  { direction: 'West', className: 'quick-editor-resize-handle quick-editor-resize-handle--w' },
  { direction: 'East', className: 'quick-editor-resize-handle quick-editor-resize-handle--e' },
  { direction: 'NorthWest', className: 'quick-editor-resize-handle quick-editor-resize-handle--nw' },
  { direction: 'NorthEast', className: 'quick-editor-resize-handle quick-editor-resize-handle--ne' },
  { direction: 'SouthWest', className: 'quick-editor-resize-handle quick-editor-resize-handle--sw' },
  { direction: 'SouthEast', className: 'quick-editor-resize-handle quick-editor-resize-handle--se' },
]

/**
 * Root view for the detached Quick Editor window.
 * Uses the same editor-topbar style as the full editor.
 */
export function QuickEditorDetachedView() {
  const theme = useAppStore((s) => s.settings.theme)
  const fontSize = useAppStore((s) => s.settings.fontSize)
  const wordWrap = useAppStore((s) => s.settings.wordWrap)
  const updateSetting = useAppStore((s) => s.updateSetting)
  const openQuickEditorCommand = useAppStore((s) => s.openQuickEditorCommand)
  const locale = useAppStore((s) => s.locale)
  const language = useQuickEditorStore((s) => s.language)
  const tEditor = useT('editor')
  const tQuickEditor = useT('quickEditor')
  const languageLabel = getLanguageOptionLabel(language, locale)
  const commandShortcut = navigator.platform.toLowerCase().includes('mac') ? 'Cmd+K' : 'Ctrl+K'

  useEffect(() => {
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    void loadInstalledPluginsFromStore().catch((error) => {
      console.error('[hiven] Failed to load plugins for quick editor:', error)
    })
  }, [])

  useEffect(() => {
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
    let disposed = false
    let unlistenCreate: (() => void) | undefined
    let unlistenSetText: (() => void) | undefined
    let unlistenOverwrite: (() => void) | undefined
    import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        const createCleanup = await listen<unknown>(QUICK_EDITOR_CREATE_PANE_EVENT, (event) => {
          if (!isQuickEditorPaneRequest(event.payload)) return
          applyQuickEditorPaneRequest(event.payload)
        })
        const setTextCleanup = await listen<unknown>(QUICK_EDITOR_SET_PANE_TEXT_EVENT, (event) => {
          if (!isQuickEditorSetPaneTextRequest(event.payload)) return
          applyQuickEditorSetPaneText(event.payload)
        })
        const overwriteCleanup = await listen<unknown>(QUICK_EDITOR_OVERWRITE_EVENT, (event) => {
          if (!isQuickEditorOverwriteRequest(event.payload)) return
          applyQuickEditorOverwrite(event.payload)
        })
        if (disposed) {
          createCleanup()
          setTextCleanup()
          overwriteCleanup()
          return
        }
        unlistenCreate = createCleanup
        unlistenSetText = setTextCleanup
        unlistenOverwrite = overwriteCleanup
      })
      .catch((error) => {
        console.warn('[hiven] Failed to listen for quick editor pane requests:', error)
      })
    return () => {
      disposed = true
      unlistenCreate?.()
      unlistenSetText?.()
      unlistenOverwrite?.()
    }
  }, [])

  const handleRequestExit = useCallback(() => {
    void closeQuickEditorWindow().catch((error) => {
      console.warn('[hiven] Failed to close quick editor window:', error)
    })
  }, [])

  const handleWindowDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    if (event.target instanceof HTMLElement && event.target.closest('button, input, textarea, select, a, [role="button"], [data-no-drag], .monaco-editor')) return
    event.preventDefault()
    event.stopPropagation()
    void startQuickEditorWindowDrag().catch((error) => {
      console.warn('[hiven] Failed to drag quick editor window:', error)
    })
  }, [])

  const handleResizeStart = useCallback((direction: ResizeDirection) => (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    void startQuickEditorWindowResize(direction).catch((error) => {
      console.warn('[hiven] Failed to resize quick editor window:', error)
    })
  }, [])

  return (
    <div
      className="quick-editor-detached-window relative h-screen w-screen overflow-hidden flex flex-col"
      data-theme={theme}
      style={{ fontSize }}
    >
      <div className="editor-topbar glass" onPointerDown={handleWindowDrag}>
        <div className="editor-topbar-system">
          <button
            type="button"
            className={`editor-topbar-button${wordWrap ? ' is-active' : ''}`}
            onClick={() => updateSetting('wordWrap', !wordWrap)}
            title={tEditor('toggleWordWrap')}
          >
            <WrapText size={14} />
          </button>
          <button
            type="button"
            className="editor-topbar-button"
            onClick={() => quickEditorImperative.triggerFind()}
            title={tEditor('findReplace')}
          >
            <Search size={14} />
          </button>
        </div>
        <div className="editor-topbar-plugin-slot">
          <button
            type="button"
            className="btn btn-ghost btn-sm ft-btn ft-btn-ghost ft-btn-sm editor-topbar-run"
            onClick={() => {
              suppressStandaloneLauncherBlur()
              openQuickEditorCommand()
            }}
            title={tQuickEditor('runCommandWithShortcut', { shortcut: commandShortcut })}
          >
            <Sparkles size={13} />
            <span>{tQuickEditor('runCommand')}</span>
          </button>
          <span className="editor-topbar-status">{languageLabel}</span>
          <button
            type="button"
            className="editor-topbar-button"
            title={tQuickEditor('closeWindow')}
            onClick={handleRequestExit}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <QuickEditorPanel onRequestExit={handleRequestExit} />
      </div>
      {resizeHandles.map((handle) => (
        <div
          key={handle.direction}
          className={handle.className}
          data-no-drag
          onPointerDown={handleResizeStart(handle.direction)}
        />
      ))}
      <ToastContainer />
    </div>
  )
}
