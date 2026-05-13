import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'count',
  title: 'Text Statistics',
  titleI18n: { zh: '文本统计' },
  icon: 'BarChart',
  aliases: ['stats', 'wc'],
  description: 'Count lines, words, and characters',
  descriptionI18n: { zh: '统计行数、词数和字符数' },
  tags: ['text', 'stats'],
  params: [],

  run(ctx) {
    const text = ctx.input.text
    const lines = text.split('\n').length
    const words = text.split(/\s+/).filter(w => w.length > 0).length
    const chars = text.length
    const charsNoSpace = text.replace(/\s/g, '').length
    return {
      text: `Lines: ${lines}\nWords: ${words}\nCharacters: ${chars}\nCharacters (no spaces): ${charsNoSpace}`
    }
  },
})
