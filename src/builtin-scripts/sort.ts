import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'sort',
  title: 'Sort Lines',
  titleI18n: { zh: '行排序' },
  icon: 'ArrowUpDown',
  aliases: ['order'],
  description: 'Sort lines alphabetically',
  descriptionI18n: { zh: '按字母顺序排列行' },
  tags: ['text'],
  optionalParams: true,

  params: [
    {
      key: 'direction',
      label: 'Direction',
      labelI18n: { zh: '方向' },
      type: 'single-select',
      options: [
        { label: 'Ascending', value: 'asc', labelI18n: { zh: '升序' } },
        { label: 'Descending', value: 'desc', labelI18n: { zh: '降序' } },
      ],
      default: 'asc',
    },
    {
      key: 'ignoreCase',
      label: 'Ignore Case',
      labelI18n: { zh: '忽略大小写' },
      type: 'boolean',
      default: false,
    },
  ],

  run(ctx) {
    const lines = ctx.input.text.split('\n')
    lines.sort((a, b) => {
      const x = ctx.params.ignoreCase ? a.toLowerCase() : a
      const y = ctx.params.ignoreCase ? b.toLowerCase() : b
      return ctx.params.direction === 'desc' ? y.localeCompare(x) : x.localeCompare(y)
    })
    return { text: lines.join('\n') }
  },
})
