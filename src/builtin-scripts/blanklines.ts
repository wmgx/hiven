import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'blanklines',
  title: 'Remove Blank Lines',
  titleI18n: { zh: '去除空白行' },
  icon: 'RemoveFormatting',
  aliases: ['noblanks', 'squeeze'],
  description: 'Remove blank or whitespace-only lines from text',
  descriptionI18n: { zh: '移除文本中的空白行' },
  tags: ['text', 'cleanup'],

  params: [
  ],

  run(ctx) {
    const lines = ctx.input.text.split('\n')
    return { text: lines.filter(l => l.trim() !== '').join('\n') }
  },
})
