import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'hash',
  title: 'Hash',
  titleI18n: { zh: '哈希计算' },
  icon: 'Hash',
  aliases: ['md5', 'sha1', 'sha256', 'sha512'],
  description: 'Calculate hash digest',
  descriptionI18n: { zh: '计算哈希摘要' },
  tags: ['hash', 'crypto'],

  params: [
    {
      key: 'algorithm',
      label: 'Algorithm',
      labelI18n: { zh: '算法' },
      type: 'single-select',
      options: [
        { label: 'SHA-256', value: 'SHA-256' },
        { label: 'SHA-1', value: 'SHA-1' },
        { label: 'SHA-512', value: 'SHA-512' },
      ],
      default: 'SHA-256',
    },
  ],

  async run(ctx) {
    try {
      const data = new TextEncoder().encode(ctx.input.text)
      const hashBuffer = await crypto.subtle.digest(ctx.params.algorithm, data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
      return { text: hex }
    } catch (e: any) {
      return { text: `Error: ${e.message}` }
    }
  },
})
