import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { translate } from '../i18n'
import type { HudTranslationView } from '../plugins/translate/hud/session'
import './TranslationHud.css'

type Snapshot = HudTranslationView & { locale: 'zh' | 'en'; theme: 'dark' | 'light' }
type Update = { snapshot: Snapshot | null }

export function TranslationHud() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const copyRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let disposed = false
    let stop = () => {}
    const accept = (update: Update) => {
      if (disposed) return
      setSnapshot((current) => !update.snapshot || !current || update.snapshot.sessionId !== current.sessionId
        || update.snapshot.revision >= current.revision ? update.snapshot : current)
    }
    void listen<Update>('hiven://translation-hud-update', ({ payload }) => accept(payload)).then(async (cleanup) => {
      if (disposed) { cleanup(); return }
      stop = cleanup
      accept(await invoke<Update>('translation_hud_ready'))
    }).catch(() => undefined)
    return () => { disposed = true; stop() }
  }, [])
  useEffect(() => { if (snapshot?.phase === 'active') copyRef.current?.focus() }, [snapshot?.phase])
  useEffect(() => {
    if (snapshot?.phase !== 'active') return
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      void invoke('translation_hud_action', {
        sessionId: snapshot.sessionId, revision: snapshot.revision, action: 'close',
      }).catch(() => undefined)
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [snapshot?.sessionId, snapshot?.revision, snapshot?.phase])
  if (!snapshot) return null
  const t = (key: string) => translate(snapshot.locale, 'hud', key)
  const action = (name: 'copy' | 'close') => invoke('translation_hud_action', {
    sessionId: snapshot.sessionId, revision: snapshot.revision, action: name,
  }).catch(() => undefined)
  const active = snapshot.phase === 'active'
  return <main className="translation-hud" data-theme={snapshot.theme} data-active={active}>
    <header><span>{t('translation.title')}</span><small>{snapshot.complete ? t('translation.complete') : snapshot.phase === 'error' ? t('translation.error') : t('translation.working')}</small></header>
    <pre aria-live="polite">{snapshot.phase === 'error' ? t('translation.error') : snapshot.preview || t('translation.working')}</pre>
    {snapshot.truncated && <p>{t('translation.previewTruncated')}</p>}
    {snapshot.copyFailed && <p role="alert">{t('translation.copyFailed')}</p>}
    {active && <footer>
      <button ref={copyRef} type="button" disabled={!snapshot.complete} onClick={() => { void action('copy') }}>{t('translation.copy')}</button>
      <button type="button" onClick={() => { void action('close') }}>{t('translation.close')}</button>
    </footer>}
  </main>
}
