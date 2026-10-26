import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AiPreflightResult, PluginSurfaceProps } from '@hiven/plugin'
import { Button, ConfirmDialog, Dialog } from '@hiven/plugin-ui'
import { createDiffExplanation, EXPLAIN_LIMIT, type ExplanationState } from './explainDiff'

type Props = Pick<PluginSurfaceProps, 'host' | 't'> & { original: string; modified: string }

/** Preflight reads configuration; only confirmation can send the captured text. */
export function DiffExplanation({ host, t, original, modified }: Props) {
  const [state, setState] = useState<ExplanationState>({ status: 'idle' })
  const [confirmation, setConfirmation] = useState<{ selection: AiPreflightResult; original: string; modified: string }>()
  const session = useRef<ReturnType<typeof createDiffExplanation> | undefined>(undefined)
  const revision = useRef(0)
  const preflight = host.ai.preflight

  useEffect(() => {
    const current = createDiffExplanation(host.ai, setState)
    session.current = current
    return () => { revision.current++; current.dispose(); session.current = undefined }
  }, [host.ai])
  useLayoutEffect(() => {
    const invalidate = () => { revision.current++; setConfirmation(undefined); session.current?.invalidate() }
    invalidate()
    return host.subscribeLeaveIntent?.(invalidate)
  }, [original, modified, host.subscribeLeaveIntent])

  if (!preflight) return null
  const busy = state.status === 'checking' || state.status === 'running'
  const overLimit = original.length + modified.length > EXPLAIN_LIMIT
  const explain = async () => {
    const current = session.current
    if (!current) return
    const token = ++revision.current
    setState({ status: 'checking' })
    try {
      const selection = await preflight({ capabilities: ['text.generate'], inputModalities: ['text'] })
      if (session.current !== current || token !== revision.current) return
      if (selection?.status !== 'ready' || !selection.providerId || !selection.agentId) { setState({ status: 'failed', reason: 'blocked' }); return }
      setState({ status: 'idle' })
      setConfirmation({ selection, original, modified })
    } catch {
      if (session.current === current && token === revision.current) setState({ status: 'failed', reason: 'blocked' })
    }
  }
  return <>
    <Button title={t(busy ? `explain.${state.status}` : 'explain.privacy')}
      disabled={!busy && (overLimit || !(original + modified).trim())}
      onClick={() => { if (busy) { revision.current++; session.current?.cancel() } else void explain() }}>
      {t(busy ? 'explain.cancel' : 'explain.action')}
    </Button>
    <ConfirmDialog open={!!confirmation} title={t('explain.action')} defaultFocus="cancel"
      message={confirmation ? t('explain.confirmMessage', {
        provider: confirmation.selection.providerName || confirmation.selection.providerId || '',
        model: confirmation.selection.agentName || confirmation.selection.agentId || '',
        count: confirmation.original.length + confirmation.modified.length,
      }) : undefined}
      confirmLabel={t('explain.confirm')} cancelLabel={t('explain.cancel')}
      onCancel={() => setConfirmation(undefined)}
      onConfirm={() => {
        if (!confirmation) return
        setConfirmation(undefined)
        void session.current?.generate(confirmation.original, confirmation.modified, t('explain.language'), confirmation.selection)
      }} />
    <Dialog open={state.status === 'ready' || state.status === 'failed'} title={t('explain.action')}
      onOpenChange={open => { if (!open) session.current?.invalidate() }}>
      <p className="td-explanation-result" role={state.status === 'failed' ? 'alert' : 'status'}>
        {state.status === 'ready' ? state.text : state.status === 'failed' ? t(`explain.failure.${state.reason}`) : ''}
      </p>
      <Button onClick={() => session.current?.invalidate()}>{t('explain.close')}</Button>
    </Dialog>
  </>
}
