import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'querystring',
  title: 'JSON ↔ Query String',
  titleI18n: { zh: 'JSON ↔ 查询字符串' },
  icon: 'Search',
  aliases: ['query-json', 'json-query', 'qs'],
  description: 'Convert between JSON and URL query string',
  descriptionI18n: { zh: 'JSON 与 URL 查询字符串互转' },
  tags: ['json', 'url', 'convert'],

  params: [
    {
      key: 'mode',
      label: 'Mode',
      labelI18n: { zh: '模式' },
      type: 'single-select',
      options: [
        { label: 'JSON → Query', value: 'json2qs', labelI18n: { zh: 'JSON → 查询字符串' } },
        { label: 'Query → JSON', value: 'qs2json', labelI18n: { zh: '查询字符串 → JSON' } },
      ],
      default: 'json2qs',
    },
  ],

  run(ctx) {
    try {
      if (ctx.params.mode === 'json2qs') {
        const obj = JSON.parse(ctx.input.text)
        const params = new URLSearchParams()
        for (const [k, v] of Object.entries(obj)) {
          params.set(k, String(v))
        }
        return { text: params.toString() }
      }
      let qs = ctx.input.text.trim()
      if (qs.startsWith('?')) qs = qs.slice(1)
      const params = new URLSearchParams(qs)
      const obj: Record<string, string> = {}
      params.forEach((v, k) => { obj[k] = v })
      return { text: JSON.stringify(obj, null, 2) }
    } catch (e: any) {
      return { text: `Error: ${e.message}` }
    }
  },
})
