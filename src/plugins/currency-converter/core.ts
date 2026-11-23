import type { LauncherDynamicContext } from '@hiven/plugin'
import { assetNames, currencyCodes, MAX_TARGETS } from './parse'

const RATES_URL = 'https://api.frankfurter.dev/v2/rates?base=USD'
const englishNames = new Intl.DisplayNames('en', { type: 'currency', fallback: 'none' })
export const currencyOptions = [...currencyCodes].map((code) => {
  const name = assetNames[code] ?? (code.length === 3 ? englishNames.of(code) : undefined)
  return { value: code, label: name ? code + ' · ' + name : code }
})

export type Rate = { rate: number; date: string }
type Conversion = { amount: number; from: string; to: string; value: number; date: string; rate?: number }
export type HistoryEntry = Conversion & { savedAt: number }
export type Settings = { retentionDays: number; maxEntries: number }
export const defaults: Settings = { retentionDays: 30, maxEntries: 50 }
export const HISTORY_KEY = 'history'
const TARGETS_KEY = 'targets'
export const defaultTargets = ['CNY', 'USD', 'EUR', 'JPY', 'HKD', 'GBP']
let targetsCache: Promise<string[]> | undefined

function validTargets(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const codes = value.filter((code): code is string => typeof code === 'string' && currencyCodes.has(code))
  return codes.length ? [...new Set(codes)].slice(0, MAX_TARGETS) : undefined
}

/** Saved target list; read once per session so launcher keystrokes don't hit storage. */
export function loadTargets(storage: LauncherDynamicContext['storage']) {
  targetsCache ??= Promise.resolve()
    .then(() => storage.kv.get<unknown>(TARGETS_KEY))
    .then((value) => validTargets(value) ?? defaultTargets)
    .catch(() => defaultTargets)
  return targetsCache
}

export async function saveTargets(storage: LauncherDynamicContext['storage'], targets: string[]) {
  const next = validTargets(targets) ?? defaultTargets
  targetsCache = Promise.resolve(next)
  await storage.kv.set(TARGETS_KEY, next)
  return next
}

export function firstTarget(targets: readonly string[], from: string) {
  return targets.find((code) => code !== from) ?? (from === 'USD' ? 'CNY' : 'USD')
}
let cached: { rates: Map<string, Rate>; expires: number } | undefined
let pending: Promise<Map<string, Rate> | undefined> | undefined

export function retainedHistory(entries: HistoryEntry[], settings: unknown, now: number) {
  const { retentionDays = defaults.retentionDays, maxEntries = defaults.maxEntries } = (settings ?? {}) as Partial<Settings>
  const days = Number.isInteger(retentionDays) ? Math.max(1, Math.min(365, retentionDays)) : defaults.retentionDays
  const limit = Number.isInteger(maxEntries) ? Math.max(1, Math.min(100, maxEntries)) : defaults.maxEntries
  return entries.filter((entry) => entry.savedAt >= now - days * 86_400_000).slice(0, limit)
}

export async function remember(storage: LauncherDynamicContext['storage'], entry: HistoryEntry, settings: unknown) {
  const { kv } = storage
  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = await kv.get<HistoryEntry[]>(HISTORY_KEY)
    const otherEntries = (previous ?? []).filter(({ amount, from, to }) => amount !== entry.amount || from !== entry.from || to !== entry.to)
    const entries = retainedHistory([entry, ...otherEntries], settings, entry.savedAt)
    const { committed } = await kv.batch({
      checks: [{ key: HISTORY_KEY, expected: previous }],
      operations: [{ type: 'set', key: HISTORY_KEY, value: entries }],
    })
    if (committed) return entries
  }
  throw new Error('Currency history write conflict')
}

export function getRates(network: LauncherDynamicContext['network']) {
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.rates)
  pending ??= network.request({ url: RATES_URL }).then((response) => {
    if (response.status !== 200) return undefined
    const rows: unknown = JSON.parse(response.body)
    if (!Array.isArray(rows)) return undefined
    const rates = new Map<string, Rate>()
    for (const row of rows) {
      if (row?.base === 'USD' && typeof row.quote === 'string' && /^[A-Z]{3,4}$/.test(row.quote)
        && Number.isFinite(row.rate) && row.rate > 0
        && typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
        rates.set(row.quote, { rate: row.rate, date: row.date })
      }
    }
    if (!rates.size) return undefined
    cached = { rates, expires: Date.now() + 60 * 60 * 1000 }
    return rates
  }).catch(() => undefined).finally(() => { pending = undefined })
  return pending
}

export function convert(rates: Map<string, Rate> | undefined, amount: number, from: string, to: string): Conversion | undefined {
  const source = rates?.get(from)
  const target = rates?.get(to)
  if (!source || !target) return undefined
  const rate = target.rate / source.rate
  const value = amount * rate
  if (!Number.isFinite(value)) return undefined
  const date = source.date < target.date ? source.date : target.date
  return { amount, from, to, value, date, rate }
}

const fractionDigits = new Map<string, number | undefined>()
function currencyDigits(code: string) {
  if (!fractionDigits.has(code)) {
    let digits: number | undefined
    if (code.length === 3 && !Object.hasOwn(assetNames, code)) {
      try {
        digits = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits
      } catch {
        digits = undefined
      }
    }
    fractionDigits.set(code, digits)
  }
  return fractionDigits.get(code)
}

/** Fiat keeps its own minor units (CNY 2, JPY 0); crypto/metals and sub-unit values keep significant digits. */
export function formatMoney(value: number, code: string, locale: string, useGrouping = true) {
  const digits = currencyDigits(code)
  const abs = Math.abs(value)
  const options: Intl.NumberFormatOptions = abs > 0 && abs < 1
    ? { maximumSignificantDigits: digits === undefined ? 6 : 4 }
    : digits === undefined ? { maximumFractionDigits: 6 } : { minimumFractionDigits: digits, maximumFractionDigits: digits }
  return new Intl.NumberFormat(locale, { ...options, useGrouping }).format(value)
}

export function formatConversion(conversion: Conversion, ctx: Pick<LauncherDynamicContext, 'locale' | 't'>) {
  const { amount, from, to, value, date } = conversion
  const rate = conversion.rate ?? (amount ? value / amount : undefined)
  const amountText = new Intl.NumberFormat(ctx.locale, { maximumFractionDigits: 8 }).format(amount)
  const valueText = formatMoney(value, to, ctx.locale)
  const rateFormat = new Intl.NumberFormat(ctx.locale, { maximumSignificantDigits: 5 })
  const rateText = rate === undefined ? '' : `1 ${from} = ${rateFormat.format(rate)} ${to}`
  const reverseText = rate ? `1 ${to} = ${rateFormat.format(1 / rate)} ${from}` : ''
  const dateText = ctx.t('rateDate', { date })
  return {
    title: `${amountText} ${from} ≈ ${valueText} ${to}`,
    subtitle: rateText ? `${rateText} · ${dateText}` : dateText,
    icon: 'Calculator',
    rate: rateText,
    reverse: reverseText,
    date: dateText,
    value: valueText,
    // Copy a plain number (no grouping, '.' decimal) so it pastes cleanly into forms and sheets.
    text: formatMoney(value, to, 'en', false),
  }
}
