import { StrictMode, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { loader } from '@monaco-editor/react'

const windowType = new URLSearchParams(window.location.search).get('window')
if (windowType === 'launcher' || windowType === 'plugin-surface') {
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
  const mod = await import('./App.tsx')
  return mod.default
}

async function init() {
  await loadMonacoNls()

  // Monaco 必须在 NLS 注入后加载，否则内置 tooltip 文案会固定为默认英文。
  const [RootComponent, monaco, { default: editorWorker }] = await Promise.all([
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

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RootComponent />
    </StrictMode>,
  )
}

init()
