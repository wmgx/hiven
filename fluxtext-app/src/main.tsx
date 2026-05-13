import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Monaco 0.55+ 使用 globalThis._VSCODE_NLS_MESSAGES 进行本地化
// 需要在 Monaco 加载之前设置好
async function init() {
  try {
    const stored = JSON.parse(localStorage.getItem('fluxtext-settings') || '{}')
    const locale = stored?.state?.locale || stored?.state?.settings?.locale || 'en'

    if (locale === 'zh') {
      const res = await fetch(
        'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/esm/nls.messages.zh-cn.js'
      )
      const text = await res.text()
      new Function(text)()
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
