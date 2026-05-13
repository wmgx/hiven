import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'reverse',
  title: 'Reverse Lines',
  titleI18n: { zh: '反转行' },
  icon: 'ArrowDownUp',
  aliases: ['flip-lines'],
  description: 'Reverse the order of lines',
  descriptionI18n: { zh: '反转行顺序' },
  tags: ['text'],
  params: [],

  run(ctx) {
    return { text: ctx.input.text.split('\n').reverse().join('\n') }
  },
})
