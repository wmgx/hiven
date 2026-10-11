import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { translate } from '../i18n'
import type { ToastLevel } from '../workspace/toast'
import './ToastHud.css'

type HudToast = { id: string; level: ToastLevel; expiresAt: number; locale: 'zh' | 'en'; theme: 'dark' | 'light'; progress?: { completed: number; total: number } }
type HudUpdate = { revision: number; toast: HudToast | null }

export function ToastHud() {
  const [toast, setToast] = useState<HudToast | null>(null)
  const revision = useRef(-1)
  useEffect(() => {
    let disposed = false
    let stop: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const accept = (update: HudUpdate) => {
      if (disposed || update.revision < revision.current) return
      revision.current = update.revision
      clearTimeout(timer)
      const next = update.toast && update.toast.expiresAt > Date.now() ? update.toast : null
      setToast(next)
      if (next) timer = setTimeout(() => setToast(null), Math.max(0, next.expiresAt - Date.now()))
    }
    void listen<HudUpdate>('hiven://hud-toast', ({ payload }) => accept(payload)).then(async (cleanup) => {
      if (disposed) { cleanup(); return }
      stop = cleanup
      accept(await invoke<HudUpdate>('hud_ready'))
    }).catch(() => {})
    return () => { disposed = true; stop?.(); clearTimeout(timer) }
  }, [])
  if (!toast) return null
  const t = (key: string) => translate(toast.locale, 'hud', key)
  return <div className="toast-hud" data-theme={toast.theme} data-level={toast.level} role={toast.level === 'error' ? 'alert' : 'status'}>
    <span className="toast-hud__icon" aria-hidden="true">{toast.level === 'success' ? '✓' : toast.level === 'info' ? 'i' : '!'}</span>
    <div><small>{t('title')}</small><strong>{t(toast.level)}</strong><p>{toast.progress ? translate(toast.locale, 'hud', 'queue.progress', { completed: toast.progress.completed, total: toast.progress.total, remaining: toast.progress.total - toast.progress.completed }) : t('details')}</p></div>
  </div>
}
