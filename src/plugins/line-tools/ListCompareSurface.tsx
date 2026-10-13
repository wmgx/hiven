import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, Checkbox, IconButton } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
import { compareLists, MAX_LIST_LINES, type ListCategory, type ListComparison } from './compareLists'
import './listCompare.css'

export function ListCompareSurface({ host, t, initialText = '' }: PluginSurfaceProps) {
  const [left, setLeft] = useState(initialText)
  const [right, setRight] = useState('')
  const [ignoreCase, setIgnoreCase] = useState(false)
  const [trim, setTrim] = useState(false)
  const [, setEpoch] = useState(0)
  const [copying, setCopying] = useState(false)
  const [status, setStatus] = useState('')
  const pending = useRef<AbortController | null>(null)
  const revision = useRef(0)
  const active = useRef(true)
  const result = useMemo<ListComparison>(() => {
    try { return compareLists(left, right, { ignoreCase, trim }) }
    catch { return { ok: false, reason: 'failed' } }
  }, [left, right, ignoreCase, trim])
  const snapshot = useRef(result); snapshot.current = result
  const revoke = () => { revision.current++; pending.current?.abort(); if (active.current) setEpoch(revision.current) }
  const update = (change: () => void) => { revoke(); setStatus(''); change() }
  useLayoutEffect(() => { host.setUnsavedChanges?.(left !== initialText || !!right || ignoreCase || trim) }, [host.setUnsavedChanges, initialText, left, right, ignoreCase, trim])
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
      if (current()) setStatus('compare.copied')
    } catch { if (current()) setStatus('compare.copyFailed') }
    finally { if (pending.current === controller) pending.current = null; if (active.current) { setCopying(false); if (!current()) setStatus('') } }
  }
  return <section className="list-compare" aria-label={t('compare.title')}>
    <header><IconButton label={t('compare.back')} onClick={() => { revoke(); host.requestBack() }}><BackIcon size={14} /></IconButton><strong>{t('compare.title')}</strong><IconButton label={t('compare.close')} onClick={() => { revoke(); host.close() }}><CloseIcon size={14} /></IconButton></header>
    <div className="list-compare-options">
      <Checkbox checked={ignoreCase} onChange={() => update(() => setIgnoreCase(!ignoreCase))}>{t('compare.ignoreCase')}</Checkbox>
      <Checkbox checked={trim} onChange={() => update(() => setTrim(!trim))}>{t('compare.trim')}</Checkbox>
      <details><summary>{t('compare.rules')}</summary><p>{t('compare.rulesText', { limit: MAX_LIST_LINES })}</p></details>
    </div>
    <div className="list-compare-inputs">
      {(['left', 'right'] as const).map(side => <label key={side}><span>{t(`compare.${side}`)}</span><textarea aria-label={t(`compare.${side}`)} autoFocus={side === 'left'} value={side === 'left' ? left : right} spellCheck={false} onChange={event => update(() => (side === 'left' ? setLeft : setRight)(event.target.value))} /></label>)}
    </div>
    {!result.ok ? <p role="alert">{t(`compare.error.${result.reason}`, { limit: MAX_LIST_LINES })}</p> : null}
    <div className="list-compare-results">
      {(['leftOnly', 'common', 'rightOnly'] as const).map(category => <section key={category}>
        <div><strong>{t(`compare.${category}`)} <span>{result.ok ? result.values[category].length : '—'}</span></strong><Button disabled={copying || !result.ok || !result.values[category].length} aria-label={t(`compare.copy.${category}`)} onClick={() => void copy(category)}>{t('compare.copy')}</Button></div>
        <textarea readOnly spellCheck={false} aria-label={t(`compare.${category}`)} value={result.ok ? result.values[category].join('\n') : ''} placeholder={t('compare.empty')} />
      </section>)}
    </div>
    <footer><span role="status" aria-live="polite">{status ? t(status) : ''}</span>{result.ok && (result.ignored.left + result.ignored.right + result.duplicates.left + result.duplicates.right > 0) ? <span>{t('compare.excluded', { leftBlank: result.ignored.left, rightBlank: result.ignored.right, leftDup: result.duplicates.left, rightDup: result.duplicates.right })}</span> : null}</footer>
  </section>
}
