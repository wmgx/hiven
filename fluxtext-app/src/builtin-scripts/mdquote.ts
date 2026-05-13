import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'mdquote',
  title: 'Markdown Quote',
  titleI18n: { zh: 'Markdown 引用' },
  icon: 'MessageSquareQuote',
  aliases: ['blockquote', 'quote'],
  description: 'Add or remove Markdown quote prefix',
  descriptionI18n: { zh: '添加或移除 Markdown 引用前缀' },
  tags: ['markdown', 'text'],

  params: [
    {
      key: 'mode',
      label: 'Mode',
      labelI18n: { zh: '模式' },
      type: 'single-select',
      options: [
        { label: 'Add', value: 'add', labelI18n: { zh: '添加' } },
        { label: 'Remove', value: 'remove', labelI18n: { zh: '移除' } },
      ],
      default: 'add',
    },
  ],

  run(ctx) {
    const lines = ctx.input.text.split('\n')
    if (ctx.params.mode === 'remove') {
      return { text: lines.map(l => l.replace(/^>\s?/, '')).join('\n') }
    }
    return { text: lines.map(l => '> ' + l).join('\n') }
  },
})
