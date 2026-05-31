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

      if (mode === 'encode') {
        return { text: btoa(unescape(encodeURIComponent(ctx.input.text))) }
      }

      if (mode === 'decode') {
        return { text: decodeURIComponent(escape(atob(ctx.input.text.trim()))) }
      }

      // auto mode
      const input = ctx.input.text.trim()
      if (looksLikeBase64(input)) {
        try {
          const decoded = decodeURIComponent(escape(atob(input)))
          if (isPrintableContent(decoded)) {
            return { text: decoded }
          }
        } catch { /* fall through to encode */ }
      }

      return { text: btoa(unescape(encodeURIComponent(ctx.input.text))) }
    } catch (e: any) {
      return { text: `Error: ${e.message}` }
    }
  },
})

function looksLikeBase64(s: string): boolean {
  if (s.length === 0) return false
  if (s.length % 4 !== 0) return false
  return /^[A-Za-z0-9+/]*={0,2}$/.test(s)
}

function isPrintableContent(s: string): boolean {
  if (s.length === 0) return false
  // 包含常见结构字符，高置信度
  if (/[{[\]<:/ \n]/.test(s)) return true
  // 可打印字符比例高
  const printable = s.split('').filter(c => {
    const code = c.charCodeAt(0)
    return code >= 32 || code === 9 || code === 10 || code === 13
  }).length
  return printable / s.length > 0.9
}
