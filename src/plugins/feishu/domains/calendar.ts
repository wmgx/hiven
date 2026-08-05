/**
 * Feishu calendar domain (B2 read-only): +agenda and +search-event.
 */

import { runLarkCli, type LarkCliShell } from '../cli/run'

export type FeishuCalendarEvent = {
  event_id?: string
  eventId?: string
  id?: string
  summary?: string
  title?: string
  start?: string | FeishuTimePoint
  end?: string | FeishuTimePoint
  is_all_day?: boolean
  isAllDay?: boolean
  app_link?: string
  appLink?: string
  url?: string
  location?: string | { name?: string; address?: string }
  organizer?: string | { name?: string; display_name?: string }
  status?: string
}

export type FeishuTimePoint = {
  timestamp?: string | number
  date?: string
  datetime?: string
  time?: string
  timezone?: string
}

export type FeishuCalendarEventRow = {
  id: string
  title: string
  timeLabel: string
  subtitle: string
  url?: string
  summaryText: string
  keywords: string[]
}

export async function fetchAgenda(options: {
  shell: LarkCliShell
  binaryPath?: string
  start?: string
  end?: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<{ ok: boolean; events: FeishuCalendarEvent[]; message?: string; code?: string | number; hint?: string }> {
  const args = ['calendar', '+agenda', '--as', 'user']
  if (options.start) args.push('--start', options.start)
  if (options.end) args.push('--end', options.end)

  const result = await runLarkCli({
    shell: options.shell,
    binaryPath: options.binaryPath,
    args,
    timeoutMs: options.timeoutMs ?? 10000,
    signal: options.signal,
    risk: 'read',
  })

  if (!result.ok) {
    return {
      ok: false,
      events: [],
      message: result.message,
      code: result.code,
      hint: result.hint,
    }
  }

  return { ok: true, events: extractEvents(result.data) }
}

export async function searchEvents(options: {
  shell: LarkCliShell
  query: string
  binaryPath?: string
  start?: string
  end?: string
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<{ ok: boolean; events: FeishuCalendarEvent[]; message?: string; code?: string | number; hint?: string }> {
  const query = options.query.trim()
  if (!query) {
    return { ok: true, events: [] }
  }

  const args = ['calendar', '+search-event', '--query', query, '--as', 'user']
  if (options.start) args.push('--start', options.start)
  if (options.end) args.push('--end', options.end)

  const result = await runLarkCli({
    shell: options.shell,
    binaryPath: options.binaryPath,
    args,
    timeoutMs: options.timeoutMs ?? 10000,
    signal: options.signal,
    risk: 'read',
  })

  if (!result.ok) {
    return {
      ok: false,
      events: [],
      message: result.message,
      code: result.code,
      hint: result.hint,
    }
  }

  return { ok: true, events: extractEvents(result.data) }
}

/**
 * Normalize CLI payload into event rows for launcher choices / text.
 */
export function mapEventsToRows(events: FeishuCalendarEvent[]): FeishuCalendarEventRow[] {
  return events.map((event, index) => {
    const id = String(event.event_id ?? event.eventId ?? event.id ?? `event-${index}`)
    const title = String(event.summary ?? event.title ?? id).trim() || id
    const timeLabel = formatEventTimeRange(event.start, event.end, isAllDay(event))
    const location = formatLocation(event.location)
    const url = event.app_link ?? event.appLink ?? event.url
    const subtitleParts = [timeLabel, location].filter(Boolean)
    const subtitle = subtitleParts.join(' · ')
    const summaryText = [
      title,
      timeLabel,
      location ? `📍 ${location}` : '',
      url ? url : '',
    ]
      .filter(Boolean)
      .join('\n')

    return {
      id,
      title,
      timeLabel,
      subtitle,
      url: typeof url === 'string' && url ? url : undefined,
      summaryText,
      keywords: [title, timeLabel, location ?? '', id].filter(Boolean),
    }
  })
}

export function formatAgendaText(events: FeishuCalendarEvent[], emptyLabel: string): string {
  const rows = mapEventsToRows(events)
  if (rows.length === 0) return emptyLabel
  return rows
    .map((row) => {
      const lines = [`• ${row.timeLabel}  ${row.title}`]
      if (row.url) lines.push(`  ${row.url}`)
      return lines.join('\n')
    })
    .join('\n')
}

function extractEvents(data: unknown): FeishuCalendarEvent[] {
  if (!data) return []
  if (Array.isArray(data)) {
    return data.filter((item): item is FeishuCalendarEvent => item != null && typeof item === 'object')
  }
  if (typeof data !== 'object') return []
  const obj = data as Record<string, unknown>

  const candidates: unknown[] = []
  for (const key of ['items', 'events', 'results', 'agenda', 'list']) {
    if (Array.isArray(obj[key])) candidates.push(...(obj[key] as unknown[]))
  }

  // Nested data wrappers from various CLI versions
  if (obj.data && typeof obj.data === 'object') {
    const nested = obj.data as Record<string, unknown>
    for (const key of ['items', 'events', 'results', 'agenda', 'list']) {
      if (Array.isArray(nested[key])) candidates.push(...(nested[key] as unknown[]))
    }
    if (Array.isArray(obj.data)) candidates.push(...(obj.data as unknown[]))
  }

  // Grouped by day: { days: [{ date, events: [...] }] }
  if (Array.isArray(obj.days)) {
    for (const day of obj.days) {
      if (day && typeof day === 'object') {
        const dayObj = day as Record<string, unknown>
        if (Array.isArray(dayObj.events)) candidates.push(...dayObj.events)
        if (Array.isArray(dayObj.items)) candidates.push(...dayObj.items)
      }
    }
  }

  return candidates.filter((item): item is FeishuCalendarEvent => item != null && typeof item === 'object')
}

function isAllDay(event: FeishuCalendarEvent): boolean {
  return event.is_all_day === true || event.isAllDay === true
}

function formatLocation(location: FeishuCalendarEvent['location']): string | undefined {
  if (!location) return undefined
  if (typeof location === 'string') return location.trim() || undefined
  const name = location.name ?? location.address
  return name?.trim() || undefined
}

export function formatEventTimeRange(
  start: FeishuCalendarEvent['start'],
  end: FeishuCalendarEvent['end'],
  allDay?: boolean,
): string {
  const startLabel = formatTimePoint(start, allDay)
  const endLabel = formatTimePoint(end, allDay)
  if (startLabel && endLabel) {
    if (allDay && startLabel === endLabel) return startLabel
    // Same calendar day → show "HH:mm – HH:mm"
    const startDay = dayKey(start)
    const endDay = dayKey(end)
    if (startDay && endDay && startDay === endDay && !allDay) {
      const startClock = clockPart(startLabel)
      const endClock = clockPart(endLabel)
      if (startClock && endClock) return `${startDay} ${startClock}–${endClock}`
    }
    return `${startLabel} – ${endLabel}`
  }
  return startLabel || endLabel || ''
}

function formatTimePoint(point: FeishuCalendarEvent['start'], allDay?: boolean): string {
  if (point == null) return ''
  if (typeof point === 'string') return formatIsoLike(point, allDay)
  if (typeof point === 'object') {
    if (point.date) return String(point.date)
    if (point.datetime) return formatIsoLike(String(point.datetime), allDay)
    if (point.time) return formatIsoLike(String(point.time), allDay)
    if (point.timestamp != null) {
      const n = Number(point.timestamp)
      if (Number.isFinite(n)) {
        const ms = n < 1e12 ? n * 1000 : n
        return formatDate(new Date(ms), allDay)
      }
    }
  }
  return ''
}

function formatIsoLike(value: string, allDay?: boolean): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  // Date only
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const d = new Date(trimmed)
  if (!Number.isNaN(d.getTime())) return formatDate(d, allDay)
  return trimmed
}

function formatDate(d: Date, allDay?: boolean): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  if (allDay) return `${y}-${m}-${day}`
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

function dayKey(point: FeishuCalendarEvent['start']): string | undefined {
  const label = formatTimePoint(point, true)
  const match = label.match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1]
}

function clockPart(label: string): string | undefined {
  const match = label.match(/(\d{2}:\d{2})$/)
  return match?.[1]
}
