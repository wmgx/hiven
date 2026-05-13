import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'url',
  title: 'URL Encode/Decode',
  titleI18n: { zh: 'URL 编解码' },
  icon: 'Link',
  aliases: ['urlencode', 'urldecode'],
  description: 'URL encode or decode text',
  descriptionI18n: { zh: 'URL 编码或解码文本' },
  tags: ['encode', 'decode', 'url'],

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
      if (ctx.params.mode === 'encode') return { text: encodeURIComponent(ctx.input.text) }
      return { text: decodeURIComponent(ctx.input.text.trim()) }
    } catch (e: any) {
      return { text: `Error: ${e.message}` }
    }
  },
})
