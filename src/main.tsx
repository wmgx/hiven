import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Monaco 本地加载配置（消除 CDN 依赖）
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { loader } from '@monaco-editor/react'

self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  },
}

loader.config({ monaco })

// 禁用浏览器右键菜单
document.addEventListener('contextmenu', (e) => e.preventDefault())

// Monaco 0.55+ 使用 globalThis._VSCODE_NLS_MESSAGES 进行本地化
async function init() {
  try {
    const stored = JSON.parse(localStorage.getItem('fluxtext-settings') || '{}')
    const locale = stored?.state?.locale || stored?.state?.settings?.locale || 'en'

    if (locale === 'zh') {
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

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

init()
