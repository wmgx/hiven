/** Bounded relative-time interpretation; calendar days differ from elapsed hours. */
export type RelativeTimeError = 'syntax' | 'range' | 'unit' | 'zone' | 'gap' | 'fold'
export type RelativeTimeValue = {
  amount: number
  unit: 'day' | 'hour' | 'minute'
  mode: 'calendar' | 'elapsed'
  base: string
  target: string
  zone: string
  epoch: number
}
export type RelativeTimeResult = { ok: true; value: RelativeTimeValue } | { ok: false; error: RelativeTimeError }
const MINUTE = 60_000
const DAY = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')
function formatter(zone: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
}
function wallEpoch(epoch: number, format: Intl.DateTimeFormat): number {
  const parts = Object.fromEntries(format.formatToParts(epoch).map((p) => [p.type, p.value]))
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
}
function display(epoch: number, format: Intl.DateTimeFormat): string {
  const wall = wallEpoch(epoch, format)
  const offsetSeconds = (wall - epoch) / 1000
  const absolute = Math.abs(offsetSeconds)
  const offset = `UTC${offsetSeconds < 0 ? '-' : '+'}${pad(Math.floor(absolute / 3600))}:${pad(Math.floor(absolute / 60) % 60)}${absolute % 60 ? `:${pad(absolute % 60)}` : ''}`
  return `${new Date(wall).toISOString().slice(0, 19).replace('T', ' ')} ${offset}`
}

export function parseRelativeTimeAnswer(query: string, now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): RelativeTimeResult | null {
  const input = query.trim()
  const zh = input.match(/^(\d+)\s*(天|日|小时|分钟|个月|月|年)\s*(前|后)$/)
  const enAgo = input.match(/^(\d+)\s+(days?|hours?|minutes?|months?|years?)\s+ago$/i)
  const enAfter = input.match(/^in\s+(\d+)\s+(days?|hours?|minutes?|months?|years?)$/i)
  const match = zh || enAgo || enAfter
  if (!match) {
    // Return actionable errors only for clearly relative-time-shaped searches.
    const relative = /(?:天|日|小时|分钟|个月|月|年)\s*(?:前|后)$/.test(input)
      || /^(?:in\s+.+\s+(?:days?|hours?|minutes?|months?|years?)|.+\s+(?:days?|hours?|minutes?|months?|years?)\s+ago)$/i.test(input)
    return relative ? { ok: false, error: 'syntax' } : null
  }
  const count = Number(match[1])
  const token = match[2].toLowerCase()
  if (/^(?:个?月|年|months?|years?)$/.test(token)) return { ok: false, error: 'unit' }
  const unit = /^(?:天|日|days?)$/.test(token) ? 'day' : /^(?:小时|hours?)$/.test(token) ? 'hour' : 'minute'
  const maximum = unit === 'day' ? 3660 : unit === 'hour' ? 87840 : 5270400
  if (!Number.isSafeInteger(count) || count > maximum) return { ok: false, error: 'range' }
  const amount = count * (enAgo || (zh && zh[3] === '前') ? -1 : 1)
  // The displayed base is exact to the second; discard invisible milliseconds
  // before both computation and formatting so copied arithmetic is reproducible.
  const baseEpoch = Math.floor(now.getTime() / 1000) * 1000
  if (!Number.isFinite(baseEpoch) || new Date(baseEpoch).getUTCFullYear() < 100 || new Date(baseEpoch).getUTCFullYear() > 9999) return { ok: false, error: 'range' }
  let format: Intl.DateTimeFormat
  try { format = formatter(timeZone) } catch { return { ok: false, error: 'zone' } }
  const baseWall = wallEpoch(baseEpoch, format)
  let epoch = baseEpoch + amount * (unit === 'day' ? DAY : unit === 'hour' ? 60 * MINUTE : MINUTE)
  if (unit === 'day' && amount !== 0) {
    const targetWall = baseWall + amount * DAY
    const offsets = new Set<number>()
    for (let delta = -36; delta <= 36; delta += 6) {
      const sample = targetWall + delta * 3_600_000
      offsets.add(wallEpoch(sample, format) - sample)
    }
    const candidates = [...offsets].map((offset) => targetWall - offset).filter((candidate) => wallEpoch(candidate, format) === targetWall)
    if (candidates.length !== 1) return { ok: false, error: candidates.length ? 'fold' : 'gap' }
    epoch = candidates[0]
  }
  if (!Number.isFinite(epoch) || new Date(epoch).getUTCFullYear() < 100 || new Date(epoch).getUTCFullYear() > 9999) return { ok: false, error: 'range' }
  return { ok: true, value: { amount, unit, mode: unit === 'day' ? 'calendar' : 'elapsed', base: display(baseEpoch, format), target: display(epoch, format), zone: format.resolvedOptions().timeZone, epoch } }
}
