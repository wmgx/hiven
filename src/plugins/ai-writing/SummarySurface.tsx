import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, IconButton, Select } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
import { SUMMARY_POINT_LIMITS, type SummaryPointLimit } from './prompt'
import { SummarySession } from './session'

function keepSelection(options: Array<{ value: string; label: string }>, value: string, unavailable: string) {
  return value && !options.some((option) => option.value === value) ? [...options, { value, label: unavailable }] : options
}

export function SummarySurface({ host, initialText, t }: PluginSurfaceProps) {
  const [session] = useState(() => new SummarySession(initialText ?? ''))
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  const settingsVisit = useRef<object | null>(null)
  const mounted = useRef(false)
  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; settingsVisit.current = null }
  }, [])
  useLayoutEffect(() => {
    session.setAi(host.ai)
    void session.refresh()
    return () => session.dispose()
  }, [session, host.ai])
  useLayoutEffect(() => { session.setInitialText(initialText) }, [session, initialText])

  const bound = session.matches(host.ai) && session.matchesInitialText(initialText)
  const provider = snapshot.providers.find((item) => item.id === snapshot.providerId)
  const model = provider?.agents.find((item) => item.id === snapshot.agentId)
  const readiness = bound ? snapshot.readiness : { status: 'checking', reason: 'checking', result: undefined }
  const providerName = provider?.name || readiness.result?.providerName || snapshot.providerId
  const modelName = model?.name || readiness.result?.agentName || snapshot.agentId
  const providerOptions = keepSelection([
    { value: '', label: t('selection.chooseProvider') },
    ...snapshot.providers.map((item) => ({ value: item.id, label: `${item.name} · ${t(`providerStatus.${item.status}`)}` })),
  ], snapshot.providerId, t('selection.unavailable', { value: snapshot.providerId }))
  const modelOptions = keepSelection([
    { value: '', label: t('selection.chooseModel') },
    ...(provider?.agents ?? []).map((item) => ({ value: item.id, label: item.name })),
  ], snapshot.agentId, t('selection.unavailable', { value: snapshot.agentId }))
  const canUseOutput = bound && session.canUseOutput(snapshot)
  const generating = snapshot.phase === 'running'

  const openAiSettings = async () => {
    if (!host.openAppSettings || settingsVisit.current || !mounted.current) return
    const visit = {}
    settingsVisit.current = visit
    session.suspend()
    try {
      await host.openAppSettings({ section: 'ai' })
    } catch (error) {
      if (mounted.current && settingsVisit.current === visit && !(error instanceof Error && error.name === 'AbortError')) host.showMessage(t('error.openSettings'), 'error')
    } finally {
      if (mounted.current && settingsVisit.current === visit) {
        settingsVisit.current = null
        await session.resume()
      }
    }
  }

  const useOutput = (action: 'copy' | 'continue') => {
    if (!bound) return
    void session.useOutput(action, snapshot, host, {
      copied: t('toast.copied'), copyFailed: t('toast.copyFailed'), continueFailed: t('toast.continueFailed'),
    })
  }
  const leave = (back: boolean) => {
    session.dispose()
    settingsVisit.current = null
    if (back) host.requestBack()
    else host.close()
  }

  return (
    <section className="ai-summary-surface" aria-label={t('surface.title')} data-no-drag>
      <header className="ai-summary-header">
        <IconButton type="button" label={t('action.back')} onClick={() => leave(true)}><BackIcon size={14} /></IconButton>
        <strong>{t('surface.title')}</strong>
        <span className="ai-summary-spacer" />
        <IconButton type="button" label={t('action.close')} onClick={() => leave(false)}><CloseIcon size={14} /></IconButton>
      </header>

      <div className="ai-summary-controls">
        <label><span>{t('selection.provider')}</span><Select value={snapshot.providerId} options={providerOptions} disabled={snapshot.suspended} aria-label={t('selection.provider')} onChange={(event) => session.setSelection(event.currentTarget.value, '')} /></label>
        <label><span>{t('selection.model')}</span><Select value={snapshot.agentId} options={modelOptions} disabled={!snapshot.providerId || snapshot.suspended} aria-label={t('selection.model')} onChange={(event) => session.setSelection(snapshot.providerId, event.currentTarget.value)} /></label>
        <label className="ai-summary-points"><span>{t('selection.points')}</span><Select value={String(snapshot.maxPoints)} options={SUMMARY_POINT_LIMITS.map((value) => ({ value: String(value), label: t('selection.pointLimit', { count: value }) }))} disabled={snapshot.suspended} aria-label={t('selection.points')} onChange={(event) => session.setMaxPoints(Number(event.currentTarget.value) as SummaryPointLimit)} /></label>
      </div>

      <div className="ai-summary-readiness" role="status" aria-live="polite" aria-busy={readiness.status === 'checking'} data-state={readiness.status}>
        <div className="ai-summary-readiness-text">
          {snapshot.providerId && snapshot.agentId && <strong>{t('selection.destination', { provider: `${providerName} (${snapshot.providerId})`, model: `${modelName} (${snapshot.agentId})` })}</strong>}
          <span>{t(`readiness.${readiness.reason}`)}</span>
          {readiness.result?.message && readiness.status !== 'ready' && <details><summary>{t('readiness.diagnostic')}</summary><p>{readiness.result.message}</p></details>}
        </div>
        <div className="ai-summary-readiness-actions">
          <Button type="button" disabled={readiness.status === 'checking' || snapshot.suspended} onClick={() => void session.refresh(true)}>{t('action.recheck')}</Button>
          {host.openAppSettings && <Button type="button" disabled={snapshot.suspended} onClick={() => void openAiSettings()}>{t('action.aiSettings')}</Button>}
          {readiness.reason === 'permission_denied' && <Button type="button" onClick={() => { void session.refresh(); host.openSettings({ preserveSurface: true }) }}>{t('action.pluginPermissions')}</Button>}
        </div>
      </div>

      <p className="ai-summary-explanation">{t('surface.sendHint')} {t('surface.outputHint')}</p>

      <main className="ai-summary-editors">
        <section className="ai-summary-pane">
          <div className="ai-summary-pane-header"><strong>{t('pane.source')}</strong><span>{t('meta.characters', { count: Array.from(snapshot.text).length })}</span></div>
          <textarea data-plugin-surface-autofocus data-launcher-scrollable value={snapshot.text} disabled={snapshot.suspended} aria-label={t('pane.source')} placeholder={t('input.placeholder')} spellCheck={false} onChange={(event) => session.setText(event.currentTarget.value)} />
        </section>
        <section className="ai-summary-pane ai-summary-pane-output">
          <div className="ai-summary-pane-header"><strong>{t('pane.summary')}</strong>{snapshot.preview && snapshot.phase !== 'success' && <span>{t('pane.incomplete')}</span>}</div>
          <textarea data-launcher-scrollable value={snapshot.preview} aria-label={t('pane.summary')} aria-busy={generating} placeholder={t('output.placeholder')} readOnly spellCheck={false} />
        </section>
      </main>

      <footer className="ai-summary-footer">
        <div className="ai-summary-status" role={snapshot.phase === 'error' ? 'alert' : 'status'}>
          <span>{snapshot.suspended ? t('status.settings') : snapshot.phase === 'error' ? t(`error.${snapshot.errorCode ?? 'provider'}`) : t(`status.${snapshot.phase}`)}</span>
          {snapshot.errorDetail && <details><summary>{t('readiness.diagnostic')}</summary><p>{snapshot.errorDetail}</p></details>}
        </div>
        <div className="ai-summary-actions">
          {generating ? <Button type="button" variant="danger" onClick={() => session.stop()}>{t('action.stop')}</Button> : <Button type="button" variant="primary" disabled={!bound || !session.canGenerate(snapshot)} onClick={() => void session.generate(snapshot)}>{t(readiness.status === 'unknown' ? 'action.tryGenerate' : 'action.generate')}</Button>}
          <Button type="button" disabled={!canUseOutput} onClick={() => useOutput('copy')}>{t('action.copy')}</Button>
          <Button type="button" disabled={!canUseOutput} onClick={() => useOutput('continue')}>{t('action.continue')}</Button>
        </div>
      </footer>
    </section>
  )
}
