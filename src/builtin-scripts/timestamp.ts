import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'timestamp',
  title: 'Timestamp Convert',
  titleI18n: { zh: '时间戳转换' },
  icon: 'Clock',
  aliases: ['unix-time', 'epoch', 'date-convert'],
  description: 'Auto-convert between timestamp and date (supports seconds/ms/μs/ns)',
  descriptionI18n: { zh: '自动互转时间戳与日期（支持秒/毫秒/微秒/纳秒）' },
  tags: ['time', 'convert'],

  params: [],

  run(ctx) {
    try {
      const input = ctx.input.text.trim()

      // 空输入或 "now" -> 输出当前时间
      if (!input || input.toLowerCase() === 'now') {
        return { text: formatNow() }
      }

      const lines = input.split('\n')
      const results = lines.map(line => convertLine(line.trim()))
      return { text: results.join('\n\n') }
    } catch (e: any) {
      return { text: `Error: ${e.message}` }
    }
  },
})

function formatNow(): string {
  const now = Date.now()
  return `${Math.floor(now / 1000)} (seconds)\n${now} (milliseconds)\n${new Date(now).toISOString()}`
}

function convertLine(line: string): string {
  if (!line) return ''

  // "now" 特殊处理（多行场景中某行是 now）
  if (line.toLowerCase() === 'now') {
    return formatNow()
  }

  // 纯数字：按位数判断时间戳精度
  if (/^\d+$/.test(line)) {
    const len = line.length
    const num = Number(line)
    if (len === 10) {
      return new Date(num * 1000).toISOString()
    } else if (len === 13) {
      return new Date(num).toISOString()
    } else if (len === 16) {
      return new Date(num / 1000).toISOString()
    } else if (len === 19) {
      return new Date(num / 1000000).toISOString()
    } else {
      return `Error: Cannot infer timestamp unit for "${line}". Expected 10/13/16/19 digit timestamp or parseable date.`
    }
  }

  // 尝试日期字符串解析
  const d = new Date(line)
  if (!isNaN(d.getTime())) {
    return `${Math.floor(d.getTime() / 1000)} (seconds)\n${d.getTime()} (milliseconds)\n${d.toISOString()}`
  }

  return `Error: Cannot infer input type for "${line}". Expected numeric timestamp or parseable date string.`
}
