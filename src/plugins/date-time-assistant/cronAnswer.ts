/** Five-field cron preview only. No scheduler, network, or executable input. */
type Field = { values: number[]; wildcard: boolean; source: string }
export type CronAnswer = { expression: string; fields: string[]; everyMinutes?: number; dayOr: boolean; next: string; zone: string; epoch: number }
export type CronResult = { ok: true; value: CronAnswer } | { ok: false; error: 'syntax' | 'unreachable' | 'zone' }
const MINUTE = 60_000
const DAY = 86_400_000
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const pad = (n: number) => String(n).padStart(2, '0')

function parseField(source: string, min: number, max: number, names: string[] = []): Field | null {
  const values = new Set<number>()
  const number = (token: string): number => /^\d{1,2}$/.test(token) ? Number(token) : names.includes(token) ? names.indexOf(token) + min : NaN
  for (const piece of source.split(',')) {
    const match = piece.match(/^([A-Z0-9]+(?:-[A-Z0-9]+)?|\*)(?:\/(\d{1,2}))?$/)
    if (!match) return null
    const step = match[2] ? Number(match[2]) : 1
    if (step < 1 || step > max - min + 1) return null
    const range = match[1].split('-')
    const start = match[1] === '*' ? min : number(range[0])
    const end = match[1] === '*' ? max : range.length === 2 ? number(range[1]) : match[2] ? max : start
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) return null
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return { values: [...values].sort((a, b) => a - b), wildcard: source.startsWith('*'), source }
}

function wallParts(format: Intl.DateTimeFormat, epoch: number) {
  const parts = Object.fromEntries(format.formatToParts(epoch).map((part) => [part.type, part.value]))
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) }
}
function wallEpoch(format: Intl.DateTimeFormat, epoch: number): number {
  const p = wallParts(format, epoch)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
}

export function parseCronAnswer(query: string, now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): CronResult | null {
  const explicit = /^cron(?:\s|$)/i.test(query.trim())
  const expression = query.trim().replace(/^cron\s*/i, '').toUpperCase()
  const tokens = expression.split(/\s+/)
  // Avoid claiming ordinary date/time, arithmetic, and natural-language searches.
  if (!explicit && !/^@/.test(expression) && !(tokens.length >= 5 && tokens.every((token) => /^[\dA-Z*?,/#LW-]+$/.test(token)) && tokens.some((token) => /[\d*?]/.test(token)))) return null
  if (tokens.length !== 5 || expression.length > 256) return { ok: false, error: 'syntax' }
  const fields = [parseField(tokens[0], 0, 59), parseField(tokens[1], 0, 23), parseField(tokens[2], 1, 31), parseField(tokens[3], 1, 12, MONTHS), parseField(tokens[4], 0, 7, WEEKDAYS)]
  if (fields.some((field) => !field)) return { ok: false, error: 'syntax' }
  const [minute, hour, day, month, weekday] = fields as Field[]
  // Vixie entry.c marks DOM_STAR/DOW_STAR from the first character, including */n.
  const dayOr = !day.wildcard && !weekday.wildcard
  let format: Intl.DateTimeFormat
  try { format = new Intl.DateTimeFormat('en-GB', { timeZone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }) } catch { return { ok: false, error: 'zone' } }
  if (!Number.isFinite(now.getTime())) return { ok: false, error: 'syntax' }
  const start = wallParts(format, now.getTime())
  const startDay = Date.UTC(start.year, start.month - 1, start.day)
  // Eight years includes the longest modern leap-day gap (2096 → 2104).
  const endDay = Date.UTC(start.year + 8, start.month - 1, start.day)
  for (let offset = 0; startDay + offset * DAY <= endDay; offset++) {
    const calendar = new Date(startDay + offset * DAY)
    if (!month.values.includes(calendar.getUTCMonth() + 1)) continue
    const matchesDay = day.values.includes(calendar.getUTCDate())
    const matchesWeekday = weekday.values.some((value) => value % 7 === calendar.getUTCDay())
    if (!(dayOr ? matchesDay || matchesWeekday : matchesDay && matchesWeekday)) continue
    const midnight = calendar.getTime()
    // Sample both sides of transitions, including skipped civil dates and half-hour DST.
    const offsets = new Set<number>()
    for (let sample = midnight - 36 * 3_600_000; sample <= midnight + 36 * 3_600_000; sample += 6 * 3_600_000) offsets.add(wallEpoch(format, sample) - sample)
    const candidates: { epoch: number; wall: number }[] = []
    for (const h of hour.values) for (const m of minute.values) {
      const wall = midnight + h * 3_600_000 + m * MINUTE
      for (const utcOffset of offsets) {
        const epoch = wall - utcOffset
        if (epoch > now.getTime()) candidates.push({ epoch, wall })
      }
    }
    candidates.sort((a, b) => a.epoch - b.epoch)
    for (const candidate of candidates) {
      if (wallEpoch(format, candidate.epoch) !== candidate.wall) continue
      const local = new Date(candidate.wall)
      const offsetMinutes = (candidate.wall - candidate.epoch) / MINUTE
      const abs = Math.abs(offsetMinutes)
      const next = `${local.toISOString().slice(0, 10)} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:00 UTC${offsetMinutes < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
      const every = tokens[0].match(/^\*\/(\d+)$/)
      const interval = Number(every?.[1] || 1)
      return { ok: true, value: { expression, fields: tokens, everyMinutes: tokens.slice(1).every((token) => token === '*') && (tokens[0] === '*' || every) && 60 % interval === 0 ? interval : undefined, dayOr, next, zone: format.resolvedOptions().timeZone, epoch: candidate.epoch } }
    }
  }
  return { ok: false, error: 'unreachable' }
}
