import { useEffect, useRef, useState } from 'react'
import type { AiPreflightResult, PluginSurfaceProps } from '@hiven/plugin'
import { Button, TextArea, useLocalEscapeLayer } from '@hiven/plugin-ui'
import type { CandidateInput } from './aiCandidate'
import type { AiCandidateState } from './aiCandidateSession'

type Props = Pick<PluginSurfaceProps, 'host' | 't'> & {
  open: boolean; close(): void
  state: AiCandidateState
  invalidate(): void
  generate(input: CandidateInput, selection?: AiPreflightResult): void
  cancel(): void
  adopt(): void
}

// Lines are literal test strings, never evaluated as source code.
const examples = (value: string) => value === '' ? [] : value.split('\n')

export function AiCandidateControls({ host, t, open, close, state, invalidate, generate, cancel, adopt }: Props) {
  const [description, setDescription] = useState('')
  const [positive, setPositive] = useState('')
  const [negative, setNegative] = useState('')
  const [asking, setAsking] = useState(false)
  const request = useRef(0)
  const panel = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  useEffect(() => { if (open) panel.current?.querySelector('textarea')?.focus() }, [open])
  useLocalEscapeLayer({ open, composingRef: composing, popupRef: panel, triggerRef: panel, owner: host.deliveryFeedbackOwner, onDismiss: () => { request.current++; setAsking(false); close() } })
  const gate = host.aiSendGate
  const busy = asking || ['checking', 'generating', 'validating'].includes(state.status)
  const send = async () => {
    if (!gate) return
    const input = { description, positiveExamples: examples(positive), negativeExamples: examples(negative) }
    const token = ++request.current
    setAsking(true)
    const approved = await gate.request({ commandId: 'generate', label: t('ai.title'), text: input.description, extras: [positive, negative] })
    if (token !== request.current) return
    setAsking(false)
    if (!approved) { panel.current?.querySelector('textarea')?.focus(); return }
    generate(input, approved.selection)
  }
  const edit = () => { request.current++; setAsking(false); invalidate() }
  return <div onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} hidden={!open} ref={panel} tabIndex={-1} className="regex-ai">
    <Button onClick={() => { request.current++; setAsking(false); close() }}>{t('ai.cancel')}</Button>
    <div className="regex-ai__form">
      <label className="regex-ai__description"><span>{t('ai.description')}</span>
        <TextArea rows={2} value={description} onChange={(e) => { edit(); setDescription(e.target.value) }} />
      </label>
      <div className="regex-ai__examples">
        <label><span>{t('ai.positive')}</span><TextArea rows={2} value={positive} onChange={(e) => { edit(); setPositive(e.target.value) }} /></label>
        <label><span>{t('ai.negative')}</span><TextArea rows={2} value={negative} onChange={(e) => { edit(); setNegative(e.target.value) }} /></label>
      </div>
      <div className="regex-ai__actions">
        <Button type="button" disabled={!gate || busy || !description.trim()} onClick={() => void send()}>{t('ai.generate')}</Button>
        {busy && !asking && <Button type="button" onClick={cancel}>{t('ai.cancel')}</Button>}
      </div>
      {gate && <gate.Disclosure request={{ commandId: 'generate', label: t('ai.title'), text: description, extras: [positive, negative] }} />}
      <div className="regex-ai__status" role={state.status === 'failed' ? 'alert' : 'status'} aria-live="polite">
        {state.status !== 'idle' && state.status !== 'ready' && <p>{t(state.status === 'failed' ? `ai.failure.${state.reason}` : `ai.status.${state.status}`)}</p>}
        {state.candidate && <>
          <label><span>{t('ai.candidate')}</span><TextArea rows={2} readOnly value={`/${state.candidate.pattern}/${state.candidate.flags}`} /></label>
          {state.validation?.filter((item) => !item.passed).map((item) => <p key={`${item.kind}:${item.index}`}>{t(`ai.failed.${item.kind}`, { index: item.index + 1 })}</p>)}
          <Button type="button" disabled={state.status !== 'ready'} onClick={adopt}>{t('ai.adopt')}</Button>
        </>}
      </div>
    </div>
  </div>
}
