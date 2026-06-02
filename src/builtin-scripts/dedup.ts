import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'dedup',
  title: 'Remove Duplicate Lines',
  titleI18n: { zh: '去除重复行' },
  icon: 'Copy',
  aliases: ['unique', 'distinct'],
  description: 'Remove duplicate lines from text',
  descriptionI18n: { zh: '移除文本中的重复行' },
  tags: ['text', 'cleanup'],
  optionalParams: true,

  params: [
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
    const seen = new Set<string>()
    const result: string[] = []
    for (const line of lines) {
      const key = ctx.params.ignoreCase ? line.toLowerCase() : line
      if (!seen.has(key)) {
        seen.add(key)
        result.push(line)
      }
    }
    return { text: result.join('\n') }
  },
})
