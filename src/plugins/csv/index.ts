/**
 * First-party CSV / TSV Convert plugin.
 *
 * Exposes independent tools for each conversion direction — no sub-selection needed.
 * Surface UI preserved for later enhancement.
 */

import { definePlugin } from '@hiven/plugin'
import { CsvSurface } from './CsvSurface'

function csvToJson(text: string, sep: string): string {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return '[]'
  const headers = lines[0].split(sep).map((h: string) => h.trim())
  const result = lines.slice(1).map(line => {
    const vals = line.split(sep)
    const obj: Record<string, string> = {}
    headers.forEach((h: string, i: number) => { obj[h] = (vals[i] || '').trim() })
    return obj
  })
  return JSON.stringify(result, null, 2)
}

function jsonToCsv(text: string, sep: string): string {
  const arr = JSON.parse(text)
  if (!Array.isArray(arr) || arr.length === 0) return ''
  const headers = Object.keys(arr[0])
  const lines = [headers.join(sep)]
  for (const row of arr) {
    lines.push(headers.map((h: string) => String(row[h] ?? '')).join(sep))
  }
  return lines.join('\n')
}

export const csvPlugin = definePlugin({
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'CSV Tools',
        titleI18n: { zh: 'CSV Tools' },
        icon: 'Table',
        aliases: ['csv', 'tsv', 'table convert', '表格转换'],
        component: CsvSurface,
        entry: { launcher: true, shortcutBindable: true, shortcutPresentation: 'window' },
        shell: {
          defaultWidth: 960,
          defaultHeight: 680,
          minWidth: 720,
          minHeight: 520,
          closeOnBlur: false,
          resizable: true,
        },
      },
    ],
  },
  tools: [
    {
      id: 'csv.toJson',
      title: 'command.csvToJson.title',
      subtitle: 'command.csvToJson.description',
      icon: 'Table',
      aliases: ['csv to json', 'csv2json', 'csv转json'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try {
          return ctx.output.text(csvToJson(ctx.input.text, ','))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'csv.fromJson',
      title: 'command.jsonToCsv.title',
      subtitle: 'command.jsonToCsv.description',
      icon: 'Table',
      aliases: ['json to csv', 'json2csv', 'json转csv'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try {
          return ctx.output.text(jsonToCsv(ctx.input.text, ','))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'csv.tsvToJson',
      title: 'command.tsvToJson.title',
      subtitle: 'command.tsvToJson.description',
      icon: 'Table',
      aliases: ['tsv to json', 'tsv2json', 'tsv转json'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try {
          return ctx.output.text(csvToJson(ctx.input.text, '\t'))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'csv.jsonToTsv',
      title: 'command.jsonToTsv.title',
      subtitle: 'command.jsonToTsv.description',
      icon: 'Table',
      aliases: ['json to tsv', 'json2tsv', 'json转tsv'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try {
          return ctx.output.text(jsonToCsv(ctx.input.text, '\t'))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default csvPlugin
