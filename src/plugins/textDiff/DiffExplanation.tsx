import { useEffect, useRef, useState } from 'react'
import type { AiPreflightResult, PluginSurfaceProps } from '@hiven/plugin'
import { createDiffExplanation, EXPLAIN_LIMIT, type ExplanationState } from './explainDiff'

type Props = Pick<PluginSurfaceProps, 'host' | 't'> & { original: string; modified: string }
export function DiffExplanation({ host, t, original, modified }: Props) {
  const [state, setState] = useState<ExplanationState>({ status: 'idle' })
  const [selection, setSelection] = useState<AiPreflightResult>()
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [checking, setChecking] = useState(true)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const session = useRef<ReturnType<typeof createDiffExplanation> | undefined>(undefined)
  const refresh = useRef<() => void>(() => {})
  const settingsButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let alive = true, check = 0
    const currentSession = createDiffExplanation(host.ai, setState)
    session.current = currentSession
    const update = () => {
      const id = ++check
      setSelection(undefined)
      setPermissionDenied(false)
      setChecking(true)
      currentSession.invalidate()
      void Promise.resolve().then(() => host.ai.preflight?.({ capabilities: ['text.generate'], inputModalities: ['text'] })).then((value) => {
        if (alive && check === id) setSelection(value)
      }).catch((error: unknown) => {
        if (alive && check === id) setPermissionDenied(error instanceof Error && /Plugin permission required: ai\.use/.test(error.message))
      }).finally(() => { if (alive && check === id) setChecking(false) })
    }
    refresh.current = update
    const unsubscribe = host.ai.subscribePreflight?.(update)
    update()
    return () => { alive = false; check++; currentSession.dispose(); unsubscribe?.(); session.current = undefined }
  }, [host.ai])
  useEffect(() => { session.current?.invalidate() }, [original, modified])
  const busy = state.status === 'checking' || state.status === 'running'
  const overLimit = original.length + modified.length > EXPLAIN_LIMIT
  const openSettings = async () => {
    if (!host.openAppSettings || settingsBusy) return
    session.current?.invalidate()
    setSettingsBusy(true)
    try { await host.openAppSettings({ section: 'ai' }) }
    catch { host.showToast(t('explain.settingsFailed'), 'error') }
    finally { setSettingsBusy(false); refresh.current(); settingsButton.current?.focus() }
  }
  return <div className="td-explanation">
    <div className="td-explanation-actions">
      <button type="button" className="td-nav-b" disabled={busy || settingsBusy || overLimit || !(original + modified).trim() || selection?.status !== 'ready'}
        onClick={() => { if (selection) void session.current?.generate(original, modified, t('explain.language'), selection) }}>{t('explain.action')}</button>
      {busy && <button type="button" className="td-nav-b" onClick={() => session.current?.cancel()}>{t('explain.cancel')}</button>}
      <span>{selection?.status === 'ready' ? `${selection.providerName || selection.providerId} · ${selection.agentName || selection.agentId}` : t(checking ? 'explain.checking' : 'explain.unavailable')}</span>
      {host.openAppSettings && <button ref={settingsButton} type="button" className="td-nav-b" disabled={settingsBusy || busy} onClick={() => void openSettings()}>{t('explain.settings')}</button>}
      {permissionDenied && <button type="button" className="td-nav-b" onClick={() => host.openSettings({ preserveSurface: true })}>{t('explain.permissions')}</button>}
      {!checking && !busy && selection?.status !== 'ready' && <button type="button" className="td-nav-b" onClick={() => refresh.current()}>{t('explain.recheck')}</button>}
    </div>
    <div className="td-explanation-hint">{t(overLimit ? 'explain.limits' : original && modified ? 'explain.both' : 'explain.single')}</div>
    {state.status !== 'idle' && <div className="td-explanation-result" role={state.status === 'failed' ? 'alert' : 'status'} aria-live="polite">
      {state.status === 'ready' ? state.text : t(state.status === 'failed' ? `explain.failure.${state.reason}` : `explain.${state.status}`)}
    </div>}
  </div>
}
