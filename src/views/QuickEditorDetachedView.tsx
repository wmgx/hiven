import { useCallback, useEffect, type PointerEvent as ReactPointerEvent } from 'react'
import { useAppStore } from '../store'
import { loadInstalledPluginsFromStore } from '../workspace/pluginRuntime'
import { registerBundledPluginPackages } from '../workspace/bundledPluginLoader'
import { registerHostLauncherProviders } from '../workspace/launcher/hostProvider'
import {
  applyQuickEditorPaneRequest,
  isQuickEditorPaneRequest,
  QUICK_EDITOR_CREATE_PANE_EVENT,
} from '../workspace/quickEditor/quickEditorRequests'
import { listenForQuickEditorOverwrites } from '../workspace/quickEditor/quickEditorOverwriteHandoff'
import { useQuickEditorStore } from '../workspace/quickEditor/quickEditorStore'
import { QuickEditorPanel } from '../components/quickEditor/QuickEditorPanel'
import { SurfaceShell } from '../components/pluginSurface/SurfaceShell'
import { QuickEditorBreadcrumbActions } from '../components/quickEditor/QuickEditorBreadcrumbActions'
import {
  closeQuickEditorWindow,
  startQuickEditorWindowDrag,
  startQuickEditorWindowResize,
} from '../workspace/windowManager/quickEditorWindow'
import { useAutoCloseCurrentWindowOnBackgroundIdle } from '../components/launcher/GlobalLauncherWindowLifecycle'
import { useT } from '../i18n'
type ResizeDirection = 'East' | 'North' | 'NorthEast' | 'NorthWest' | 'South' | 'SouthEast' | 'SouthWest' | 'West'

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
  const tQuickEditor = useT('quickEditor')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.body.dataset.theme = theme
  }, [theme])

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
    let unlistenOverwrite: (() => void) | undefined
    import('@tauri-apps/api/event')
      .then(async ({ listen }) => {
        const createCleanup = await listen<unknown>(QUICK_EDITOR_CREATE_PANE_EVENT, (event) => {
          if (!isQuickEditorPaneRequest(event.payload)) return
          applyQuickEditorPaneRequest(event.payload)
        })
        const overwriteCleanup = await listenForQuickEditorOverwrites((text, options) => {
          if (disposed) throw new Error('QuickEditorClosed')
          const paneId = useQuickEditorStore.getState().overwriteActiveText(text, options)
          return { paneId, historyCount: useQuickEditorStore.getState().externalVersionHistory.length }
        })
        if (disposed) {
          createCleanup()
          overwriteCleanup()
          return
        }
        unlistenCreate = createCleanup
        unlistenOverwrite = overwriteCleanup
      })
      .catch((error) => {
        console.warn('[hiven] Failed to listen for quick editor pane requests:', error)
      })
    return () => {
      disposed = true
      unlistenCreate?.()
      unlistenOverwrite?.()
    }
  }, [])

  const handleRequestExit = useCallback(() => {
    void closeQuickEditorWindow().catch((error) => {
      console.warn('[hiven] Failed to close quick editor window:', error)
    })
  }, [])

  // Same policy as launcher host surfaces: closeOnBlur is false so brief app
  // switches stay open, but continuous background idle still auto-closes.
  useAutoCloseCurrentWindowOnBackgroundIdle({
    enabled: true,
    onClose: handleRequestExit,
  })

  const handleWindowDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !(event.target instanceof Element) || !event.target.closest('.surface-chrome-header')) return
    const excluded = event.target instanceof HTMLElement
      ? event.target.closest('button, input, textarea, select, a, [role="button"], [data-no-drag], .monaco-editor')
      : null
    if (excluded) return
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
      onPointerDown={handleWindowDrag}
    >
      <SurfaceShell title={tQuickEditor('title')} icon="FileText" onClose={handleRequestExit} standalone style={{ height: '100%' }} actions={<QuickEditorBreadcrumbActions detached />}>
        <QuickEditorPanel onRequestExit={handleRequestExit} />
      </SurfaceShell>
      {resizeHandles.map((handle) => (
        <div
          key={handle.direction}
          className={handle.className}
          data-no-drag
          onPointerDown={handleResizeStart(handle.direction)}
        />
      ))}
    </div>
  )
}
