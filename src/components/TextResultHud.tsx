import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { translate } from '../i18n'
import { acceptTextResultHudUpdate, type TextResultHudUpdate } from './textResultHudUpdates'
import './TextResultHud.css'

type Snapshot = {
  product: 'translation' | 'qr-scan' | 'clean-agent'
  sessionId: string
  revision: number
  phase: 'translating' | 'ready' | 'active' | 'cancelled' | 'error'
  preview: string
  truncated: boolean
  copyFailed: boolean
  complete: boolean
  sensitive: boolean
  failure?: 'unavailable' | 'incomplete' | 'no-change' | 'too-large' | 'refused'
  expiresAt: number
  locale: 'zh' | 'en'
  theme: 'dark' | 'light'
}
type RenderSnapshot = Snapshot & { fullText?: string }
type Update = TextResultHudUpdate<Snapshot>

export function TextResultHud() {
  const [render, setRender] = useState<{ generation: number; snapshot: RenderSnapshot | null }>({ generation: -1, snapshot: null })
  const snapshot = render.snapshot
  const resultRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    let disposed = false
    let stop = () => {}
    const accept = (update: Update) => {
      if (disposed) return
      setRender((current) => acceptTextResultHudUpdate(current, update))
    }
    void listen<Update>('hiven://text-result-hud-update', ({ payload }) => accept(payload)).then(async (cleanup) => {
      if (disposed) { cleanup(); return }
      stop = cleanup
      accept(await invoke<Update>('text_result_hud_ready'))
    }).catch(() => undefined)
    return () => { disposed = true; stop() }
  }, [])
  useEffect(() => { if (snapshot?.phase === 'active') resultRef.current?.focus() }, [snapshot?.phase])
  useEffect(() => {
    if (snapshot?.phase !== 'active') return
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      void invoke('text_result_hud_action', {
        sessionId: snapshot.sessionId, revision: snapshot.revision, action: 'close',
      }).catch(() => undefined)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [snapshot?.sessionId, snapshot?.revision, snapshot?.phase])
  if (!snapshot) return null
  const t = (key: string) => translate(snapshot.locale, 'hud', key)
  const action = (name: 'copy' | 'close') => invoke('text_result_hud_action', {
    sessionId: snapshot.sessionId, revision: snapshot.revision, action: name,
  }).catch(() => undefined)
  const prefix = snapshot.product === 'qr-scan' ? 'qr' : snapshot.product === 'clean-agent' ? 'cleanAgent' : 'translation'
  const active = snapshot.phase === 'active'
  const result = active && snapshot.fullText != null ? snapshot.fullText : snapshot.preview
  const errorKey = snapshot.product === 'clean-agent' && snapshot.failure
    ? `cleanAgent.${snapshot.failure}`
    : snapshot.failure === 'unavailable' ? `${prefix}.unavailable` : `${prefix}.error`
  const errorStatusKey = snapshot.product === 'clean-agent'
    ? 'cleanAgent.errorStatus'
    : snapshot.failure === 'unavailable' ? `${prefix}.unavailableStatus` : `${prefix}.error`
  return <main className="text-result-hud" data-theme={snapshot.theme} data-active={active} data-product={snapshot.product}>
    <header><span>{t(`${prefix}.title`)}</span><small>{snapshot.complete ? t(`${prefix}.complete`) : snapshot.phase === 'error' ? t(errorStatusKey) : t(`${prefix}.working`)}</small></header>
    <pre ref={resultRef} tabIndex={active ? 0 : undefined} aria-label={t(`${prefix}.result`)} aria-live="polite">{snapshot.phase === 'error' ? t(errorKey) : !active && snapshot.product === 'clean-agent' ? t('cleanAgent.hidden') : snapshot.sensitive && !active ? t('qr.sensitive') : result || t(`${prefix}.working`)}</pre>
    {snapshot.truncated && !active && !snapshot.sensitive && <p>{t(`${prefix}.previewTruncated`)}</p>}
    {snapshot.copyFailed && <p role="alert">{t(`${prefix}.copyFailed`)}</p>}
    {active && <footer>
      <button type="button" disabled={!snapshot.complete} onClick={() => { void action('copy') }}>{t(`${prefix}.copy`)}</button>
      <button type="button" onClick={() => { void action('close') }}>{t(`${prefix}.close`)}</button>
    </footer>}
  </main>
}
