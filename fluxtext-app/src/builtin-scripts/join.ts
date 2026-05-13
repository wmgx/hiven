import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'join',
  title: 'Join Lines',
  titleI18n: { zh: '合并行' },
  icon: 'Merge',
  aliases: ['merge-lines', 'concat-lines'],
  description: 'Join lines with a separator',
  descriptionI18n: { zh: '用分隔符合并行' },
  tags: ['text'],

  params: [
    {
      key: 'separator',
      label: 'Separator',
      labelI18n: { zh: '分隔符' },
      type: 'text',
      default: ',',
    },
  ],

  run(ctx) {
    const sep = (ctx.params.separator ?? ',')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
    return { text: ctx.input.text.split('\n').join(sep) }
  },
})
