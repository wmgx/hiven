import type { PluginDefinition, InstantSuggestionContext, InstantSuggestion } from '../../workspace/pluginTypes'

// ─── Date/Time Helpers ───────────────────────────────────────────────────────

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

function formatDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// ─── Query Parser ────────────────────────────────────────────────────────────

type ParsedResult = {
  kind: 'datetime' | 'date' | 'timestamp'
  display: string
  value: string
  actionLabelKey: string
}

function parseDateTimeQuery(query: string, now: Date): ParsedResult | null {
  const q = query.trim().toLowerCase()

  // "now" → current local time
  if (q === 'now') {
    return {
      kind: 'datetime',
      display: formatDateTime(now),
      value: formatDateTime(now),
      actionLabelKey: 'action.copyDateTime',
    }
  }

  // "timestamp" / "unix time" / "now timestamp" → current unix timestamp (seconds)
  if (q === 'timestamp' || q === 'unix time' || q === 'now timestamp') {
    const ts = Math.floor(now.getTime() / 1000).toString()
    return {
      kind: 'timestamp',
      display: ts,
      value: ts,
      actionLabelKey: 'action.copyTimestamp',
    }
  }

  // "tomorrow 10am" / "tomorrow 3pm" etc.
  const tomorrowMatch = q.match(/^tomorrow\s+(\d{1,2})\s*(am|pm)?$/)
  if (tomorrowMatch) {
    let hour = parseInt(tomorrowMatch[1], 10)
    const ampm = tomorrowMatch[2]
    if (ampm === 'pm' && hour < 12) hour += 12
    if (ampm === 'am' && hour === 12) hour = 0
    if (hour < 0 || hour > 23) return null
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(hour, 0, 0, 0)
    return {
      kind: 'datetime',
      display: formatDateTime(tomorrow),
      value: formatDateTime(tomorrow),
      actionLabelKey: 'action.copyDateTime',
    }
  }

  // "YYYY-MM-DD + N days" / "YYYY-MM-DD - N days"
  const dateOffsetMatch = q.match(/^(\d{4}-\d{2}-\d{2})\s*([+-])\s*(\d+)\s*days?$/)
  if (dateOffsetMatch) {
    const baseDate = new Date(dateOffsetMatch[1] + 'T00:00:00')
    if (isNaN(baseDate.getTime())) return null
    const sign = dateOffsetMatch[2] === '+' ? 1 : -1
    const days = parseInt(dateOffsetMatch[3], 10)
    baseDate.setDate(baseDate.getDate() + sign * days)
    return {
      kind: 'date',
      display: formatDate(baseDate),
      value: formatDate(baseDate),
      actionLabelKey: 'action.copyDate',
    }
  }

  // Explicit "timestamp NNNN" → parse as timestamp
  const explicitTsMatch = q.match(/^timestamp\s+(\d+)$/)
  if (explicitTsMatch) {
    const num = explicitTsMatch[1]
    if (num.length === 10) {
      const date = new Date(parseInt(num, 10) * 1000)
      if (isNaN(date.getTime())) return null
      return {
        kind: 'datetime',
        display: formatDateTime(date),
        value: formatDateTime(date),
        actionLabelKey: 'action.copyDateTime',
      }
    }
    if (num.length === 13) {
      const date = new Date(parseInt(num, 10))
      if (isNaN(date.getTime())) return null
      return {
        kind: 'datetime',
        display: formatDateTime(date),
        value: formatDateTime(date),
        actionLabelKey: 'action.copyDateTime',
      }
    }
    // Invalid length for timestamp
    return null
  }

  // Pure 10-digit number → seconds timestamp
  if (/^\d{10}$/.test(q)) {
    const date = new Date(parseInt(q, 10) * 1000)
    if (isNaN(date.getTime())) return null
    // Sanity check: between year 2000 and 2100
    const year = date.getFullYear()
    if (year < 2000 || year > 2100) return null
    return {
      kind: 'datetime',
      display: formatDateTime(date),
      value: formatDateTime(date),
      actionLabelKey: 'action.copyDateTime',
    }
  }

  // Pure 13-digit number → milliseconds timestamp
  if (/^\d{13}$/.test(q)) {
    const date = new Date(parseInt(q, 10))
    if (isNaN(date.getTime())) return null
    const year = date.getFullYear()
    if (year < 2000 || year > 2100) return null
    return {
      kind: 'datetime',
      display: formatDateTime(date),
      value: formatDateTime(date),
      actionLabelKey: 'action.copyDateTime',
    }
  }

  return null
}

// ─── Plugin Definition ───────────────────────────────────────────────────────

const definition: PluginDefinition = {
  instantSuggestions: [
    {
      id: 'date-time.assistant',
      title: 'provider.title',
      priority: 95,
      suggest(ctx: InstantSuggestionContext): InstantSuggestion | null {
        const parsed = parseDateTimeQuery(ctx.query, new Date())
        if (parsed === null) return null

        return {
          id: `date-time:${parsed.kind}:${ctx.query.trim()}`,
          title: `${ctx.query.trim()} → ${parsed.display}`,
          subtitle: ctx.t('provider.subtitle'),
          value: parsed.value,
          icon: 'Clock',
          actionLabel: ctx.t(parsed.actionLabelKey),
          action: { type: 'copy', text: parsed.value },
        }
      },
    },
  ],
}

export default definition
