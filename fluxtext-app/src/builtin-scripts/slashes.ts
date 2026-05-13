import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'slashes',
  title: 'Add/Remove Slashes',
  titleI18n: { zh: '转义/反转义' },
  icon: 'Quote',
  aliases: ['escape', 'unescape', 'addslashes', 'stripslashes'],
  description: 'Escape or unescape special characters',
  descriptionI18n: { zh: '转义或反转义特殊字符' },
  tags: ['text', 'escape'],

  params: [
    {
      key: 'mode',
      label: 'Mode',
      labelI18n: { zh: '模式' },
      type: 'single-select',
      options: [
        { label: 'Escape', value: 'escape', labelI18n: { zh: '转义' } },
        { label: 'Unescape', value: 'unescape', labelI18n: { zh: '反转义' } },
      ],
      default: 'escape',
    },
  ],

  run(ctx) {
    if (ctx.params.mode === 'escape') {
      return {
        text: ctx.input.text
          .replace(/\\/g, '\\\\')
          .replace(/'/g, "\\'")
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t')
      }
    }
    return {
      text: ctx.input.text
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, '\\')
    }
  },
})
