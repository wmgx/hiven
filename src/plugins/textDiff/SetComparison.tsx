import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, TextArea } from '@hiven/plugin-ui'
import { compareLists, MAX_LIST_LINES, type ListCategory, type ListComparison } from './compareLists'

type Props = Pick<PluginSurfaceProps, 'host' | 't'> & { left: string; right: string }

export function SetComparison({ host, t, left, right }: Props) {
  const [, setEpoch] = useState(0)
  const [copying, setCopying] = useState(false)
  const [status, setStatus] = useState('')
  const pending = useRef<AbortController | null>(null)
  const revision = useRef(0)
  const active = useRef(true)
  const result = useMemo<ListComparison>(() => {
    try { return compareLists(left, right) }
    catch { return { ok: false, reason: 'failed' } }
  }, [left, right])
  const snapshot = useRef(result); snapshot.current = result
  const revoke = () => { revision.current++; pending.current?.abort(); if (active.current) setEpoch(revision.current) }
  useLayoutEffect(() => { revoke(); setStatus('') }, [left, right])
  useLayoutEffect(() => {
    active.current = true; setEpoch(revision.current)
    const stopOwner = host.deliveryFeedbackOwner?.subscribeInvalidation(revoke)
    const stopLeave = host.subscribeLeaveIntent?.(revoke)
    return () => { active.current = false; revoke(); stopOwner?.(); stopLeave?.() }
  }, [host.deliveryFeedbackOwner, host.subscribeLeaveIntent])
  const renderedRevision = revision.current
  const copy = async (category: ListCategory) => {
    if (!active.current || pending.current || host.deliveryFeedbackOwner?.isCurrent() === false || snapshot.current !== result || renderedRevision !== revision.current || !result.ok || !result.values[category].length) return
    const controller = new AbortController(); pending.current = controller
    const token = revision.current
    const current = () => active.current && token === revision.current && !controller.signal.aborted && host.deliveryFeedbackOwner?.isCurrent() !== false
    setCopying(true); setStatus('compare.copying')
    try {
      await host.clipboard.writeText(result.values[category].join('\n'), { signal: controller.signal })
      if (current()) setStatus('')
    } catch { if (current()) setStatus('compare.copyFailed') }
    finally { if (pending.current === controller) pending.current = null; if (active.current) { setCopying(false); if (!current()) setStatus('') } }
  }
  return <section className="td-set" aria-label={t('diff.setMode')}>
    {!result.ok ? <p role="alert">{t(`compare.error.${result.reason}`, { limit: MAX_LIST_LINES })}</p> : null}
    <div className="td-set-results">
      {(['leftOnly', 'common', 'rightOnly'] as const).map(category => <section key={category}>
        <div><strong>{t(`compare.${category}`)} <span>{result.ok ? result.values[category].length : '—'}</span></strong><Button disabled={copying || !result.ok || !result.values[category].length} aria-label={t(`compare.copy.${category}`)} onClick={() => void copy(category)}>{t('compare.copy')}</Button></div>
        <TextArea readOnly spellCheck={false} aria-label={t(`compare.${category}`)} value={result.ok ? result.values[category].join('\n') : ''} placeholder={t('compare.empty')} />
      </section>)}
    </div>
    <footer><span role="status" aria-live="polite">{status ? t(status) : ''}</span>{result.ok && (result.ignored.left + result.ignored.right + result.duplicates.left + result.duplicates.right > 0) ? <span>{t('compare.excluded', { blank: result.ignored.left + result.ignored.right, dup: result.duplicates.left + result.duplicates.right })}</span> : null}</footer>
  </section>
}
