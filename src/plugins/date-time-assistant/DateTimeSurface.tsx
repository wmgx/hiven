import { useMemo, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, IconButton, TextInput } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
import './style.css'

export type DateTimeSnapshot = {
  dateTime: string
  unixSeconds: string
  unixMilliseconds: string
  offsetLabel: string
}

export type DateTimeConversionResult =
  | { ok: true; value: DateTimeSnapshot }
  | { ok: false }

type DateTimeSurfaceProps = PluginSurfaceProps & {
  defaultOffset: string
  convert: (input: string, offset: string) => DateTimeConversionResult
}

export function DateTimeSurface({ defaultOffset, host, initialText, t, convert }: DateTimeSurfaceProps) {
  const [input, setInput] = useState(initialText?.trim() || t('surface.nowValue'))
  const [offset, setOffset] = useState(defaultOffset)
  const result = useMemo(() => convert(input, offset), [convert, input, offset])

  const copy = async (value: string) => {
    try {
      await host.clipboard.writeText(value)
      host.showMessage(t('surface.copied'), 'success')
      host.complete()
    } catch {
      host.showMessage(t('surface.copyFailed'), 'error')
    }
  }

  const values = result.ok ? [
    { key: 'datetime', label: t('surface.dateTime'), unit: result.value.offsetLabel, value: result.value.dateTime },
    { key: 'seconds', label: t('surface.unixSeconds'), unit: t('surface.secondsUnit'), value: result.value.unixSeconds },
    { key: 'milliseconds', label: t('surface.unixMilliseconds'), unit: t('surface.millisecondsUnit'), value: result.value.unixMilliseconds },
  ] : []

  return (
    <section className="date-time-surface" aria-label={t('surface.title')} data-no-drag>
      <header className="date-time-surface__header">
        <IconButton type="button" label={t('surface.back')} onClick={() => host.requestBack()}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <strong>{t('surface.title')}</strong>
        <span />
        <IconButton type="button" label={t('surface.close')} onClick={() => host.close()}>
          <CloseIcon size={14} strokeWidth={2} />
        </IconButton>
      </header>

      <main className="date-time-surface__body" data-launcher-scrollable>
        <div className="date-time-surface__intro">
          <strong>{t('surface.heading')}</strong>
          <span>{t('surface.description')}</span>
        </div>

        <div className="date-time-surface__inputs">
          <label className="date-time-surface__input">
            <span>{t('surface.input')}</span>
            <TextInput
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t('surface.inputPlaceholder')}
              autoFocus
              data-plugin-surface-autofocus
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="date-time-surface__offset">
            <span>{t('surface.offset')}</span>
            <TextInput
              value={offset}
              onChange={(event) => setOffset(event.target.value)}
              placeholder={t('surface.offsetPlaceholder')}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <Button type="button" onClick={() => setInput(String(Date.now()))}>{t('surface.useNow')}</Button>
        </div>
        <p className="date-time-surface__hint">{t('surface.offsetHint')}</p>

        <section className="date-time-surface__results" aria-label={t('surface.results')} aria-live="polite">
          {result.ok ? values.map((item) => (
            <div className="date-time-surface__result" key={item.key}>
              <div>
                <strong>{item.label}</strong>
                <span>{item.unit}</span>
              </div>
              <output>{item.value}</output>
              <Button type="button" onClick={() => void copy(item.value)}>{t('surface.copy')}</Button>
            </div>
          )) : (
            <p className="date-time-surface__error" role="alert">
              <strong>{t('surface.invalid')}</strong>
              <span>{t('surface.invalidHint')}</span>
            </p>
          )}
        </section>

        <p className="date-time-surface__examples">{t('surface.examples')}</p>
      </main>
    </section>
  )
}
