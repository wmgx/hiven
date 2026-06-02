import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'sqlin',
  title: 'Lines to SQL IN',
  titleI18n: { zh: '行转 SQL IN' },
  icon: 'Database',
  aliases: ['sql-in', 'lines-to-sql'],
  description: 'Convert lines to SQL IN clause',
  descriptionI18n: { zh: '将多行文本转为 SQL IN 子句' },
  tags: ['sql', 'convert'],
  optionalParams: true,

  params: [
    {
      key: 'mode',
      label: 'Mode',
      labelI18n: { zh: '模式' },
      type: 'single-select',
      options: [
        { label: 'String', value: 'string', labelI18n: { zh: '字符串' } },
        { label: 'Number', value: 'number', labelI18n: { zh: '数字' } },
      ],
      default: 'string',
    },
  ],

  run(ctx) {
    const lines = ctx.input.text.split('\n').filter(l => l.trim() !== '')
    if (ctx.params.mode === 'number') {
      const values = lines.map(l => l.trim())
      return { text: '(' + values.join(',') + ')' }
    }
    const values = lines.map(l => "'" + l.trim().replace(/'/g, "''") + "'")
    return { text: '(' + values.join(',') + ')' }
  },
})
