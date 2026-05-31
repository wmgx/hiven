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
    {
      key: 'keepOne',
      label: 'Collapse to single blank line',
      labelI18n: { zh: '连续空行合并为一行' },
      type: 'boolean',
      default: false,
    },
  ],

  run(ctx) {
    const lines = ctx.input.text.split('\n')
    if (ctx.params.keepOne) {
      const result: string[] = []
      let prevBlank = false
      for (const line of lines) {
        const isBlank = line.trim() === ''
        if (isBlank) {
          if (!prevBlank) result.push('')
          prevBlank = true
        } else {
          result.push(line)
          prevBlank = false
        }
      }
      return { text: result.join('\n') }
    }
    return { text: lines.filter(l => l.trim() !== '').join('\n') }
  },
})
