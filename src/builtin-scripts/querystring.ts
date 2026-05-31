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
        { label: 'Auto', value: 'auto', labelI18n: { zh: '自动' } },
        { label: 'JSON → Query', value: 'json2qs', labelI18n: { zh: 'JSON → 查询字符串' } },
        { label: 'Query → JSON', value: 'qs2json', labelI18n: { zh: '查询字符串 → JSON' } },
      ],
      default: 'auto',
    },
  ],

  run(ctx) {
    try {
      const mode = ctx.params.mode
      const input = ctx.input.text.trim()

      if (mode === 'json2qs') {
        return { text: jsonToQs(input) }
      }

      if (mode === 'qs2json') {
        return { text: qsToJson(input) }
      }

      // auto mode
      // 尝试 JSON object
      if (input.startsWith('{')) {
        try {
          const obj = JSON.parse(input)
          if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
            return { text: jsonToQs(input) }
          }
        } catch { /* not JSON, fall through */ }
      }

      // 检测 query string 特征
      if (input.startsWith('?') || /\w+=\w*/.test(input) && input.includes('&')) {
        return { text: qsToJson(input) }
      }

      // 单个 key=value 也算 query string
      if (/^\w+=[^&]*$/.test(input)) {
        return { text: qsToJson(input) }
      }

      return { text: 'Error: Cannot infer JSON or query string. Input does not look like a JSON object or query string. Choose json2qs or qs2json explicitly.' }
    } catch (e: any) {
      return { text: `Error: ${e.message}` }
    }
  },
})

function jsonToQs(input: string): string {
  const obj = JSON.parse(input)
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) {
    params.set(k, String(v))
  }
  return params.toString()
}

function qsToJson(input: string): string {
  let qs = input
  if (qs.startsWith('?')) qs = qs.slice(1)
  const params = new URLSearchParams(qs)
  const obj: Record<string, string> = {}
  params.forEach((v, k) => { obj[k] = v })
  return JSON.stringify(obj, null, 2)
}
