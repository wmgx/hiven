import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'html',
  title: 'HTML Encode/Decode',
  titleI18n: { zh: 'HTML 编解码' },
  icon: 'FileCode',
  aliases: ['html-entities', 'html-escape'],
  description: 'HTML entity encode or decode',
  descriptionI18n: { zh: 'HTML 实体编码或解码' },
  tags: ['html', 'encode', 'decode'],

  params: [
    {
      key: 'mode',
      label: 'Mode',
      labelI18n: { zh: '模式' },
      type: 'single-select',
      options: [
        { label: 'Encode', value: 'encode', labelI18n: { zh: '编码' } },
        { label: 'Decode', value: 'decode', labelI18n: { zh: '解码' } },
      ],
      default: 'encode',
    },
  ],

  run(ctx) {
    if (ctx.params.mode === 'encode') {
      return {
        text: ctx.input.text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;')
      }
    }
    return {
      text: ctx.input.text
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&')
    }
  },
})
