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

/**
 * Inspect original numeric tokens before JSON.parse can round them. This is a
 * fidelity guard, not a JSON validator. Quoted strings (including escapes) are
 * opaque. Unsafe integers are conservatively excluded even if representable.
 */
export function hasJsonNumberRisk(text: string): boolean {
  const number = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
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
    const token = match[0]
    const value = Number(token)
    if (!Number.isFinite(value) || Object.is(value, -0) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))) return true
    const identity = decimalIdentity(token)
    if (identity === null || identity !== decimalIdentity(String(value))) return true
    i = end - 1
  }
  return false
}
