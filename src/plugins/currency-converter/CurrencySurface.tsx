import { useEffect, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { ActionBar, CommandInput, ShortcutKey, SurfaceActionButton, SurfaceError, SurfaceHeaderActions, SurfaceHeaderField, SurfaceStatus, ValueChip, useShortcuts, useSurfaceActions, type SurfaceActionDefinition } from '@hiven/plugin-ui'
import { convert, defaultTargets, formatConversion, getRates, loadTargets, remember, retainedHistory, saveTargets, HISTORY_KEY, type HistoryEntry, type Rate, type Settings } from './core'
import { MAX_TARGETS, parseAmount, parseQuery } from './parse'
import { currencyFlag, symbols, useCurrencyOptions } from './currencyDisplay'
import './style.css'

type Draft = { amountText: string; from: string; picked: string[] }
type Conversion = NonNullable<ReturnType<typeof convert>>
/** One T1 row: a live result for a target currency, or a saved conversion. */
type Item = { id: string; group: 'results' | 'recent'; code: string; conversion?: Conversion; subtitle: string }
const HISTORY_ROWS = 5

export function CurrencySurface({ host, initialText = '', locale, settings, t }: PluginSurfaceProps<Settings>) {
  const options = useCurrencyOptions(locale)
  const names = new Map(options.map(option => [option.value, option.description]))
  const [query, setQuery] = useState(initialText)
  const [draft, setDraft] = useState(() => mergeQuery({ amountText: '1', from: 'USD', picked: [] }, initialText))
  const [selected, setSelected] = useState<string | undefined>()
  const [targets, setTargets] = useState(defaultTargets)
  const [rates, setRates] = useState<Map<string, Rate> | undefined>()
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState<HistoryEntry[]>([])

  useEffect(() => {
    let active = true
    void loadTargets(host.storage).then((value) => { if (active) setTargets(value) })
    return () => { active = false }
  }, [host.storage])

  useEffect(() => {
    let active = true
    void host.storage.kv.get<HistoryEntry[]>(HISTORY_KEY).then((stored) => {
      if (active) setHistory(retainedHistory(stored ?? [], settings, Date.now()))
    }).catch(() => { if (active) host.showMessage(t('historyReadFailed'), 'warning') })
    return () => { active = false }
  }, [host.storage, settings])

  useEffect(() => {
    let active = true
    void getRates(host.network).then((value) => {
      if (!active) return
      setRates(value)
      setLoading(false)
    })
    return () => { active = false }
  }, [host.network])

  const amount = parseAmount(draft.amountText)
  // Mid-typing ("100 j") keeps the last valid results; the error row only shows after a pause.
  const unrecognized = Boolean(query.trim() && !parseQuery(query))
  const [showError, setShowError] = useState(false)
  useEffect(() => {
    setShowError(false)
    if (!unrecognized) return
    const timer = window.setTimeout(() => setShowError(true), 600)
    return () => window.clearTimeout(timer)
  }, [query, unrecognized])
  // Targets typed in the query come first (temporarily), then the saved list.
  const codes = [...new Set([...draft.picked, ...targets])].filter(code => code !== draft.from)
  const results: Item[] = codes.map((code) => {
    const conversion = amount === null ? undefined : convert(rates, amount, draft.from, code)
    const rate = conversion && formatConversion(conversion, { locale, t }).rate
    return { id: 'r:' + code, group: 'results', code, conversion, subtitle: [names.get(code) ?? code, rate].filter(Boolean).join(' · ') }
  })
  const recent: Item[] = history.slice(0, HISTORY_ROWS).map((entry) => ({
    id: `h:${entry.savedAt}:${entry.from}${entry.to}${entry.amount}`, group: 'recent', code: entry.to, conversion: entry,
    subtitle: `${formatAmount(entry.amount, locale)} ${entry.from} · ${new Date(entry.savedAt).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
  }))
  const items = [...results, ...recent]
  const current = items.find(item => item.id === selected) ?? items[0]
  const date = results.find(item => item.conversion)?.conversion?.date
  const status = loading ? t('loading') : !rates ? t('unavailable') : amount === null ? t('invalidAmount') : date ? t('rateDate', { date }) : ''

  function updateQuery(text: string) {
    setQuery(text)
    const next = mergeQuery(draft, text)
    setDraft(next)
    if (next.picked[0] && next.picked.join() !== draft.picked.join()) setSelected('r:' + next.picked[0])
  }

  function editDraft(next: Draft) {
    setDraft(next)
    setQuery(`${next.amountText} ${next.from}${next.picked.length ? ` to ${next.picked.join(', ')}` : ''}`)
  }

  async function copy(item = current) {
    if (!item?.conversion) return
    try {
      await host.clipboard.writeText(formatConversion(item.conversion, { locale, t }).text)
      host.showMessage(t('copied'), 'success')
    } catch {
      host.showMessage(t('copyFailed'), 'error')
      return
    }
    if (item.group === 'recent') return
    try {
      setHistory(await remember(host.storage, { ...item.conversion, savedAt: Date.now() }, settings))
    } catch {
      host.showMessage(t('historyFailed'), 'warning')
    }
  }

  function swap() {
    if (current?.group !== 'results') return
    const previous = draft.from
    const picked = draft.picked.includes(current.code) ? draft.picked.map(code => code === current.code ? previous : code)
      : targets.includes(previous) ? draft.picked : [previous, ...draft.picked]
    editDraft({ ...draft, from: current.code, picked })
    setSelected('r:' + previous)
  }

  function updateTargets(next: string[]) {
    if (!next.length) return false
    void saveTargets(host.storage, next).then(setTargets).catch(() => host.showMessage(t('targetsFailed'), 'warning'))
  }

  const actions: SurfaceActionDefinition[] = [
    { id: 'swap', label: t('swap'), shortcut: 'mod+s', disabled: current?.group !== 'results', run: swap },
    { id: 'copy', label: t('copy'), shortcut: 'enter', disabled: !current?.conversion, run: () => copy() },
  ]
  useSurfaceActions(actions)

  const move = (step: number) => {
    if (!items.length) return false
    const index = Math.max(0, items.indexOf(current!))
    setSelected(items[Math.max(0, Math.min(items.length - 1, index + step))].id)
  }
  const keys = useShortcuts({
    arrowdown: () => move(1),
    arrowup: () => move(-1),
    ...Object.fromEntries(items.slice(0, 9).map((item, index) => [`mod+${index + 1}`, () => { setSelected(item.id); void copy(item) }])),
  })

  return (
    <div className="currency-surface" {...keys.handlers}>
      <SurfaceHeaderField>
        <CommandInput value={query} onChange={updateQuery} placeholder={t('hint')} />
      </SurfaceHeaderField>
      <SurfaceHeaderActions>
        <ValueChip label={t('from')} value={draft.from} options={options}
          onChange={(code) => { if (typeof code === 'string') editDraft({ ...draft, from: code }) }} />
        <ValueChip label={t('targets')} value={targets} options={options} multiple maxSelect={MAX_TARGETS}
          onChange={(next) => Array.isArray(next) ? updateTargets(next) : false} />
      </SurfaceHeaderActions>
      {showError && <SurfaceError>{t('unrecognized')}</SurfaceError>}
      <SurfaceStatus>{status}</SurfaceStatus>
      <div className="currency-list" role="listbox" aria-label={t('results')} data-command-content>
        {items.map((item, index) => <div key={item.id}>
          {item.group !== items[index - 1]?.group && <div className="hiven-row-group">{t(item.group)}</div>}
          <div role="option" aria-selected={item === current} className={`hiven-row currency-row${item === current ? ' is-selected' : ''}`}
            ref={element => { if (item === current) element?.scrollIntoView({ block: 'nearest' }) }}
            onPointerMove={event => { if ((event.movementX || event.movementY) && item !== current) setSelected(item.id) }}
            onMouseDown={event => event.preventDefault()}
            onClick={() => { setSelected(item.id); void copy(item) }}>
            <span className="currency-row__flag" aria-hidden="true">{currencyFlag(item.code)}</span>
            <span className="hiven-row-text">
              <span className="currency-row__value">
                {item.conversion ? <><small>{symbols[item.code]}</small>{formatConversion(item.conversion, { locale, t }).value}</> : '—'}
                <em>{item.code}</em>
              </span>
              <small>{item.subtitle}</small>
            </span>
            {index < 9 && <ShortcutKey shortcut={`mod+${index + 1}`} />}
          </div>
        </div>)}
      </div>
      <ActionBar>
        {actions.map(action => <SurfaceActionButton key={action.id} action={action} variant="ghost"
          className={action.id === 'copy' ? 'currency-action-primary' : undefined} onMouseDown={event => event.preventDefault()} />)}
      </ActionBar>
    </div>
  )
}

function formatAmount(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 8 }).format(value)
}

/** The header field accepts partial input ("100", "100 jpy", "→ eur"); missing parts keep the current draft. */
function mergeQuery(previous: Draft, text: string): Draft {
  const parsed = parseQuery(text)
  if (!parsed) return previous
  return { amountText: parsed.amountText ?? previous.amountText, from: parsed.from ?? previous.from, picked: parsed.targets ?? [] }
}
