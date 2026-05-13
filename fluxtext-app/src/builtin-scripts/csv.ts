import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'csv',
  title: 'CSV / TSV Convert',
  titleI18n: { zh: 'CSV / TSV 转换' },
  icon: 'Table',
  aliases: ['csv-json', 'tsv-json'],
  description: 'Convert between CSV/TSV and JSON',
  descriptionI18n: { zh: 'CSV/TSV 与 JSON 互转' },
  tags: ['csv', 'tsv', 'json', 'convert'],

  params: [
    {
      key: 'mode',
      label: 'Mode',
      labelI18n: { zh: '模式' },
      type: 'single-select',
      options: [
        { label: 'CSV → JSON', value: 'csv2json', labelI18n: { zh: 'CSV → JSON' } },
        { label: 'JSON → CSV', value: 'json2csv', labelI18n: { zh: 'JSON → CSV' } },
        { label: 'TSV → JSON', value: 'tsv2json', labelI18n: { zh: 'TSV → JSON' } },
        { label: 'JSON → TSV', value: 'json2tsv', labelI18n: { zh: 'JSON → TSV' } },
      ],
      default: 'csv2json',
    },
  ],

  run(ctx) {
    const mode = ctx.params.mode
    try {
      if (mode === 'csv2json' || mode === 'tsv2json') {
        const sep = mode === 'tsv2json' ? '\t' : ','
        const lines = ctx.input.text.trim().split('\n')
        if (lines.length < 2) return { text: '[]' }
        const headers = lines[0].split(sep).map(h => h.trim())
        const result = lines.slice(1).map(line => {
          const vals = line.split(sep)
          const obj: Record<string, string> = {}
          headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim() })
          return obj
        })
        return { text: JSON.stringify(result, null, 2) }
      } else {
        const sep = mode === 'json2tsv' ? '\t' : ','
        const arr = JSON.parse(ctx.input.text)
        if (!Array.isArray(arr) || arr.length === 0) return { text: '' }
        const headers = Object.keys(arr[0])
        const lines = [headers.join(sep)]
        for (const row of arr) {
          lines.push(headers.map(h => String(row[h] ?? '')).join(sep))
        }
        return { text: lines.join('\n') }
      }
    } catch (e: any) {
      return { text: `Error: ${e.message}` }
    }
  },
})
