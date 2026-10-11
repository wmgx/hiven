import { useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button } from '@hiven/plugin-ui'
import type { CandidateInput } from './aiCandidate'
import type { AiCandidateState } from './aiCandidateSession'

type Props = Pick<PluginSurfaceProps, 'host' | 't'> & {
  state: AiCandidateState
  invalidate(): void
  generate(input: CandidateInput): void
  cancel(): void
  adopt(): void
}

// Lines are literal test strings, never evaluated as source code.
const examples = (value: string) => value === '' ? [] : value.split('\n')

export function AiCandidateControls({ host, t, state, invalidate, generate, cancel, adopt }: Props) {
  const [description, setDescription] = useState('')
  const [positive, setPositive] = useState('')
  const [negative, setNegative] = useState('')
  const [settingsBusy, setSettingsBusy] = useState(false)
  const settingsVisit = useRef(false)
  const busy = ['checking', 'generating', 'validating'].includes(state.status)
  const openSettings = async () => {
    if (!host.openAppSettings || settingsVisit.current) return
    invalidate()
    settingsVisit.current = true
    setSettingsBusy(true)
    try { await host.openAppSettings({ section: 'ai' }) }
    catch { host.showMessage(t('ai.settingsFailed'), 'error') }
    finally { settingsVisit.current = false; setSettingsBusy(false) }
  }
  return <details className="regex-ai">
    <summary>{t('ai.title')}</summary>
    <div className="regex-ai__form">
      <p>{t('ai.disclosure')}</p>
      <label className="regex-ai__description"><span>{t('ai.description')}</span>
        <textarea rows={2} value={description} onChange={(e) => { invalidate(); setDescription(e.target.value) }} />
      </label>
      <div className="regex-ai__examples">
        <label><span>{t('ai.positive')}</span><textarea rows={2} value={positive} onChange={(e) => { invalidate(); setPositive(e.target.value) }} /></label>
        <label><span>{t('ai.negative')}</span><textarea rows={2} value={negative} onChange={(e) => { invalidate(); setNegative(e.target.value) }} /></label>
      </div>
      <div className="regex-ai__actions">
        <Button type="button" disabled={busy || settingsBusy || !description.trim()} onClick={() => generate({ description, positiveExamples: examples(positive), negativeExamples: examples(negative) })}>{t('ai.generate')}</Button>
        {busy && <Button type="button" onClick={cancel}>{t('ai.cancel')}</Button>}
        {host.openAppSettings && <Button type="button" disabled={settingsBusy} onClick={() => void openSettings()}>{t('ai.settings')}</Button>}
      </div>
      <div className="regex-ai__status" role={state.status === 'failed' ? 'alert' : 'status'} aria-live="polite">
        {state.status !== 'idle' && <p>{t(state.status === 'failed' ? `ai.failure.${state.reason}` : `ai.status.${state.status}`)}</p>}
        {state.candidate && <>
          <label><span>{t('ai.candidate')}</span><textarea rows={2} readOnly value={`/${state.candidate.pattern}/${state.candidate.flags}`} /></label>
          {state.validation?.filter((item) => !item.passed).map((item) => <p key={`${item.kind}:${item.index}`}>{t(`ai.failed.${item.kind}`, { index: item.index + 1 })}</p>)}
          <Button type="button" disabled={state.status !== 'ready' || settingsBusy} onClick={adopt}>{t('ai.adopt')}</Button>
        </>}
      </div>
    </div>
  </details>
}
