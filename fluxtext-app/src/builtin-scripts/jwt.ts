import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'jwt',
  title: 'JWT Decode',
  titleI18n: { zh: 'JWT 解码' },
  icon: 'Key',
  aliases: ['jwt-decode', 'json-web-token'],
  description: 'Decode JWT token',
  descriptionI18n: { zh: '解码 JWT 令牌' },
  tags: ['jwt', 'decode', 'auth'],
  params: [],

  run(ctx) {
    try {
      const parts = ctx.input.text.trim().split('.')
      if (parts.length !== 3) return { text: 'Error: Invalid JWT (expected 3 parts)' }
      const decode = (s: string) => {
        const pad = s + '='.repeat((4 - s.length % 4) % 4)
        return JSON.parse(decodeURIComponent(escape(atob(pad.replace(/-/g, '+').replace(/_/g, '/')))))
      }
      const header = decode(parts[0])
      const payload = decode(parts[1])
      return {
        text: `// Header\n${JSON.stringify(header, null, 2)}\n\n// Payload\n${JSON.stringify(payload, null, 2)}`
      }
    } catch (e: any) {
      return { text: `Error: ${e.message}` }
    }
  },
})
