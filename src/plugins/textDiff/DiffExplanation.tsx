import { useEffect, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { createDiffExplanation, EXPLAIN_LIMIT, type ExplanationState } from './explainDiff'

type Props = Pick<PluginSurfaceProps, 'host' | 't'> & { original: string; modified: string }

/** One optional entry point. Nothing is checked or sent until the user clicks. */
export function DiffExplanation({ host, t, original, modified }: Props) {
  const [state, setState] = useState<ExplanationState>({ status: 'idle' })
  const session = useRef<ReturnType<typeof createDiffExplanation> | undefined>(undefined)
  const preflight = host.ai.preflight

  useEffect(() => {
    const current = createDiffExplanation(host.ai, setState)
    session.current = current
    return () => { current.dispose(); session.current = undefined }
  }, [host.ai])
  useEffect(() => { session.current?.invalidate() }, [original, modified])

  if (!preflight) return null
  const busy = state.status === 'checking' || state.status === 'running'
  const overLimit = original.length + modified.length > EXPLAIN_LIMIT
  const explain = async () => {
    const current = session.current
    if (!current) return
    try {
      const selection = await preflight({ capabilities: ['text.generate'], inputModalities: ['text'] })
      if (session.current !== current) return
      if (selection?.status !== 'ready') { setState({ status: 'failed', reason: 'blocked' }); return }
      void current.generate(original, modified, t('explain.language'), selection)
    } catch {
      if (session.current === current) setState({ status: 'failed', reason: 'blocked' })
    }
  }
  return <div className="td-explanation">
    <div className="td-explanation-actions">
      <button type="button" className="td-nav-b" title={t('explain.privacy')}
        disabled={overLimit || !(original + modified).trim()}
        onClick={() => { if (busy) session.current?.cancel(); else void explain() }}>
        {t(busy ? 'explain.cancel' : 'explain.action')}
      </button>
    </div>
    {state.status !== 'idle' && state.status !== 'cancelled' && <div className="td-explanation-result" role={state.status === 'failed' ? 'alert' : 'status'} aria-live="polite">
      {state.status === 'ready' ? state.text : t(state.status === 'failed' ? `explain.failure.${state.reason}` : `explain.${state.status}`)}
    </div>}
  </div>
}
