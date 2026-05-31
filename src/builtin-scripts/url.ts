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
        { label: 'Auto', value: 'auto', labelI18n: { zh: '自动' } },
        { label: 'Encode', value: 'encode', labelI18n: { zh: '编码' } },
        { label: 'Decode', value: 'decode', labelI18n: { zh: '解码' } },
      ],
      default: 'auto',
    },
  ],

  run(ctx) {
    try {
      const mode = ctx.params.mode

      if (mode === 'encode') return { text: encodeURIComponent(ctx.input.text) }
      if (mode === 'decode') return { text: decodeURIComponent(ctx.input.text.trim()) }

      // auto mode
      const input = ctx.input.text.trim()

      // 包含 %XX 编码且能成功解码
      if (/%[0-9A-Fa-f]{2}/.test(input)) {
        try {
          const decoded = decodeURIComponent(input)
          if (decoded !== input) {
            return { text: decoded }
          }
        } catch { /* fall through */ }
      }

      // 包含中文、空格等需要编码的字符
      if (/[^\x21-\x7E]/.test(input) || / /.test(input)) {
        return { text: encodeURIComponent(input) }
      }

      // 已是普通 URL，无明显编码片段，不静默整体 encode
      if (/^https?:\/\//.test(input)) {
        return { text: 'Error: Cannot infer URL operation. Input looks like a plain URL with no encoded segments. Choose encode or decode explicitly.' }
      }

      // 纯 ASCII 无特殊字符，默认 encode
      return { text: encodeURIComponent(input) }
    } catch (e: any) {
      return { text: `Error: ${e.message}` }
    }
  },
})
