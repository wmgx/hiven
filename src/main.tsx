import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { loadMonacoNls } from './kits/editor/monacoNls'
import { installWebNativeBridge } from './workspace/webNativeBridge'

if (await installWebNativeBridge()) {
  document.documentElement.dataset.webNativeBridge = 'true'
}

const isNativeTauriRuntime = Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) && !window.__HIVEN_WEB_NATIVE_BRIDGE__
const windowType = new URLSearchParams(window.location.search).get('window') ?? (isNativeTauriRuntime ? null : 'launcher')
if (windowType === 'launcher') {
  document.documentElement.dataset.window = 'launcher'
} else if (windowType === 'plugin-surface' || windowType === 'quick-editor') {
  document.documentElement.dataset.window = windowType
}

if (isNativeTauriRuntime) {
  document.addEventListener('contextmenu', (e) => e.preventDefault())
}

async function loadRootComponent(): Promise<ComponentType> {
  if (windowType === 'plugin-surface') {
    const mod = await import('./components/PluginSurfaceWindow.tsx')
    return mod.PluginSurfaceWindow
  }
  if (windowType === 'quick-editor') {
    const mod = await import('./views/QuickEditorDetachedView.tsx')
    return mod.QuickEditorDetachedView
  }
  const mod = await import('./App.tsx')
  return mod.default
}

function renderRoot(RootComponent: ComponentType) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RootComponent />
    </StrictMode>,
  )
}

/**
 * Plugin surface windows (clipboard history, csv, …) open via a dedicated
 * webview. They must not pay Monaco bootstrap cost on first paint — none of
 * the current window-presented surfaces mount an editor, and Monaco's
 * editor.api chunk alone is multi-MB.
 *
 * Surfaces that later need Monaco can still load it lazily via
 * @monaco-editor/react (which falls back to its own loader).
 */
async function initPluginSurfaceWindow() {
  const RootComponent = await loadRootComponent()
  renderRoot(RootComponent)
}

async function initEditorCapableWindow() {
  await loadMonacoNls()

  // Monaco 必须在 NLS 注入后加载，否则内置 tooltip 文案会固定为默认英文。
  // Dynamic import keeps Monaco out of the plugin-surface entry graph.
  const [{ configureMonacoRuntime }, RootComponent] = await Promise.all([
    import('./kits/editor/monacoRuntime'),
    loadRootComponent(),
  ])
  configureMonacoRuntime()
  renderRoot(RootComponent)
}

async function init() {
  if (windowType === 'plugin-surface') {
    await initPluginSurfaceWindow()
    return
  }
  if (windowType === 'launcher') {
    renderRoot(await loadRootComponent())
    return
  }
  await initEditorCapableWindow()
}

init()
