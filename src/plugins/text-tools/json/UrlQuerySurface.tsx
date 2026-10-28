import { useEffect, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { TextInput, SurfaceHeaderField, ActionBar } from '@hiven/plugin-ui'
import { UrlQueryEditor } from './UrlQueryEditor'
import { parseUrlQuery } from './urlQueryCore'

export function UrlQuerySurface({ host, t, initialText }: PluginSurfaceProps) {
  const clipboard = useRef(host.clipboard).current
  const [value, setValue] = useState(initialText ?? '')
  useEffect(() => {
    let live = true
    if (!initialText) void clipboard.readText().then(text => { try { parseUrlQuery(text); if (live) setValue(previous => previous || text) } catch { /* Ignore a clipboard that is not a URL. */ } }).catch(() => {})
    return () => { live = false }
  }, [clipboard, initialText])
  const reportUnsavedChanges = host.setUnsavedChanges
  useEffect(() => {
    reportUnsavedChanges?.(value !== (initialText ?? ''))
  }, [reportUnsavedChanges, value, initialText])
  useEffect(() => () => reportUnsavedChanges?.(false), [reportUnsavedChanges])
  let output = ''
  try { parseUrlQuery(value); output = value } catch { /* The editor displays validation errors. */ }
  return <section className="url-query-surface">
    <SurfaceHeaderField><TextInput data-plugin-surface-autofocus="sticky" value={value} onChange={event => setValue(event.currentTarget.value)} aria-label={t('urlQuery.url')} placeholder={t('urlQuery.url')} autoFocus /></SurfaceHeaderField>
    <UrlQueryEditor host={host} value={value} onChange={setValue} t={t} />
    <ActionBar>{host.OutputActions && <host.OutputActions text={output} />}</ActionBar>
  </section>
}
