import catalog from './currencies.json'

export const currencyCodes = new Set(catalog.codes.split(' '))
export const assetNames = catalog.assetNames as Record<string, string>

// Symbols, Chinese short names and slang. Full names come from Intl (en + zh).
const aliases: Record<string, string> = {
  '$': 'USD', 'us$': 'USD', '刀': 'USD', '美刀': 'USD', '美金': 'USD', 'dollar': 'USD', 'dollars': 'USD', 'buck': 'USD', 'bucks': 'USD',
  '¥': 'CNY', '元': 'CNY', '块': 'CNY', '块钱': 'CNY', 'rmb': 'CNY', 'yuan': 'CNY',
  '円': 'JPY', '日币': 'JPY', 'yen': 'JPY',
  '€': 'EUR', 'euro': 'EUR', 'euros': 'EUR',
  '£': 'GBP',
  'hk$': 'HKD', '港币': 'HKD', '港纸': 'HKD',
  'nt$': 'TWD', '台币': 'TWD',
  '₩': 'KRW', '韩币': 'KRW',
  'a$': 'AUD', '澳元': 'AUD', '澳币': 'AUD',
  'c$': 'CAD', '加元': 'CAD', '加币': 'CAD',
  's$': 'SGD', '新币': 'SGD',
  '₹': 'INR', '卢比': 'INR',
  '₽': 'RUB', '卢布': 'RUB',
  '฿': 'THB', '泰币': 'THB',
  '₫': 'VND', '越南币': 'VND',
  '澳门元': 'MOP', '纽币': 'NZD', '马币': 'MYR', '令吉': 'MYR', '印尼盾': 'IDR', '迪拉姆': 'AED',
  '₿': 'BTC', '比特币': 'BTC', '以太坊': 'ETH', '以太币': 'ETH',
}

const names = new Map<string, string>()
for (const locale of ['en', 'zh']) {
  const display = new Intl.DisplayNames(locale, { type: 'currency', fallback: 'none' })
  for (const code of currencyCodes) {
    const name = (assetNames[code] ?? (code.length === 3 ? display.of(code) : undefined))?.toLowerCase()
    if (name && !names.has(name)) names.set(name, code)
  }
}

export const aliasesByCode = new Map<string, string[]>()
for (const [alias, code] of Object.entries(aliases)) aliasesByCode.set(code, [...aliasesByCode.get(code) ?? [], alias])

// Lowercase words that are also currency codes; without an explicit target or
// launcher keyword they are more likely plain text than a conversion request.
const weakTokens = new Set(['all', 'top', 'cup', 'mad', 'try', 'sos', 'bam', 'gel', 'pen', 'link', 'near', 'dot', 'uni', 'sol', 'sui', 'mana', 'etc', 'fil', 'pol', 'apt', 'arb', 'ena', 'ada', 'mop'])

export const keyword = /^(?:currency converter|currency|cur)(?=\s|$)|^(?:汇率换算|汇率|换汇|换算货币)(?=[\s+\d.$¥€£-]|$)/i
const amountPattern = /[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)/.source
const unitPattern = '(k(?![a-z])|千|万)'
const amountOnly = new RegExp(`^(${amountPattern})\\s*${unitPattern}?$`, 'i')
const sourcePattern = new RegExp(`^(\\D*?)\\s*(${amountPattern}\\s*${unitPattern}?)\\s*(.*)$`, 'i')
const connector = /\s+(?:to|in|into)\s+|\s*(?:->|→|=|换算成|换算为|兑换成|兑换为|转换成|换成|转成|等于多少|等于|是多少|多少|折合|兑换|兑|换|转)\s*/i
const multipliers: Record<string, number> = { k: 1e3, 千: 1e3, 万: 1e4 }

export function resolveCurrency(input: string) {
  const name = input.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!name) return undefined
  const code = name.toUpperCase()
  if (currencyCodes.has(code)) return code
  return aliases[name] ?? names.get(name) ?? names.get(name.replace(/s$/, ''))
}

export const MAX_TARGETS = 8

/** "cny", "cny, jpy", "人民币和日元", "us dollar / euro" -> codes; every part must resolve. */
function resolveTargets(text: string) {
  const whole = resolveCurrency(text)
  if (whole) return [whole]
  const parts = text.split(/\s*(?:[,，、;；/&]|\s+and\s+|和|及)\s*/).filter(Boolean)
    .flatMap((part) => resolveCurrency(part) ? [part] : part.split(/\s+/))
  const codes = parts.map(resolveCurrency)
  if (parts.length < 2 || !codes.every(Boolean)) return undefined
  return [...new Set(codes as string[])].slice(0, MAX_TARGETS)
}

export function parseAmount(input: string) {
  const match = input.normalize('NFKC').trim().match(amountOnly)
  if (!match) return null
  const amount = Number(match[1].replaceAll(',', '')) * (match[2] ? multipliers[match[2].toLowerCase()] : 1)
  return Number.isFinite(amount) ? amount : null
}

type Source = { amount?: number; amountText?: string; from?: string; targets?: string[]; token?: string }

function parseSource(text: string): Source | null {
  const currency = resolveCurrency(text)
  if (currency) return { from: currency, token: text }
  const match = text.match(sourcePattern)
  if (!match) return null
  const [, before, rawAmount, , after] = match
  const amountText = rawAmount.trim()
  const amount = parseAmount(amountText)
  if (amount === null) return null
  const prefix = before.trim()
  const token = after.trim() || prefix
  if (prefix && after.trim() && !resolveCurrency(prefix)) return null
  if (!token) return { amount, amountText }
  const from = resolveCurrency(token)
  if (from) return { amount, amountText, from, token }
  // "100 usd cny jpy": first code is the source, the rest are targets.
  const [first, ...rest] = token.split(/\s+/)
  const codes = [first, ...rest].map(resolveCurrency)
  return rest.length && codes.every(Boolean)
    ? { amount, amountText, from: codes[0], targets: [...new Set(codes.slice(1) as string[])].slice(0, MAX_TARGETS), token: first }
    : null
}

/** Partial parse: any of amount / from / to may be missing. */
export function parseQuery(input: string): Source | null {
  if (input.length > 100) return null
  const text = input.normalize('NFKC').trim().replace(/^convert\s+/i, '').replace(/[?？]+$/, '').trim()
  if (!text) return null
  const split = text.match(connector)
  const sourceText = split ? text.slice(0, split.index).trim() : text
  const targetText = split ? text.slice(split.index! + split[0].length).trim() : ''
  const targets = targetText ? resolveTargets(targetText) : undefined
  if (targetText && !targets) return null
  const source = sourceText ? parseSource(sourceText) : {}
  if (!source || (split && source.targets)) return null
  const result = { ...source, targets: targets ?? source.targets }
  return result.amount === undefined && !result.from && !result.targets ? null : result
}

/** Full conversion for the launcher: needs amount and source currency; targets may be omitted. */
export function parseConversion(input: string, strict = false) {
  const query = parseQuery(input)
  if (!query?.from || query.amount === undefined || query.amountText === undefined) return null
  if (strict && !query.targets && query.token && weakTokens.has(query.token)) return null
  return { amount: query.amount, amountText: query.amountText, from: query.from, targets: query.targets }
}
