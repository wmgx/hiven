/**
 * First-party CSV / TSV Convert plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@hiven/plugin'

export const csvPlugin = definePlugin({
  commands: [
    {
      id: 'csv.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Table',
      aliases: ['csv-json', 'tsv-json'],
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.csv2json.label', value: 'csv2json' },
            { label: 'param.mode.option.json2csv.label', value: 'json2csv' },
            { label: 'param.mode.option.tsv2json.label', value: 'tsv2json' },
            { label: 'param.mode.option.json2tsv.label', value: 'json2tsv' },
          ],
          default: 'csv2json',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        const reply = (t: string) => ({ effects: [{ type: 'text.replace' as const, target: input?.paneId ? { paneId: input.paneId } : 'active-input' as const, text: t }] })
        const mode = ctx.params.mode
        try {
          if (mode === 'csv2json' || mode === 'tsv2json') {
            const sep = mode === 'tsv2json' ? '\t' : ','
            const lines = text.trim().split('\n')
            if (lines.length < 2) return reply('[]')
            const headers = lines[0].split(sep).map((h: string) => h.trim())
            const result = lines.slice(1).map(line => {
              const vals = line.split(sep)
              const obj: Record<string, string> = {}
              headers.forEach((h: string, i: number) => { obj[h] = (vals[i] || '').trim() })
              return obj
            })
            return reply(JSON.stringify(result, null, 2))
          } else {
            const sep = mode === 'json2tsv' ? '\t' : ','
            const arr = JSON.parse(text)
            if (!Array.isArray(arr) || arr.length === 0) return reply('')
            const headers = Object.keys(arr[0])
            const lines = [headers.join(sep)]
            for (const row of arr) {
              lines.push(headers.map((h: string) => String(row[h] ?? '')).join(sep))
            }
            return reply(lines.join('\n'))
          }
        } catch (e: any) {
          return reply(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default csvPlugin
