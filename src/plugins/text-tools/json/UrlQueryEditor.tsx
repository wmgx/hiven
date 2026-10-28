import { useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, TextInput, SurfaceError } from '@hiven/plugin-ui'
import { addUrlParameter, editUrlParameter, parseUrlQuery, removeUrlParameter, UrlQueryError } from './urlQueryCore'

type Props = Pick<PluginSurfaceProps, 'host'> & { value: string; onChange: (value: string) => void; t: PluginSurfaceProps['t']; disabled?: boolean }
export function UrlQueryEditor({ host, value, onChange, t, disabled }: Props) {
  const current = useRef(value); current.current = value
  const parsed = useMemo(() => {
    try { return { value: parseUrlQuery(value), error: null } }
    catch (error) { return { value: null, error: error instanceof UrlQueryError ? error.code : 'urlRequired' } }
  }, [value])
  const [failure, setFailure] = useState<{ source: string; code: string } | null>(null)
  const update = (change: () => string) => {
    try { const next = change(); setFailure(null); onChange(next) }
    catch (error) { setFailure({ source: value, code: error instanceof UrlQueryError ? error.code : 'urlInvalidText' }) }
  }
  return (
    <div className="jt-url-query">
      <SurfaceError>{failure?.source === value ? t(`error.${failure.code}`) : value && !parsed.value ? t(`error.${parsed.error}`) : null}</SurfaceError>
      {parsed.value && (
        <details open>
          <summary>{t('urlQuery.parameters', { count: parsed.value.parameters.length })}</summary>
          <div className="jt-url-query-rows" data-launcher-scrollable>
            {parsed.value.parameters.map((parameter, index) => (
              <div className="jt-url-query-row" key={index}>
                <span className="jt-url-query-index" aria-hidden="true">{index + 1}</span>
                <TextInput value={parameter.key} disabled={disabled} aria-label={t('urlQuery.key', { index: index + 1 })} placeholder={t('urlQuery.keyPlaceholder')} onChange={(event) => update(() => editUrlParameter(value, index, 'key', event.currentTarget.value))} />
                <TextInput value={parameter.value} disabled={disabled} aria-label={t('urlQuery.value', { index: index + 1 })} placeholder={t(parameter.hasEquals ? 'urlQuery.emptyValue' : 'urlQuery.noEquals')} onChange={(event) => update(() => editUrlParameter(value, index, 'value', event.currentTarget.value))} />
                <Button type="button" variant="ghost" disabled={disabled} aria-label={t('urlQuery.remove', { index: index + 1 })} onClick={() => update(() => { const after = removeUrlParameter(value, index); host.showToast(t('urlQuery.deleted'), 'info', { duration: 5000, action: { label: t('urlQuery.undo'), onClick: () => { if (current.current === after) onChange(value); else host.showMessage(t('urlQuery.changed'), 'error') } } }); return after })}>{t('urlQuery.removeShort')}</Button>
                {!parameter.validEncoding ? <span className="jt-url-query-encoding">{t('urlQuery.invalidEncoding')}</span> : null}
              </div>
            ))}
          </div>
          <Button type="button" variant="ghost" disabled={disabled} onClick={() => update(() => addUrlParameter(value))}>{t('urlQuery.add')}</Button>
        </details>
      )}
    </div>
  )
}
