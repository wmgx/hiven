import { useEffect, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { TextInput } from '@hiven/plugin-ui'
import { UrlQueryEditor } from './UrlQueryEditor'
import { parseUrlQuery } from './urlQueryCore'

export function UrlQuerySurface({ host, t, initialText }: PluginSurfaceProps) {
  const [value, setValue] = useState(initialText ?? '')
  const reportUnsavedChanges = host.setUnsavedChanges
  useEffect(() => {
    reportUnsavedChanges?.(value !== (initialText ?? ''))
  }, [reportUnsavedChanges, value, initialText])
  useEffect(() => () => reportUnsavedChanges?.(false), [reportUnsavedChanges])
  let output = ''
  try { parseUrlQuery(value); output = value } catch { /* The editor displays validation errors. */ }
  return <section className="url-query-surface">
    <TextInput value={value} onChange={event => setValue(event.currentTarget.value)} aria-label={t('urlQuery.url')} placeholder={t('urlQuery.url')} autoFocus />
    <UrlQueryEditor value={value} onChange={setValue} t={t} />
    {host.OutputActions && <host.OutputActions text={output} />}
  </section>
}
