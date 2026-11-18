import { useMemo, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, CopyIconButton, IconButton, SearchField, TextArea, TextInput, SurfaceError } from '@hiven/plugin-ui'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { addUrlParameter, editUrlParameter, parseUrlQuery, removeUrlParameter, UrlQueryError } from './urlQueryCore'

type Props = Pick<PluginSurfaceProps, 'host'> & { value: string; onChange: (value: string) => void; t: PluginSurfaceProps['t']; disabled?: boolean }
export function UrlQueryEditor({ host, value, onChange, t, disabled }: Props) {
  const [search, setSearch] = useState('')
  const parsed = useMemo(() => {
    try { return { value: parseUrlQuery(value), error: null } }
    catch (error) { return { value: null, error: error instanceof UrlQueryError ? error.code : 'urlRequired' } }
  }, [value])
  const [failure, setFailure] = useState<{ source: string; code: string } | null>(null)
  const needle = search.trim().toLocaleLowerCase()
  const parameters = parsed.value?.parameters
    .map((parameter, index) => ({ parameter, index }))
    .filter(({ parameter }) => !needle || parameter.key.toLocaleLowerCase().includes(needle) || parameter.value.toLocaleLowerCase().includes(needle)) ?? []
  const update = (change: () => string) => {
    try { const next = change(); setFailure(null); onChange(next) }
    catch (error) { setFailure({ source: value, code: error instanceof UrlQueryError ? error.code : 'urlInvalidText' }) }
  }
  const copy = async (text: string) => {
    try { await host.clipboard.writeText(text); host.showMessage(t('urlQuery.copied'), 'success') }
    catch (error) { host.showMessage(t('urlQuery.copyFailed'), 'error'); throw error }
  }
  return (
    <div className="jt-url-query">
      <SurfaceError>{failure?.source === value ? t(`error.${failure.code}`) : value && !parsed.value ? t(`error.${parsed.error}`) : null}</SurfaceError>
      {parsed.value && (
        <section aria-label={t('urlQuery.parameters', { count: parsed.value.parameters.length })}>
          <div className="jt-url-query-toolbar">
            <h2>{t('urlQuery.parameters', { count: parsed.value.parameters.length })}</h2>
            <SearchField className="jt-url-query-search" value={search} aria-label={t('urlQuery.search')} placeholder={t('urlQuery.search')} onChange={(event) => setSearch(event.currentTarget.value)} />
          </div>
          <div className="jt-url-query-table" data-launcher-scrollable>
            <div className="jt-url-query-columns" aria-hidden="true">
              <span />
              <span>{t('urlQuery.nameColumn')}</span>
              <span>{t('urlQuery.valueColumn')}</span>
              <span />
            </div>
            <div className="jt-url-query-rows">
              {parameters.map(({ parameter, index }) => (
                <div className="jt-url-query-row" key={index}>
                  <span className="jt-url-query-index" aria-hidden="true">{index + 1}</span>
                  <TextInput value={parameter.key} disabled={disabled} aria-label={t('urlQuery.key', { index: index + 1 })} placeholder={t('urlQuery.keyPlaceholder')} onChange={(event) => update(() => editUrlParameter(value, index, 'key', event.currentTarget.value))} />
                  <TextArea className="jt-url-query-value" rows={1} value={parameter.value} disabled={disabled} aria-label={t('urlQuery.value', { index: index + 1 })} placeholder={t(parameter.hasEquals ? 'urlQuery.emptyValue' : 'urlQuery.noEquals')} onChange={(event) => update(() => editUrlParameter(value, index, 'value', event.currentTarget.value))} />
                  <div className="jt-url-query-actions">
                    <CopyIconButton label={t('urlQuery.copy', { index: index + 1 })} copy={() => copy(parameter.raw)} />
                    <IconButton type="button" className="jt-url-query-remove" disabled={disabled} label={t('urlQuery.remove', { index: index + 1 })} onClick={() => update(() => removeUrlParameter(value, index))}><Trash2Icon size={14} /></IconButton>
                  </div>
                  {!parameter.validEncoding ? <span className="jt-url-query-encoding">{t('urlQuery.invalidEncoding')}</span> : null}
                </div>
              ))}
              {parameters.length === 0 ? <p className="jt-url-query-empty">{t(needle ? 'urlQuery.noMatches' : 'urlQuery.empty')}</p> : null}
            </div>
          </div>
          <Button className="jt-url-query-add" type="button" variant="ghost" disabled={disabled} onClick={() => update(() => addUrlParameter(value))}><PlusIcon size={14} />{t('urlQuery.add')}</Button>
        </section>
      )}
    </div>
  )
}
