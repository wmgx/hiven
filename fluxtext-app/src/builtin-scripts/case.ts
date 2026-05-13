import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'case',
  title: 'Case Convert',
  titleI18n: { zh: '大小写转换' },
  icon: 'CaseSensitive',
  aliases: ['uppercase', 'lowercase', 'titlecase'],
  description: 'Convert text case',
  descriptionI18n: { zh: '转换文本大小写' },
  tags: ['text', 'transform'],

  params: [
    {
      key: 'mode',
      label: 'Convert To',
      labelI18n: { zh: '转换为' },
      type: 'single-select',
      options: [
        { label: 'UPPERCASE', value: 'upper', labelI18n: { zh: '大写' } },
        { label: 'lowercase', value: 'lower', labelI18n: { zh: '小写' } },
        { label: 'Title Case', value: 'title', labelI18n: { zh: '首字母大写' } },
        { label: 'camelCase', value: 'camel' },
        { label: 'snake_case', value: 'snake' },
      ],
      default: 'upper',
    },
  ],

  run(ctx) {
    const text = ctx.input.text
    switch (ctx.params.mode) {
      case 'upper': return { text: text.toUpperCase() }
      case 'lower': return { text: text.toLowerCase() }
      case 'title': return { text: text.replace(/\b\w/g, c => c.toUpperCase()) }
      case 'camel': return { text: text.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '') }
      case 'snake': return { text: text.replace(/[\s-]+/g, '_').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase() }
      default: return { text }
    }
  },
})
