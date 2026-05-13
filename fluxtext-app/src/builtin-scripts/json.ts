import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'json',
  title: 'JSON Formatter',
  titleI18n: { zh: 'JSON 格式化' },
  icon: 'Braces',
  aliases: ['json-format', 'pretty-json'],
  description: 'Pretty-print or compact JSON',
  descriptionI18n: { zh: '美化或压缩 JSON' },
  tags: ['json', 'format'],

  params: [
    {
      key: 'mode',
      label: 'Mode',
      labelI18n: { zh: '模式' },
      type: 'single-select',
      options: [
        { label: 'Pretty', value: 'pretty', labelI18n: { zh: '美化' } },
        { label: 'Compact', value: 'compact', labelI18n: { zh: '压缩' } },
      ],
      default: 'pretty',
    },
  ],

  run(ctx) {
    try {
      const obj = JSON.parse(ctx.input.text)
      if (ctx.params.mode === 'compact') return { text: JSON.stringify(obj) }
      return { text: JSON.stringify(obj, null, 2) }
    } catch (e: any) {
      return { text: `Error: ${e.message}` }
    }
  },
})
