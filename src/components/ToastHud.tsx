import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { translate } from '../i18n'
import type { ToastLevel } from '../workspace/toast'
import './ToastHud.css'

type HudToast = {
  id: string
  slot: 'flash' | 'status'
  level: ToastLevel
  message?: string
  detail?: string
  expiresAt: number
  locale: 'zh' | 'en'
  theme: 'dark' | 'light'
  progress?: { completed: number; total: number }
}
type HudUpdate = { revision: number; toasts: HudToast[] }

export function ToastHud() {
  const [toasts, setToasts] = useState<HudToast[]>([])
  const revision = useRef(-1)
  useEffect(() => {
    let disposed = false
    let stop: (() => void) | undefined
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const accept = (update: HudUpdate) => {
      if (disposed || update.revision < revision.current) return
      revision.current = update.revision
      timers.forEach(clearTimeout)
      timers.clear()
      const live = update.toasts.filter(toast => toast.expiresAt > Date.now())
      setToasts(live)
      for (const toast of live) {
        timers.add(setTimeout(() => setToasts(current => current.filter(item => item.id !== toast.id)), Math.max(0, toast.expiresAt - Date.now())))
      }
    }
    void listen<HudUpdate>('hiven://hud-toast', ({ payload }) => accept(payload)).then(async (cleanup) => {
      if (disposed) { cleanup(); return }
      stop = cleanup
      accept(await invoke<HudUpdate>('hud_ready'))
    }).catch(() => {})
    return () => { disposed = true; stop?.(); timers.forEach(clearTimeout) }
  }, [])
  if (!toasts.length) return null
  return <div className="toast-hud-stack" data-theme={toasts[0].theme}>
    {toasts.map(toast => <HudCard key={toast.id} toast={toast} />)}
  </div>
}

function HudCard({ toast }: { toast: HudToast }) {
  const t = (key: string, vars?: Record<string, number>) => translate(toast.locale, 'hud', key, vars)
  // Non-notify toasts never send text natively; they fall back to a generic level line.
  const message = toast.message ?? t(toast.level)
  const detail = toast.progress
    ? t('queue.progress', { completed: toast.progress.completed, total: toast.progress.total, remaining: toast.progress.total - toast.progress.completed })
    : toast.message ? toast.detail : t('details')
  return <div className="toast-hud" data-slot={toast.slot} data-level={toast.level} role={toast.level === 'error' ? 'alert' : 'status'}>
    <span className="toast-hud__icon" aria-hidden="true">{toast.level === 'success' ? '✓' : toast.level === 'info' ? 'i' : '!'}</span>
    <div><strong>{message}</strong>{detail ? <p>{detail}</p> : null}</div>
  </div>
}
