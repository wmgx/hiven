export const MAX_GROUPED_NUMBER_LENGTH = 10_000

export type ThousandsAnswer =
  | { ok: true; text: string }
  | { ok: false; error: 'invalid' | 'comma' | 'limit' }

/** English grouping only, preserving every supplied digit and sign. */
export function formatThousands(raw: string): ThousandsAnswer {
  if (raw.length > MAX_GROUPED_NUMBER_LENGTH) return { ok: false, error: 'limit' }
  if (raw.includes(',')) return { ok: false, error: 'comma' }
  const parsed = raw.match(/^([+-]?)(\d+)(\.\d+)?$/)
  if (!parsed) return { ok: false, error: 'invalid' }
  const [, sign, integer, fraction = ''] = parsed
  const groups: string[] = []
  const leadingLength = integer.length % 3 || 3
  groups.push(integer.slice(0, leadingLength))
  for (let start = leadingLength; start < integer.length; start += 3) groups.push(integer.slice(start, start + 3))
  return { ok: true, text: sign + groups.join(',') + fraction }
}

/** Intent prefix avoids producing a second answer for ordinary numeric input. */
export function parseThousandsQuery(query: string): ThousandsAnswer | null {
  const input = query.trim()
  const match = input.match(/^(?:千分位(?:格式化)?\s*|(?:thousands|group number|format number)(?:\s+|$))([\s\S]*)$/i)
  return match ? formatThousands(match[1].trim()) : null
}
