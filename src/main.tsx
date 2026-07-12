import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const windowType = new URLSearchParams(window.location.search).get('window')
if (windowType === 'launcher') {
  document.documentElement.dataset.window = 'launcher'
} else if (windowType === 'plugin-surface' || windowType === 'quick-editor') {
  document.documentElement.dataset.window = windowType
}

// 禁用浏览器右键菜单
document.addEventListener('contextmenu', (e) => e.preventDefault())

// Monaco 0.55+ 使用 globalThis._VSCODE_NLS_MESSAGES 进行本地化
async function loadMonacoNls() {
  try {
    const stored = JSON.parse(localStorage.getItem('hiven-settings') || localStorage.getItem('fluxtext-settings') || '{}')
    const locale = stored?.state?.locale || stored?.state?.settings?.locale || 'en'

    if (String(locale).toLowerCase().startsWith('zh')) {
      // 尝试从本地 node_modules 加载中文语言包
      try {
        const nls = await import('monaco-editor/esm/nls.messages.zh-cn.js')
        if (nls) new Function(nls.default || '')()
      } catch {
        // 语言包不可用时回退到英文
      }
    }
  } catch {
    // 加载失败时回退到英文
  }
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
  const [{ loader }, RootComponent, monaco, { default: editorWorker }] = await Promise.all([
    import('@monaco-editor/react'),
    loadRootComponent(),
    import('monaco-editor'),
    import('monaco-editor/esm/vs/editor/editor.worker?worker'),
  ])

  self.MonacoEnvironment = {
    getWorker() {
      return new editorWorker()
    },
  }

  loader.config({ monaco })
  renderRoot(RootComponent)
}

async function init() {
  if (windowType === 'plugin-surface') {
    await initPluginSurfaceWindow()
    return
  }
  await initEditorCapableWindow()
}

init()
