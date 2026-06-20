import { definePlugin, textOutput, type TextInput, type LauncherDynamicContext, type LauncherItemContribution } from '@hiven/plugin'

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

function formatLocalDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatOffsetDateTime(date: Date, offsetMinutes?: number): string {
  const off = offsetMinutes !== undefined ? offsetMinutes : -date.getTimezoneOffset()
  const shifted = new Date(date.getTime() + off * 60000)
  const iso = shifted.toISOString().replace(/\.\d{3}Z$/, '')
  const sign = off >= 0 ? '+' : '-'
  const absOff = Math.abs(off)
  const h = String(Math.floor(absOff / 60)).padStart(2, '0')
  const m = String(absOff % 60).padStart(2, '0')
  return `${iso.replace('T', ' ')}${sign}${h}:${m}`
}

function parseTzSuffix(str: string): { body: string; offsetMinutes: number | undefined } {
  const namedMatch = str.match(/\s+((?:utc|gmt)\s*(?:[+-]\s*\d{1,2}(?::?\d{2})?)?|z)\s*$/i)
  if (namedMatch) {
    const offset = parseTimezoneToken(namedMatch[1])
    if (offset !== null) {
      return { body: str.slice(0, namedMatch.index!).trim(), offsetMinutes: offset }
    }
  }

  const match = str.match(/\s*([+-])(\d{1,2})(?::?(\d{2}))?\s*$/)
  if (!match) {
    const bare = str.match(/\s*[+-]\s*$/)
    if (bare) return { body: str.slice(0, bare.index!).trim(), offsetMinutes: -(new Date().getTimezoneOffset()) }
    return { body: str, offsetMinutes: undefined }
  }

  const signIndex = str.indexOf(match[1], match.index)
  const body = str.slice(0, signIndex).trim()
  const previousChar = signIndex > 0 ? str[signIndex - 1] : ''
  if (previousChar && !/\s/.test(previousChar) && !/[Tt:]/.test(body)) {
    return { body: str, offsetMinutes: undefined }
  }
  const offset = parseOffsetValue(match[1], match[2], match[3])
  return { body, offsetMinutes: offset ?? undefined }
}

function tryParseTimestamp(value: string): number {
  const n = Number(value)
  if (Number.isNaN(n) || !Number.isFinite(n) || value.length === 0) return NaN
  return n < 1e12 ? n * 1000 : n
}

function formatTimestamp(date: Date, unit: 's' | 'ms'): string {
  return unit === 's' ? `${Math.floor(date.getTime() / 1000)}` : `${date.getTime()}`
}

function parseOffsetValue(sign: string, hoursText: string, minutesText?: string): number | null {
  const hours = parseInt(hoursText, 10)
  const minutes = parseInt(minutesText || '0', 10)
  if (hours > 14 || minutes > 59) return null
  return (sign === '+' ? 1 : -1) * (hours * 60 + minutes)
}

function parseTimezoneToken(value: string): number | null {
  const normalized = value.trim()
  if (/^(?:z|utc|gmt)$/i.test(normalized)) return 0
  const named = normalized.match(/^(?:utc|gmt)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i)
  if (named) return parseOffsetValue(named[1], named[2], named[3])
  const numeric = normalized.match(/^([+-])\s*(\d{1,2})(?::?(\d{2}))?$/)
  if (numeric) return parseOffsetValue(numeric[1], numeric[2], numeric[3])
  return null
}

function formatNowResult(date: Date, offsetMinutes?: number): string {
  const formattedDate = offsetMinutes === undefined
    ? formatLocalDateTime(date)
    : formatOffsetDateTime(date, offsetMinutes)
  return `${date.getTime()} | ${formattedDate}`
}

function parseUtcOffset(value: string): number | null {
  const offset = parseTimezoneToken(value)
  return offset === null ? null : offset
}

function parseNowOffset(value: string): { amount: number; unit: 'day' | 'hour' } | null {
  const match = value.match(/^now\s*\+\s*(\d+)\s*(d|day|days|h|hour|hours)$/i)
  if (!match) return null
  const amount = parseInt(match[1], 10)
  const unit = match[2].toLowerCase().startsWith('h') ? 'hour' : 'day'
  return { amount, unit }
}

type ParsedResult = {
  kind: 'datetime' | 'date' | 'timestamp'
  display: string
  value: string
  actionLabelKey: string
}

function resultKindLabel(kind: ParsedResult['kind'], t: LauncherDynamicContext['t']): string {
  if (kind === 'timestamp') return t('result.timestamp')
  if (kind === 'date') return t('result.date')
  return t('result.datetime')
}

function nowResult(date: Date, offsetMinutes?: number): ParsedResult {
  const value = formatNowResult(date, offsetMinutes)
  return {
    kind: 'datetime',
    display: value,
    value,
    actionLabelKey: 'action.copyDateTime',
  }
}

function parseNowExpression(query: string, now: Date): ParsedResult | null {
  const q = query.trim().toLowerCase()

  if (q === 'now') {
    return nowResult(now)
  }

  const nowOffset = parseNowOffset(q)
  if (nowOffset) {
    const date = new Date(now)
    if (nowOffset.unit === 'day') {
      date.setDate(date.getDate() + nowOffset.amount)
    } else {
      date.setHours(date.getHours() + nowOffset.amount)
    }
    return nowResult(date)
  }

  const utcOffsetMatch = q.match(/^now\s+(.+)$/)
  if (utcOffsetMatch) {
    const offsetMinutes = parseUtcOffset(utcOffsetMatch[1])
    if (offsetMinutes !== null) {
      return nowResult(now, offsetMinutes)
    }
  }

  if (/^now\s*[+-]\s*\d{1,2}(?::?\d{2})?$/.test(q)) {
    const offsetMinutes = parseTzSuffix(q.slice(3)).offsetMinutes
    if (offsetMinutes !== undefined) return nowResult(now, offsetMinutes)
  }

  return null
}

function parseDateTimeQuery(query: string, now: Date): ParsedResult | null {
  const q = query.trim().toLowerCase()
  const nowParsed = parseNowExpression(query, now)
  if (nowParsed) return nowParsed

  if (q === 'timestamp' || q === 'unix time' || q === 'now timestamp') {
    const ts = Math.floor(now.getTime() / 1000).toString()
    return {
      kind: 'timestamp',
      display: ts,
      value: ts,
      actionLabelKey: 'action.copyTimestamp',
    }
  }

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
      display: formatLocalDateTime(tomorrow),
      value: formatLocalDateTime(tomorrow),
      actionLabelKey: 'action.copyDateTime',
    }
  }

  const dateOffsetMatch = q.match(/^(\d{4}-\d{2}-\d{2})\s*([+-])\s*(\d+)\s*days?$/)
  if (dateOffsetMatch) {
    const baseDate = new Date(dateOffsetMatch[1] + 'T00:00:00')
    if (Number.isNaN(baseDate.getTime())) return null
    const sign = dateOffsetMatch[2] === '+' ? 1 : -1
    const days = parseInt(dateOffsetMatch[3], 10)
    baseDate.setDate(baseDate.getDate() + sign * days)
    return {
      kind: 'date',
      display: formatLocalDate(baseDate),
      value: formatLocalDate(baseDate),
      actionLabelKey: 'action.copyDate',
    }
  }

  const explicitTsMatch = q.match(/^timestamp\s+(\d+)$/)
  if (explicitTsMatch) {
    const parsed = parseTimestampForSuggestion(explicitTsMatch[1])
    if (!parsed) return null
    return parsed
  }

  if (/^\d{10}$/.test(q) || /^\d{13}$/.test(q)) {
    return parseTimestampForSuggestion(q)
  }

  return null
}

function parseDateForTimestampSuggestions(value: string): ParsedResult[] {
  const trimmed = value.trim()
  if (!/\d{4}-\d{1,2}-\d{1,2}/.test(trimmed)) return []

  const { body, offsetMinutes } = parseTzSuffix(trimmed)
  let date = new Date(body)
  if (Number.isNaN(date.getTime())) date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) return []
  if (offsetMinutes !== undefined) {
    const localOffsetMinutes = -date.getTimezoneOffset()
    const utcMs = date.getTime() + (localOffsetMinutes - offsetMinutes) * 60000
    date = new Date(utcMs)
  }

  const year = date.getFullYear()
  if (year < 2000 || year > 2100) return []

  return [
    {
      kind: 'timestamp',
      display: `${formatTimestamp(date, 'ms')} ms`,
      value: formatTimestamp(date, 'ms'),
      actionLabelKey: 'action.copyTimestamp',
    },
    {
      kind: 'timestamp',
      display: `${formatTimestamp(date, 's')} s`,
      value: formatTimestamp(date, 's'),
      actionLabelKey: 'action.copyTimestamp',
    },
  ]
}

function parseTimestampForSuggestion(value: string): ParsedResult | null {
  const date = value.length === 10
    ? new Date(parseInt(value, 10) * 1000)
    : value.length === 13
      ? new Date(parseInt(value, 10))
      : null
  if (!date || Number.isNaN(date.getTime())) return null
  const year = date.getFullYear()
  if (year < 2000 || year > 2100) return null
  return {
    kind: 'datetime',
    display: formatLocalDateTime(date),
    value: formatLocalDateTime(date),
    actionLabelKey: 'action.copyDateTime',
  }
}

function convertTimestampText(text: string, params: Record<string, unknown>, inPlace: boolean): string {
  const overwrite = params.overwrite !== 'no'
  const showOriginal = inPlace && !overwrite
  const unit = (params.unit as 's' | 'ms') || 'ms'
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim()
    if (!trimmed) return ''

    const lowerTrimmed = trimmed.toLowerCase()
    if (lowerTrimmed === 'now' || lowerTrimmed.startsWith('now+') || lowerTrimmed.startsWith('now-') || lowerTrimmed.startsWith('now utc')) {
      const parsed = parseNowExpression(trimmed, new Date())
      if (parsed) {
        return showOriginal ? `${trimmed} -> ${parsed.value}` : parsed.value
      }
    }

    const { body, offsetMinutes } = parseTzSuffix(trimmed)
    const tsMs = tryParseTimestamp(body)

    try {
      if (!Number.isNaN(tsMs)) {
        const result = formatOffsetDateTime(new Date(tsMs), offsetMinutes)
        return showOriginal ? `${trimmed} -> ${result}` : result
      }

      let date = new Date(body)
      if (Number.isNaN(date.getTime())) date = new Date(trimmed)
      if (Number.isNaN(date.getTime())) return `Error: Invalid date "${trimmed}"`
      if (offsetMinutes !== undefined) {
        const localOffsetMinutes = -date.getTimezoneOffset()
        const utcMs = date.getTime() + (localOffsetMinutes - offsetMinutes) * 60000
        date = new Date(utcMs)
      }
      const result = formatTimestamp(date, unit)
      return showOriginal ? `${trimmed} -> ${result}` : result
    } catch (error: unknown) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`
    }
  }).join('\n')
}

const TIMESTAMP_PARAMS = [
  {
    key: 'unit',
    label: 'param.unit.label',
    type: 'single-select' as const,
    options: [
      { label: 'param.unit.option.ms.label', value: 'ms' },
      { label: 'param.unit.option.s.label', value: 's' },
    ],
    default: 'ms',
  },
  {
    key: 'overwrite',
    label: 'param.overwrite.label',
    type: 'single-select' as const,
    options: [
      { label: 'param.overwrite.option.yes.label', value: 'yes' },
      { label: 'param.overwrite.option.no.label', value: 'no' },
    ],
    default: 'yes',
  },
]

export const dateTimeAssistantPlugin = definePlugin({
  tools: [
    {
      id: 'timestamp.run',
      title: 'command.timestamp.title',
      subtitle: 'command.timestamp.description',
      icon: 'Clock',
      aliases: ['unix-time', 'epoch', 'date-convert'],
      inputPolicy: { mode: 'auto' },
      params: TIMESTAMP_PARAMS,
      run(ctx) {
        return ctx.output.replaceActiveText(convertTimestampText(ctx.input.text, ctx.params, ctx.input.source === 'all'))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
  commands: [
    {
      id: 'timestamp.run',
      title: 'command.timestamp.title',
      description: 'command.timestamp.description',
      icon: 'Clock',
      aliases: ['unix-time', 'epoch', 'date-convert'],
      live: { live: { enabled: true, trigger: 'on-input', sideEffects: 'none', debounceMs: 250 } },
      params: TIMESTAMP_PARAMS,
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        const inPlace = !!input?.paneId
        return textOutput(convertTimestampText(text, ctx.params, inPlace))
      },
    },
  ],
  launcher: {
    dynamicItems(ctx: LauncherDynamicContext): LauncherItemContribution[] {
      const now = new Date()
      const parsed = parseDateTimeQuery(ctx.query, now)
      const dateTimestampResults = parseDateForTimestampSuggestions(ctx.query)
      if (!parsed && dateTimestampResults.length === 0) return []

      // "now" expressions produce multiple items (timestamp + datetime)
      const nowParsed = parseNowExpression(ctx.query, now)
      if (nowParsed) {
        const separatorIndex = parsed.value.indexOf(' | ')
        if (separatorIndex >= 0) {
          const timestampValue = parsed.value.slice(0, separatorIndex)
          const dateTimeValue = parsed.value.slice(separatorIndex + 3)
          const trimmed = ctx.query.trim()
          return [
            {
              id: 'dt-now-timestamp',
              display: { title: `${trimmed} -> ${timestampValue}`, subtitle: resultKindLabel('timestamp', ctx.t), icon: 'Clock' },
              behavior: { type: 'perform' },
              async execute(ctx2) {
                await ctx2.api.copyText(timestampValue)
                return { ok: true, output: { choices: [{ id: 'copy', title: timestampValue, primaryAction: async () => { await ctx2.api.copyText(timestampValue) } }] } }
              },
            },
            {
              id: 'dt-now-datetime',
              display: { title: `${trimmed} -> ${dateTimeValue}`, subtitle: resultKindLabel('datetime', ctx.t), icon: 'Clock' },
              behavior: { type: 'perform' },
              async execute(ctx2) {
                await ctx2.api.copyText(dateTimeValue)
                return { ok: true, output: { choices: [{ id: 'copy', title: dateTimeValue, primaryAction: async () => { await ctx2.api.copyText(dateTimeValue) } }] } }
              },
            },
          ]
        }
      }

      if (dateTimestampResults.length > 0) {
        const trimmed = ctx.query.trim()
        return dateTimestampResults.map((result, index) => ({
          id: `dt-date-timestamp-${index}`,
          display: { title: `${trimmed} -> ${result.display}`, subtitle: resultKindLabel(result.kind, ctx.t), icon: 'Clock' },
          behavior: { type: 'perform' },
          async execute(ctx2) {
            await ctx2.api.copyText(result.value)
            return { ok: true, output: { choices: [{ id: 'copy', title: result.value, primaryAction: async () => { await ctx2.api.copyText(result.value) } }] } }
          },
        }))
      }

      // Single result (timestamp conversion, date offset, tomorrow, etc.)
      const trimmed = ctx.query.trim()
      return [{
        id: 'dt-result',
        display: { title: `${trimmed} -> ${parsed.display}`, subtitle: resultKindLabel(parsed.kind, ctx.t), icon: 'Clock' },
        behavior: { type: 'perform' },
        async execute(ctx2) {
          await ctx2.api.copyText(parsed.value)
          return { ok: true, output: { choices: [{ id: 'copy', title: parsed.value, primaryAction: async () => { await ctx2.api.copyText(parsed.value) } }] } }
        },
      }]
    },
  },
})

export default dateTimeAssistantPlugin
