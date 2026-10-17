import { useMemo, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { IconButton } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
import { CurlParseError, curlHeaderDisplayLabels, parseCurl } from './core'

export function CurlInspector({ host, t }: PluginSurfaceProps) {
  // Deliberately ignore initialText: a curl command belongs here, never in a launcher query.
  const [source, setSource] = useState('')
  const [status, setStatus] = useState('')
  const result = useMemo(() => {
    if (!source.trim()) return null
    try { return { request: parseCurl(source) } }
    catch (error) { return { error: error instanceof CurlParseError ? error.code : 'option' } }
  }, [source])
  const headerLabels = useMemo(() => result?.request ? curlHeaderDisplayLabels(result.request.headers) : [], [result])
  const copy = async (text: string) => {
    try { await host.clipboard.writeText(text, { recordInHistory: false }); setStatus(t('copy.ok')) }
    catch { setStatus(t('copy.failed')) }
  }
  const field = (id: string, label: string, value: string) => <div className="curl-field" key={id}>
    <div className="curl-field-heading"><span>{label}</span><div>
      <button type="button" aria-label={t('copy.part', { part: label })} onClick={() => void copy(value)}>{t('copy')}</button>
    </div></div>
    <pre tabIndex={0} aria-label={label}>{value}</pre>
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
      <button type="button" disabled={!source} onClick={() => void copy(source)}>{t('copy.source')}</button>
      <button type="button" disabled={!source} onClick={() => { setSource(''); setStatus('') }}>{t('clear')}</button>
    </div>
    <textarea id="curl-source" value={source} spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off" rows={4}
      aria-describedby="curl-hint" onChange={(event) => { setSource(event.target.value); setStatus('') }} />
    <p id="curl-hint">{t('hint')}</p>
    {result?.error && <p className="curl-error" role="alert">{t(`error.${result.error}`)}</p>}
    {result?.request && <section aria-label={t('parsed')}>
      {field('method', t('method'), result.request.method)}
      {field('url', t('url'), result.request.url)}
      <h3>{t('headers')}</h3><p>{t('headers.hint')}</p>
      {result.request.headers.length ? result.request.headers.map((header, index) => field(`header-${index}`, headerLabels[index], header.value)) : <p>{t('headers.empty')}</p>}
      {result.request.body !== null ? field('body', t('body'), result.request.body) : <p>{t('body.empty')}</p>}
    </section>}
    <div className="curl-status" role="status" aria-live="polite">{status}</div>
  </div>
}
