import { defineAction } from 'fluxtext'
// @deps sql-formatter https://esm.sh/sql-formatter@15?bundle

export default defineAction({
  name: 'sql',
  title: 'SQL Formatter',
  titleI18n: { zh: 'SQL 格式化' },
  icon: 'Database',
  aliases: ['sql-format', 'sql-minify'],
  description: 'Format or minify SQL',
  descriptionI18n: { zh: '美化或压缩 SQL' },
  tags: ['sql', 'format'],
  optionalParams: true,

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

  async run(ctx) {
    if (ctx.params.mode === 'compact') {
      return {
        text: ctx.input.text
          .replace(/--[^\n]*/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      }
    }
    const { format } = ctx.deps['sql-formatter']
    return { text: format(ctx.input.text) }
  },
})
