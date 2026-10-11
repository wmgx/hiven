const DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
const SMALL_UNITS = ['', '拾', '佰', '仟']
const GROUP_UNITS = ['', '万', '亿', '兆']
const MAX_INTEGER_DIGITS = 16

export type ChineseNumeralResult =
  | { ok: true; text: string; mode: 'integer' | 'money' }
  | { ok: false; error: 'invalid' | 'integer' | 'precision' | 'range' }

function groupText(group: string): string {
  let output = ''
  let zero = false
  for (let i = 0; i < group.length; i++) {
    const digit = Number(group[i])
    if (digit === 0) {
      if (output) zero = true
    } else {
      if (zero) output += DIGITS[0]
      output += DIGITS[digit] + SMALL_UNITS[group.length - i - 1]
      zero = false
    }
  }
  return output
}

function integerText(integer: string): string {
  if (integer === '0') return DIGITS[0]
  const groups: string[] = []
  for (let end = integer.length; end > 0; end -= 4) groups.unshift(integer.slice(Math.max(0, end - 4), end))
  let output = ''
  let missingGroup = false
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    if (Number(group) === 0) {
      missingGroup = true
      continue
    }
    if (output && (missingGroup || Number(group) < 1000)) output += DIGITS[0]
    output += groupText(group) + GROUP_UNITS[groups.length - i - 1]
    missingGroup = false
  }
  return output
}

/** Strings only: no IEEE-754 conversion or rounding of amounts. */
export function formatChineseNumeral(raw: string, mode: 'integer' | 'money'): ChineseNumeralResult {
  if (raw.length > 128) return { ok: false, error: 'range' }
  const parsed = raw.trim().match(/^([+-]?)(\d+)(?:\.(\d+))?$/)
  if (!parsed) return { ok: false, error: 'invalid' }
  const integer = parsed[2].replace(/^0+(?=\d)/, '')
  const fraction = parsed[3] ?? ''
  if (integer.length > MAX_INTEGER_DIGITS) return { ok: false, error: 'range' }
  if (mode === 'integer' && fraction) return { ok: false, error: 'integer' }
  if (mode === 'money' && fraction.length > 2) return { ok: false, error: 'precision' }
  const negative = parsed[1] === '-' && (integer !== '0' || /[1-9]/.test(fraction)) ? '负' : ''
  const whole = integerText(integer)
  if (mode === 'integer') return { ok: true, text: negative + whole, mode }
  const cents = fraction.padEnd(2, '0')
  const jiao = Number(cents[0])
  const fen = Number(cents[1])
  let tail = jiao ? DIGITS[jiao] + '角' : ''
  if (fen) {
    if (!jiao && integer !== '0') tail += DIGITS[0]
    tail += DIGITS[fen] + '分'
  } else {
    tail += '整'
  }
  return { ok: true, text: `${negative}${whole}元${tail}`, mode }
}

/** Bare numbers stay with the existing calculator/date answers. */
export function parseChineseNumeralQuery(query: string): ChineseNumeralResult | null {
  const input = query.trim()
  const money = input.match(/^(?:金额大写|人民币大写|人民币|RMB|CNY|¥|￥)\s*(.+?)(?:\s*元)?(?:\s*大写)?$/i)
    ?? input.match(/^(.+?)\s*元\s*大写$/)
  if (money) return formatChineseNumeral(money[1].trim(), 'money')
  const integer = input.match(/^(?:数字大写|中文大写|大写)\s*(.+)$/)
    ?? input.match(/^(.+?)\s*(?:数字大写|中文大写|大写)$/)
  return integer ? formatChineseNumeral(integer[1].trim(), 'integer') : null
}
