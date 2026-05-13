import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'extract',
  title: 'Extract Patterns',
  titleI18n: { zh: '提取模式' },
  icon: 'Regex',
  aliases: ['grep', 'filter'],
  description: 'Extract lines or patterns matching regex',
  descriptionI18n: { zh: '提取匹配正则的行或内容' },
  tags: ['text', 'extract'],

  params: [
    { key: 'pattern', label: 'Regex Pattern', labelI18n: { zh: '正则表达式' }, type: 'text', default: '', required: true },
    { key: 'matchOnly', label: 'Extract Matches Only', labelI18n: { zh: '仅提取匹配内容' }, type: 'boolean', default: false },
  ],

  run(ctx) {
    const { pattern, matchOnly } = ctx.params
    if (!pattern) return { text: ctx.input.text }
    try {
      const re = new RegExp(pattern, 'gim')
      if (matchOnly) {
        const matches = ctx.input.text.match(re) || []
        return { text: matches.join('\n') }
      }
      const lines = ctx.input.text.split('\n').filter(l => re.test(l))
      return { text: lines.join('\n') }
    } catch (e: any) {
      return { text: `Error: ${e.message}` }
    }
  },
})
