import { useLayoutEffect, useMemo, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { IconButton } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
import { CurlParseError, parseCurl } from './core'

export function CurlInspector({ host, t }: PluginSurfaceProps) {
  // Deliberately ignore initialText: a curl command belongs here, never in a launcher query.
  const [source, setSource] = useState('')
  const reportUnsavedChanges = host.setUnsavedChanges
  useLayoutEffect(() => {
    reportUnsavedChanges?.(source.length > 0)
  }, [source, reportUnsavedChanges])
  const [visible, setVisible] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState('')
  const result = useMemo(() => {
    if (!source.trim()) return null
    try { return { request: parseCurl(source) } }
    catch (error) { return { error: error instanceof CurlParseError ? error.code : 'option' } }
  }, [source])
  const toggle = (id: string) => setVisible((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const copy = async (text: string) => {
    try { await host.clipboard.writeText(text, { recordInHistory: false }); setStatus(t('copy.ok')) }
    catch { setStatus(t('copy.failed')) }
  }
  const field = (id: string, label: string, value: string, secret = true) => <div className="curl-field" key={id}>
    <div className="curl-field-heading"><span>{label}</span><div>
      {secret && <button type="button" aria-label={t(visible.has(id) ? 'hide.part' : 'show.part', { part: label })} onClick={() => toggle(id)}>{t(visible.has(id) ? 'hide' : 'show')}</button>}
      <button type="button" aria-label={t('copy.part', { part: label })} onClick={() => void copy(value)}>{t(secret ? 'copy.full' : 'copy')}</button>
    </div></div>
    <pre tabIndex={0} aria-label={label}>{secret && !visible.has(id) ? t('masked') : value}</pre>
  </div>
  return <div className="curl-inspector" onCopy={(event) => {
    event.preventDefault()
    const target = event.target
    const text = target instanceof HTMLTextAreaElement
      ? target.value.slice(target.selectionStart, target.selectionEnd)
      : window.getSelection()?.toString() ?? ''
    if (text) void copy(text)
  }} onCut={(event) => { event.preventDefault(); setStatus(t('cut.hint')) }}>
    <header className="curl-header">
      <IconButton type="button" label={t('back')} onClick={() => host.requestBack()}><BackIcon size={14} strokeWidth={2} /></IconButton>
      <h2>{t('title')}</h2>
      <IconButton type="button" label={t('close')} onClick={() => host.close()}><CloseIcon size={14} strokeWidth={2} /></IconButton>
    </header>
    <p>{t('privacy')}</p>
    <label htmlFor="curl-source">{t('source')}</label>
    <div className="curl-source-actions">
      <button type="button" onClick={() => toggle('source')}>{t(visible.has('source') ? 'hide.source' : 'show.source')}</button>
      <button type="button" disabled={!source} onClick={() => void copy(source)}>{t('copy.source')}</button>
      <button type="button" disabled={!source} onClick={() => { setSource(''); setVisible(new Set()); setStatus('') }}>{t('clear')}</button>
    </div>
    <textarea id="curl-source" className={visible.has('source') ? '' : 'curl-source-masked'} value={source} spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off" rows={4}
      aria-describedby="curl-hint" onChange={(event) => { setSource(event.target.value); setVisible((old) => old.has('source') ? new Set(['source']) : new Set()); setStatus('') }} />
    <p id="curl-hint">{t('hint')}</p>
    {result?.error && <p className="curl-error" role="alert">{t(`error.${result.error}`)}</p>}
    {result?.request && <section aria-label={t('parsed')}>
      {field('method', t('method'), result.request.method, false)}
      {field('url', t('url'), result.request.url)}
      <h3>{t('headers')}</h3><p>{t('headers.hint')}</p>
      {result.request.headers.length ? result.request.headers.map((header, index) => field(`header-${index}`, header.name, header.value)) : <p>{t('headers.empty')}</p>}
      {result.request.body !== null ? field('body', t('body'), result.request.body) : <p>{t('body.empty')}</p>}
    </section>}
    <div className="curl-status" role="status" aria-live="polite">{status}</div>
  </div>
}
