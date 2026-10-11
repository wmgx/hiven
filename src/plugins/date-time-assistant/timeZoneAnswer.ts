/** Strict, local-only wall-clock conversion. Never delegate ambiguous input to Date.parse. */
export type ZoneAnswer = {
  sourceDate: string
  sourceTime: string
  zone: string
  offsetMinutes: number
  fixed: boolean
  targets: { key: 'beijing' | 'tokyo' | 'utc'; date: string; time: string; dayDelta: number }[]
}
export type ZoneParseResult = { ok: true; value: ZoneAnswer } | { ok: false; error: 'zone' | 'date' | 'gap' | 'fold' }
const MINUTE = 60_000
const DAY = 86_400_000
const pad = (value: number) => String(value).padStart(2, '0')
const dateText = (date: Date) => date.toISOString().slice(0, 10)

function formatter(zone: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
}
function wallEpoch(epoch: number, format: Intl.DateTimeFormat): number {
  const parts = Object.fromEntries(format.formatToParts(new Date(epoch)).map((part) => [part.type, part.value]))
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
}

export function parseTimeZoneAnswer(query: string, now = new Date()): ZoneParseResult | null {
  const match = query.trim().match(/^(?:(\d{4}-\d{2}-\d{2})\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s+([A-Za-z][A-Za-z0-9_+:/-]*)$/i)
  if (!match) return null
  const [, explicitDate, hourText, minuteText, meridiem, token] = match
  let hour = Number(hourText)
  const minute = Number(minuteText || 0)
  if (minute > 59 || hour > (meridiem ? 12 : 23) || (meridiem && hour < 1)) return { ok: false, error: 'date' }
  if (meridiem) hour = hour % 12 + (meridiem.toLowerCase() === 'pm' ? 12 : 0)
  let fixedOffset: number | undefined
  let format: Intl.DateTimeFormat | undefined
  let zone = token
  if (/^EST$/i.test(token)) { fixedOffset = -300; zone = 'EST' }
  else if (/^(UTC|GMT)$/i.test(token)) { fixedOffset = 0; zone = token.toUpperCase() }
  else {
    const offset = token.match(/^(?:UTC|GMT)([+-])(\d{1,2})(?::?(\d{2}))?$/i)
    if (offset) {
      const hours = Number(offset[2]); const minutes = Number(offset[3] || 0)
      if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return { ok: false, error: 'zone' }
      fixedOffset = (offset[1] === '+' ? 1 : -1) * (hours * 60 + minutes)
    } else {
      // No abbreviations such as CST, IST, or EDT: require an explicit IANA zone.
      if (!token.includes('/')) return { ok: false, error: 'zone' }
      try { format = formatter(token); zone = format.resolvedOptions().timeZone } catch { return { ok: false, error: 'zone' } }
    }
  }
  const sourceDate = explicitDate || dateText(new Date(format ? wallEpoch(now.getTime(), format) : now.getTime() + fixedOffset! * MINUTE))
  const [year, month, day] = sourceDate.split('-').map(Number)
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  if (year < 100 || dateText(new Date(wall)) !== sourceDate) return { ok: false, error: 'date' }
  let epoch = wall - (fixedOffset || 0) * MINUTE
  if (format) {
    // Collect offsets on both sides of a transition, then verify each candidate.
    // Zero matches means a skipped local time; two means an ambiguous repeated time.
    const offsets = new Set<number>()
    for (let delta = -36; delta <= 36; delta += 6) {
      const sample = wall + delta * 3_600_000
      offsets.add(wallEpoch(sample, format) - sample)
    }
    const candidates = [...offsets].map((offset) => wall - offset).filter((candidate) => wallEpoch(candidate, format!) === wall)
    if (candidates.length !== 1) return { ok: false, error: candidates.length ? 'fold' : 'gap' }
    epoch = candidates[0]
  }
  const sourceMidnight = Date.UTC(year, month - 1, day)
  const targets = ([['beijing', 'Asia/Shanghai'], ['tokyo', 'Asia/Tokyo'], ['utc', 'UTC']] as const).map(([key, targetZone]) => {
    const date = new Date(wallEpoch(epoch, formatter(targetZone)))
    const targetDate = dateText(date)
    return { key, date: targetDate, time: `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}${date.getUTCSeconds() ? `:${pad(date.getUTCSeconds())}` : ''}`, dayDelta: Math.round((Date.parse(`${targetDate}T00:00:00Z`) - sourceMidnight) / DAY) }
  })
  return { ok: true, value: { sourceDate, sourceTime: `${pad(hour)}:${pad(minute)}`, zone, offsetMinutes: (wall - epoch) / MINUTE, fixed: !format, targets } }
}
