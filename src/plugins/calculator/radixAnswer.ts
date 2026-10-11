export type Radix = 2 | 8 | 10 | 16
export type RadixAnswer = { base: Radix; text: string }
export type RadixQueryResult =
  | { ok: true; answers: RadixAnswer[] }
  | { ok: false; error: 'invalid' | 'limit' }

const MAX_DIGITS = 256
const radixNames = new Map<string, Radix>([
  ['bin', 2], ['binary', 2], ['二进制', 2],
  ['oct', 8], ['octal', 8], ['八进制', 8],
  ['dec', 10], ['decimal', 10], ['十进制', 10],
  ['hex', 16], ['hexadecimal', 16], ['十六进制', 16],
])
const NAME = '(?:hexadecimal|decimal|binary|octal|hex|dec|bin|oct|十六进制|十进制|二进制|八进制)'

function render(value: bigint, base: Radix): RadixAnswer {
  const prefix = base === 16 ? '0x' : base === 2 ? '0b' : base === 8 ? '0o' : ''
  const magnitude = value < 0n ? -value : value
  return { base, text: `${value < 0n ? '-' : ''}${prefix}${magnitude.toString(base).toUpperCase()}` }
}

function convert(raw: string, source: Radix, target?: Radix): RadixQueryResult {
  const negative = raw.startsWith('-')
  let digits = raw.replace(/^[+-]/, '')
  const suppliedPrefix = digits.match(/^0([xbo])/i)?.[1].toLowerCase()
  if (suppliedPrefix) {
    const prefixBase = suppliedPrefix === 'x' ? 16 : suppliedPrefix === 'b' ? 2 : 8
    if (source !== prefixBase) return { ok: false, error: 'invalid' }
    digits = digits.slice(2)
  }
  if (digits.length > MAX_DIGITS) return { ok: false, error: 'limit' }
  const valid = source === 16 ? /^[0-9a-f]+$/i : source === 10 ? /^\d+$/ : source === 8 ? /^[0-7]+$/ : /^[01]+$/
  if (!valid.test(digits)) return { ok: false, error: 'invalid' }
  const prefix = source === 16 ? '0x' : source === 2 ? '0b' : source === 8 ? '0o' : ''
  const value = BigInt(prefix + digits) * (negative ? -1n : 1n)
  const targets: Radix[] = target ? [target] : source === 16 ? [10, 2] : source === 10 ? [16, 2] : [10, 16]
  return { ok: true, answers: targets.map((base) => render(value, base)) }
}

/** Explicit prefixes/base names only; never interprets ordinary formulas. */
export function parseRadixQuery(query: string): RadixQueryResult | null {
  const input = query.trim()
  // Cap before parsing; only claim inputs that explicitly name a base.
  if (input.length > 350) {
    return /^[+-]?0[xbo]/i.test(input) || new RegExp(`(?:^|\\s)${NAME}(?:\\s|$)`, 'i').test(input)
      ? { ok: false, error: 'limit' } : null
  }
  const explicit = input.match(new RegExp(`^(?:(${NAME})\\s+)?([^\\s]+)\\s+(?:to|转|转为|到)\\s*(${NAME})$`, 'i'))
  if (explicit) {
    const prefix = explicit[2].match(/^[+-]?0([xbo])/i)?.[1].toLowerCase()
    const source = explicit[1] ? radixNames.get(explicit[1].toLowerCase())! : prefix === 'x' ? 16 : prefix === 'b' ? 2 : prefix === 'o' ? 8 : 10
    return convert(explicit[2], source, radixNames.get(explicit[3].toLowerCase())!)
  }
  const named = input.match(new RegExp(`^(${NAME})\\s+([^\\s]+)$`, 'i'))
  if (named) return convert(named[2], radixNames.get(named[1].toLowerCase())!)
  const prefixed = input.match(/^[+-]?0([xbo])([^\s]*)$/i)
  if (!prefixed || /[+*/()^%]/.test(prefixed[2])) return null
  return convert(input, prefixed[1].toLowerCase() === 'x' ? 16 : prefixed[1].toLowerCase() === 'b' ? 2 : 8)
}
