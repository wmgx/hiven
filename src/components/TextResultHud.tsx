import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { translate } from '../i18n'
import { acceptTextResultHudUpdate, type TextResultHudUpdate } from './textResultHudUpdates'
import './TextResultHud.css'

type Snapshot = {
  product: string
  sessionId: string
  revision: number
  phase: 'translating' | 'ready' | 'active' | 'cancelled' | 'error'
  preview: string
  truncated: boolean
  copyFailed: boolean
  pasteFailed: boolean
  pasteCopied: boolean
  pasteable: boolean
  /** Plugin-supplied strings; missing generic ones fall back to host defaults. */
  labels: Record<string, string>
  complete: boolean
  failure?: 'unavailable' | 'incomplete' | 'no-change' | 'too-large'
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
      if (event.isComposing || event.keyCode === 229) return
      let name: 'copy' | 'paste' | 'close' | null = null
      if (event.key === 'Escape') name = 'close'
      else if (event.key === 'Enter' && snapshot.complete) {
        if (event.shiftKey) name = snapshot.pasteable && !snapshot.pasteCopied ? 'paste' : null
        else name = 'copy'
      }
      if (!name) return
      event.preventDefault()
      void invoke('text_result_hud_action', {
        sessionId: snapshot.sessionId, revision: snapshot.revision, action: name,
      }).catch(() => undefined)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [snapshot?.sessionId, snapshot?.revision, snapshot?.phase, snapshot?.complete, snapshot?.pasteable, snapshot?.pasteCopied])
  if (!snapshot) return null
  const hostText = (key: string) => translate(snapshot.locale, 'hud', `generic.${key}`)
  const t = (key: string) => snapshot.labels[key] ?? hostText(key)
  const action = (name: 'copy' | 'paste' | 'close') => invoke('text_result_hud_action', {
    sessionId: snapshot.sessionId, revision: snapshot.revision, action: name,
  }).catch(() => undefined)
  const active = snapshot.phase === 'active'
  const result = active && snapshot.fullText != null ? snapshot.fullText : snapshot.preview
  const failure = snapshot.failure
  const errorText = (failure && snapshot.labels[`error.${failure}`]) || snapshot.labels.error || hostText('error')
  const errorStatus = (failure && snapshot.labels[`errorStatus.${failure}`]) || snapshot.labels.errorStatus || errorText
  return <main className="text-result-hud" data-theme={snapshot.theme} data-active={active} data-product={snapshot.product}>
    <header><span>{snapshot.labels.title ?? ''}</span><small>{snapshot.complete ? t('complete') : snapshot.phase === 'error' ? errorStatus : t('working')}</small></header>
    <pre ref={resultRef} tabIndex={active ? 0 : undefined} aria-label={t('result')} aria-live="polite">{snapshot.phase === 'error' ? errorText : result || t('working')}</pre>
    {snapshot.truncated && !active && <p>{t('previewTruncated')}</p>}
    {snapshot.copyFailed && <p role="alert">{t('copyFailed')}</p>}
    {snapshot.pasteFailed && <p role="alert">{t('pasteFailed')}</p>}
    {snapshot.pasteCopied && <p role="status">{t('pasteCopied')}</p>}
    {active && <footer>
      {snapshot.pasteable && <button type="button" disabled={!snapshot.complete || snapshot.pasteCopied} onClick={() => { void action('paste') }}>{t('paste')}</button>}
      <button type="button" disabled={!snapshot.complete} onClick={() => { void action('copy') }}>{t('copy')}</button>
      <button type="button" onClick={() => { void action('close') }}>{t('close')}</button>
    </footer>}
  </main>
}
