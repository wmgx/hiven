import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'base64',
  title: 'Base64 Encode/Decode',
  titleI18n: { zh: 'Base64 编解码' },
  icon: 'Binary',
  aliases: ['encode', 'decode'],
  description: 'Base64 encode or decode text',
  descriptionI18n: { zh: 'Base64 编码或解码文本' },
  tags: ['encode', 'decode'],

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
    try {
      if (ctx.params.mode === 'encode') {
        return { text: btoa(unescape(encodeURIComponent(ctx.input.text))) }
      }
      return { text: decodeURIComponent(escape(atob(ctx.input.text.trim()))) }
    } catch (e: any) {
      return { text: `Error: ${e.message}` }
    }
  },
})
