import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'wrap',
  title: 'Wrap Lines',
  titleI18n: { zh: '包裹每行' },
  icon: 'WrapText',
  aliases: ['wrap-lines', 'surround'],
  description: 'Wrap each line with prefix and suffix',
  descriptionI18n: { zh: '在每行两端添加指定文本' },
  tags: ['text', 'lines'],
  optionalParams: true,

  params: [
    {
      key: 'left',
      label: 'Left',
      labelI18n: { zh: '左侧' },
      type: 'text',
      default: '"',
    },
    {
      key: 'right',
      label: 'Right',
      labelI18n: { zh: '右侧' },
      type: 'text',
      default: '"',
    },
  ],

  run(ctx) {
    const left = ctx.params.left ?? '"'
    const right = ctx.params.right ?? '"'
    const lines = ctx.input.text.split('\n').map(l => left + l + right)
    return { text: lines.join('\n') }
  },
})
