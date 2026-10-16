/**
 * Lossless JSON numbers.
 *
 * JSON.parse rounds integers beyond 2^53 and high-precision decimals. Numbers
 * that would not survive a JS round trip are swapped for marker strings before
 * parsing, and restored from the marker when stringifying, so format / compact /
 * sort / semantic diff keep the original numeric text. Pure functions only.
 */

const MARK = '\u0001N'
const MARK_ESCAPED = '\\u0001N'

/** Decimal comparison without expanding exponents or constructing large powers. */
function decimalIdentity(token: string): string | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token)
  if (!match) return null
  const fraction = match[3] ?? ''
  let digits = (match[2] + fraction).replace(/^0+/, '')
  if (!digits) return '0'
  let exponent = Number(match[4] ?? '0') - fraction.length
  if (!Number.isSafeInteger(exponent)) return null
  const significant = digits.replace(/0+$/, '')
  exponent += digits.length - significant.length
  digits = significant
  return `${match[1]}${digits}e${exponent}`
}

function isRiskyNumber(token: string): boolean {
  const value = Number(token)
  if (!Number.isFinite(value) || Object.is(value, -0) ||
    (Number.isInteger(value) && !Number.isSafeInteger(value))) return true
  const identity = decimalIdentity(token)
  return identity === null || identity !== decimalIdentity(String(value))
}

/** Replace numbers JS cannot hold exactly with marker string literals. Quoted strings are opaque. */
function protectNumbers(text: string): string {
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
  let out = ''
  let copied = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      for (i++; i < text.length; i++) {
        if (text[i] === '\\') { i++; continue }
        if (text[i] === '"') break
      }
      continue
    }
    if (!/[-\d]/.test(text[i]) || (i > 0 && !/[\s[:,]/.test(text[i - 1]))) continue
    number.lastIndex = i
    const match = number.exec(text)
    if (!match) continue
    const end = number.lastIndex
    if (end < text.length && !/[\s,}\]]/.test(text[end])) continue
    if (isRiskyNumber(match[0])) {
      out += text.slice(copied, i) + `"${MARK_ESCAPED}${match[0]}"`
      copied = end
    }
    i = end - 1
  }
  return copied === 0 ? text : out + text.slice(copied)
}

/** JSON.parse that keeps risky numbers as marker strings (see isLosslessNumber). */
export function parseJsonLossless(text: string): unknown {
  return JSON.parse(protectNumbers(text))
}

/** JSON.stringify that writes marker strings back as the original numeric text. */
export function stringifyJsonLossless(value: unknown, indent?: number | string): string {
  const text = JSON.stringify(value, null, indent) ?? ''
  if (!text.includes(MARK_ESCAPED)) return text
  return text.replace(/"\\u0001N([^"]*)"/g, '$1')
}

export function isLosslessNumber(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(MARK)
}

/** Numeric equality that treats marker numbers by value (1E400 equals 1e400). */
export function losslessScalarEquals(a: unknown, b: unknown): boolean {
  if (isLosslessNumber(a) && isLosslessNumber(b)) {
    const left = decimalIdentity(a.slice(MARK.length))
    return left !== null && left === decimalIdentity(b.slice(MARK.length))
  }
  return a === b
}
