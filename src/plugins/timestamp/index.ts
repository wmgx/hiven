  /**
 * First-party Timestamp Convert plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'

/** 按指定时区偏移（分钟）格式化日期：YYYY-MM-DD HH:mm:ss+HH:MM */
function formatDate(d: Date, offsetMinutes?: number): string {
  const off = offsetMinutes !== undefined ? offsetMinutes : -d.getTimezoneOffset()
  const ms = d.getTime() + off * 60000
  const local = new Date(ms)
  const iso = local.toISOString().replace(/\.\d{3}Z$/, '')
  const sign = off >= 0 ? '+' : '-'
  const absOff = Math.abs(off)
  const h = String(Math.floor(absOff / 60)).padStart(2, '0')
  const m = String(absOff % 60).padStart(2, '0')
  return `${iso.replace('T', ' ')}${sign}${h}:${m}`
}

/** 解析时区后缀（+8, +08:00, -5:30 等），返回偏移分钟数，没有则返回 undefined */
function parseTzSuffix(str: string): { body: string; offsetMinutes: number | undefined } {
  const m = str.match(/\s*([+-])(\d{1,2})(?::?(\d{2}))?\s*$/)
  if (!m) {
    // 只有 "+" 或 "-" 结尾，当作本地时区
    const bare = str.match(/\s*[+-]\s*$/)
    if (bare) return { body: str.slice(0, bare.index!).trim(), offsetMinutes: -(new Date().getTimezoneOffset()) }
    return { body: str, offsetMinutes: undefined }
  }
  const body = str.slice(0, m.index!).trim()
  const sign = m[1] === '+' ? 1 : -1
  const hours = parseInt(m[2], 10)
  const mins = parseInt(m[3] || '0', 10)
  return { body, offsetMinutes: sign * (hours * 60 + mins) }
}

/** 尝试将值解析为时间戳，自动识别秒/毫秒，返回毫秒数或 NaN */
function tryParseTimestamp(value: string): number {
  const n = Number(value)
  if (isNaN(n) || !isFinite(n) || value.length === 0) return NaN
  return n < 1e12 ? n * 1000 : n
}

/** 将 Date 转为时间戳字符串，根据 unit 输出 */
function formatTimestamp(d: Date, unit: 's' | 'ms'): string {
  return unit === 's' ? `${Math.floor(d.getTime() / 1000)}` : `${d.getTime()}`
}

export const timestampPlugin = definePlugin({
  commands: [
    {
      id: 'timestamp.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Clock',
      aliases: ['unix-time', 'epoch', 'date-convert'],
      live: { live: { enabled: true, trigger: 'on-input', sideEffects: 'none', debounceMs: 250 } },
      optionalParams: true,
      params: [
        {
          key: 'unit',
          label: '时间戳单位',
          type: 'single-select',
          options: [
            { label: '毫秒 (ms)', value: 'ms' },
            { label: '秒 (s)', value: 's' },
          ],
          default: 'ms',
        },
        {
          key: 'overwrite',
          label: '覆盖原文',
          type: 'single-select',
          options: [
            { label: '覆盖', value: 'yes' },
            { label: '保留原值', value: 'no' },
          ],
          default: 'yes',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        const inPlace = !!input?.paneId
        const overwrite = ctx.params.overwrite !== 'no'
        const showOriginal = inPlace && !overwrite
        const unit = (ctx.params.unit as 's' | 'ms') || 'ms'
        const reply = (t: string) => ({ effects: [{ type: 'text.replace' as const, target: input?.paneId ? { paneId: input.paneId } : 'active-input' as const, text: t }] })

        const lines = text.split(/\r?\n/)
        const results = lines.map((line) => {
          const trimmed = line.trim()
          if (!trimmed) return ''

          // "now" 特判（支持 now+8 等时区后缀）
          const lowerTrimmed = trimmed.toLowerCase()
          if (lowerTrimmed === 'now' || lowerTrimmed.startsWith('now+') || lowerTrimmed.startsWith('now-')) {
            const now = Date.now()
            const tzPart = trimmed.slice(3)
            const tz = tzPart ? parseTzSuffix(tzPart).offsetMinutes : undefined
            const result = `${formatTimestamp(new Date(now), unit)} | ${formatDate(new Date(now), tz)}`
            return showOriginal ? `${trimmed} → ${result}` : result
          }

          // 解析可能的时区后缀
          const { body, offsetMinutes } = parseTzSuffix(trimmed)

          // 自动识别：body 为纯数字则转日期，否则转时间戳
          const tsMs = tryParseTimestamp(body)
          const isTimestamp = !isNaN(tsMs)

          try {
            if (isTimestamp) {
              const result = formatDate(new Date(tsMs), offsetMinutes)
              return showOriginal ? `${trimmed} → ${result}` : result
            }
            // 日期字符串转时间戳
            let d = new Date(body)
            if (isNaN(d.getTime())) d = new Date(trimmed)
            if (isNaN(d.getTime())) return `Error: Invalid date "${trimmed}"`
            if (offsetMinutes !== undefined) {
              const utcMs = d.getTime() - offsetMinutes * 60000 + d.getTimezoneOffset() * 60000
              d = new Date(utcMs)
            }
            const result = formatTimestamp(d, unit)
            return showOriginal ? `${trimmed} → ${result}` : result
          } catch (e: unknown) {
            return `Error: ${e instanceof Error ? e.message : String(e)}`
          }
        })

        return reply(results.join('\n'))
      },
    },
  ],
})

export default timestampPlugin
