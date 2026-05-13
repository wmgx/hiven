import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'trim',
  title: 'Trim Whitespace',
  titleI18n: { zh: '去除空白' },
  icon: 'Type',
  aliases: ['strip', 'clean'],
  description: 'Strip leading/trailing whitespace from each line',
  descriptionI18n: { zh: '去除每行首尾空白字符' },
  tags: ['text', 'cleanup'],

  params: [],

  run(ctx) {
    const lines = ctx.input.text.split('\n').map(l => l.trim())
    return { text: lines.join('\n') }
  },
})
