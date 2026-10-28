import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, Dialog } from '@hiven/plugin-ui'
import { createDiffExplanation, EXPLAIN_LIMIT, type ExplanationState } from './explainDiff'

type Props = Pick<PluginSurfaceProps, 'host' | 't'> & { original: string; modified: string; children(action?: { id: string; label: ReactNode; disabled: boolean; run(): void }): ReactNode }

/** The host gate checks readiness and confirms; only an approval sends the captured text. */
export function DiffExplanation({ host, t, original, modified, children }: Props) {
  const [state, setState] = useState<ExplanationState>({ status: 'idle' })
  const session = useRef<ReturnType<typeof createDiffExplanation> | undefined>(undefined)
  const revision = useRef(0)
  const gate = host.aiSendGate

  useEffect(() => {
    const current = createDiffExplanation(host.ai, setState)
    session.current = current
    return () => { revision.current++; current.dispose(); session.current = undefined }
  }, [host.ai])
  useLayoutEffect(() => {
    const invalidate = () => { revision.current++; session.current?.invalidate() }
    invalidate()
    return host.subscribeLeaveIntent?.(invalidate)
  }, [original, modified, host.subscribeLeaveIntent])

  if (!gate) return children()
  const busy = state.status === 'checking' || state.status === 'running'
  const overLimit = original.length + modified.length > EXPLAIN_LIMIT
  const explain = async () => {
    const current = session.current
    if (!current) return
    const token = ++revision.current
    const text = { original, modified }
    setState({ status: 'checking' })
    const approved = await gate.request({ commandId: 'explain', label: t('explain.action'), text: text.original, extras: [text.modified] })
    if (session.current !== current || token !== revision.current) return
    if (!approved) { setState({ status: 'idle' }); return }
    void current.generate(text.original, text.modified, t('explain.language'), approved.selection)
  }
  return <>
    {children({ id: 'explain', label: <span>{t(busy ? 'explain.cancel' : 'explain.action')}<gate.Disclosure request={{ commandId: 'explain', label: t('explain.action'), text: original, extras: [modified] }} /></span>,
      disabled: !busy && (overLimit || !(original + modified).trim()),
      run: () => { if (busy) { revision.current++; session.current?.cancel() } else void explain() },
    })}
    <Dialog open={state.status === 'ready' || state.status === 'failed'} title={t('explain.action')}
      onOpenChange={open => { if (!open) session.current?.invalidate() }}>
      <p className="td-explanation-result" role={state.status === 'failed' ? 'alert' : 'status'}>
        {state.status === 'ready' ? state.text : state.status === 'failed' ? t(`explain.failure.${state.reason}`) : ''}
      </p>
      <Button onClick={() => session.current?.invalidate()}>{t('explain.close')}</Button>
    </Dialog>
  </>
}
