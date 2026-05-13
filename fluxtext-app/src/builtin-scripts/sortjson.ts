import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'sortjson',
  title: 'Sort JSON Keys',
  titleI18n: { zh: 'JSON Key 排序' },
  icon: 'ArrowUpNarrowWide',
  aliases: ['json-sort', 'sort-json-keys'],
  description: 'Sort JSON object keys alphabetically',
  descriptionI18n: { zh: '按字母顺序排列 JSON 对象的 key' },
  tags: ['json', 'sort'],
  params: [],

  run(ctx) {
    try {
      const sortKeys = (obj: any): any => {
        if (Array.isArray(obj)) return obj.map(sortKeys)
        if (obj && typeof obj === 'object') {
          return Object.keys(obj).sort().reduce((acc: any, key: string) => {
            acc[key] = sortKeys(obj[key])
            return acc
          }, {})
        }
        return obj
      }
      const parsed = JSON.parse(ctx.input.text)
      return { text: JSON.stringify(sortKeys(parsed), null, 2) }
    } catch (e: any) {
      return { text: `Error: ${e.message}` }
    }
  },
})
