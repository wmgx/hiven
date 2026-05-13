import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'timestamp',
  title: 'Timestamp Convert',
  titleI18n: { zh: '时间戳转换' },
  icon: 'Clock',
  aliases: ['unix-time', 'epoch', 'date-convert'],
  description: 'Convert between timestamp and date',
  descriptionI18n: { zh: '时间戳与日期互转' },
  tags: ['time', 'convert'],

  params: [
    {
      key: 'mode',
      label: 'Mode',
      labelI18n: { zh: '模式' },
      type: 'single-select',
      options: [
        { label: 'Timestamp → Date', value: 'to-date', labelI18n: { zh: '时间戳 → 日期' } },
        { label: 'Date → Timestamp', value: 'to-ts', labelI18n: { zh: '日期 → 时间戳' } },
        { label: 'Now', value: 'now', labelI18n: { zh: '当前时间' } },
      ],
      default: 'to-date',
    },
  ],

  run(ctx) {
    try {
      if (ctx.params.mode === 'now') {
        const now = Date.now()
        return { text: `${Math.floor(now / 1000)} (seconds)\n${now} (milliseconds)\n${new Date(now).toISOString()}` }
      }
      if (ctx.params.mode === 'to-date') {
        let ts = Number(ctx.input.text.trim())
        if (ts < 1e12) ts *= 1000 // seconds → ms
        return { text: new Date(ts).toISOString() }
      }
      const d = new Date(ctx.input.text.trim())
      if (isNaN(d.getTime())) return { text: 'Error: Invalid date' }
      return { text: `${Math.floor(d.getTime() / 1000)} (seconds)\n${d.getTime()} (milliseconds)` }
    } catch (e: any) {
      return { text: `Error: ${e.message}` }
    }
  },
})
