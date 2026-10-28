import { useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { ActionBar, SurfaceHeaderField, SurfaceHeaderActions, SurfaceStatus, SurfaceError, ValueChip, RowList, TextInput } from '@hiven/plugin-ui'
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
  const [input, setInput] = useState(initialText?.trim() || '')
  const [offset, setOffset] = useState(defaultOffset)
  const [selected, setSelected] = useState('datetime')
  const selectedRef = useRef(selected)
  const primary = useRef<HTMLButtonElement>(null)
  const result = useMemo(() => convert(input.trim() || t('surface.nowValue'), offset), [convert, input, offset, t])

  const values = result.ok ? [
    { key: 'datetime', label: t('surface.dateTime'), unit: result.value.offsetLabel, value: result.value.dateTime },
    { key: 'seconds', label: t('surface.unixSeconds'), unit: t('surface.secondsUnit'), value: result.value.unixSeconds },
    { key: 'milliseconds', label: t('surface.unixMilliseconds'), unit: t('surface.millisecondsUnit'), value: result.value.unixMilliseconds },
  ] : []

  const select = (id: string) => { selectedRef.current = id; setSelected(id) }
  const value = () => values.find(item => item.key === selectedRef.current)?.value ?? ''
  return <section className="date-time-surface" aria-label={t('surface.title')}>
    <SurfaceHeaderField><TextInput value={input} onChange={event => setInput(event.target.value)} aria-label={t('surface.input')}
      placeholder={t('surface.nowValue')} autoFocus data-plugin-surface-autofocus="sticky" autoComplete="off" spellCheck={false}
      onKeyDown={event => { if (event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); event.currentTarget.closest('.surface-chrome-header')?.querySelector<HTMLButtonElement>('[data-value-chip]')?.click() } }} /></SurfaceHeaderField>
    <SurfaceHeaderActions><ValueChip label={t('surface.offset')} value={offset} custom="text"
      options={['UTC','UTC+08:00','UTC+09:00','UTC-05:00'].map(value => ({ value, label: value }))}
      onChange={value => setOffset(String(value))} onPreview={value => setOffset(String(value))} /></SurfaceHeaderActions>
    <SurfaceError>{!result.ok && t('surface.invalid')}</SurfaceError>
    <RowList label={t('surface.results')} items={values.map(item => ({ id: item.key, title: item.value, description: `${item.label} · ${item.unit}` }))}
      selectedId={selected} onSelect={select} onActivate={id => { select(id); primary.current?.click() }} />
    <SurfaceStatus>{values.find(item => item.key === selected)?.label}</SurfaceStatus>
    {host.OutputActions && <ActionBar><host.OutputActions primaryRef={primary} text={value} disabled={!result.ok} /></ActionBar>}
  </section>
}
