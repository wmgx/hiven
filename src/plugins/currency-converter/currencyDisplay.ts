import { useMemo } from 'react'
import { currencyOptions } from './core'
import { assetNames } from './parse'
import catalog from './currencies.json'

const commonCodes = ['CNY', 'USD', 'EUR', 'JPY', 'HKD', 'GBP', 'KRW', 'TWD', 'SGD', 'AUD', 'CAD', 'CHF']
const sharedCurrencies = new Set(['ANG', 'CMD', 'XAF', 'XCD', 'XCG', 'XDR', 'XOF', 'XPF'])

// Dollar-family codes get a disambiguated symbol so HKD/TWD/SGD don't all read as "$".
export const symbols: Record<string, string> = { ...catalog.symbols, HKD: 'HK$', TWD: 'NT$', SGD: 'S$', AUD: 'A$', CAD: 'C$', NZD: 'NZ$', MOP: 'MOP$' }

export function currencyFlag(code: string) {
  if (Object.hasOwn(assetNames, code) || sharedCurrencies.has(code)) return '◈'
  return String.fromCodePoint(...Array.from(code.slice(0, 2), letter => 0x1f1e6 + letter.charCodeAt(0) - 65))
}

/** Value-chip options: code as label, localized name as description; common currencies first. */
export function useCurrencyOptions(locale: string) {
  return useMemo(() => {
    const names = new Intl.DisplayNames(locale, { type: 'currency', fallback: 'none' })
    const rank = (code: string) => { const index = commonCodes.indexOf(code); return index < 0 ? commonCodes.length : index }
    return currencyOptions
      .map(({ value, label }) => ({ value, label: value, description: (value.length === 3 ? names.of(value) : undefined) ?? label.split(' · ')[1] ?? value }))
      .sort((a, b) => rank(a.value) - rank(b.value))
  }, [locale])
}
