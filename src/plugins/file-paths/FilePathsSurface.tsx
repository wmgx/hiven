import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, IconButton, useToolDeliveryFeedback } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
import { PathTransformError, transformPaths, type PathFormat, type PathStyle } from './core'

export function FilePathsSurface({ host, t, initialText = '' }: PluginSurfaceProps) {
  const [source, setSource] = useState(initialText)
  const [base, setBase] = useState('')
  const [format, setFormat] = useState<PathFormat>('posix')
  const [style, setStyle] = useState<PathStyle>('auto')
  const [busy, setBusy] = useState(false)
  const writing = useRef(false)
  const mounted = useRef(true)
  const result = useMemo(() => {
    try { return { output: transformPaths(source, format, base, style), error: '' } }
    catch (error) { return { output: '', error: error instanceof PathTransformError ? error.code : 'invalid' } }
  }, [source, format, base, style])
  const feedback = useToolDeliveryFeedback(result, host.deliveryFeedbackOwner)
  const status = result.error && result.error !== 'empty' ? t(`error.${result.error}`) : feedback.feedback?.message
  useLayoutEffect(() => { host.setUnsavedChanges?.(source !== initialText || base !== '') }, [host.setUnsavedChanges, source, initialText, base])
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const update = (action: () => void) => { feedback.invalidate(); action() }
  const copy = async () => {
    if (writing.current || result.error) return
    const attempt = feedback.beginAttempt()
    if (!attempt.isCurrent()) return
    writing.current = true; setBusy(true)
    try {
      await host.clipboard.writeText(result.output)
      if (mounted.current && attempt.isCurrent()) {
        feedback.invalidate()
        host.showMessage(t('copied'), 'success')
      }
    } catch { if (mounted.current && attempt.isCurrent()) attempt.reportError(t('copyFailed')) }
    finally { writing.current = false; if (mounted.current) setBusy(false) }
  }
  return <section className="file-paths-surface" data-no-drag aria-label={t('title')}>
    <header>
      <IconButton label={t('back')} onClick={() => update(() => host.requestBack())}><BackIcon size={14} /></IconButton>
      <strong>{t('title')}</strong>
      <IconButton label={t('close')} onClick={() => update(() => host.close())}><CloseIcon size={14} /></IconButton>
    </header>
    <nav aria-label={t('formatLabel')}><span>{t('formatLabel')}</span>{(['posix', 'uri', 'relative', 'name'] as PathFormat[]).map((item) =>
      <button type="button" key={item} aria-pressed={format === item} onClick={() => update(() => setFormat(item))}>{t(`format.${item}`)}</button>)}</nav>
    <nav aria-label={t('styleLabel')}><span>{t('styleLabel')}</span>{(['auto', 'unix', 'windows'] as PathStyle[]).map((item) =>
      <button type="button" key={item} aria-pressed={style === item} onClick={() => update(() => setStyle(item))}>{t(`style.${item}`)}</button>)}</nav>
    {format === 'relative' && <label>{t('base')}<input aria-label={t('base')} value={base} onChange={(event) => update(() => setBase(event.target.value))} /><small>{t('baseHint')}</small></label>}
    <div className="file-paths-editors">
      <label>{t('source')}<textarea aria-label={t('source')} placeholder={t('sourcePlaceholder')} spellCheck={false} value={source} onChange={(event) => update(() => setSource(event.target.value))} /></label>
      <label>{t('output')}<textarea aria-label={t('output')} spellCheck={false} readOnly value={result.output} /></label>
    </div>
    {status && <div role="status" aria-live="polite">{status}</div>}
    <footer>
      <details className="file-paths-help">
        <summary>{t('help')}</summary>
        <p>{t('sourceHint')}</p>
        <p>{t('lexicalHint')}</p>
      </details>
      <Button disabled={busy || Boolean(result.error)} onClick={() => void copy()}>{t(busy ? 'copying' : 'copy')}</Button></footer>
  </section>
}
