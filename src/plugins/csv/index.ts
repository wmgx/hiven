/**
 * First-party CSV / TSV Convert plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

function runCsv(text: string, mode: unknown): string {
  if (mode === 'csv2json' || mode === 'tsv2json') {
    const sep = mode === 'tsv2json' ? '\t' : ','
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
  const sep = mode === 'json2tsv' ? '\t' : ','
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
  tools: [
    {
      id: 'csv.run',
      title: 'command.run.title',
      subtitle: 'command.run.description',
      icon: 'Table',
      aliases: ['csv-json', 'tsv-json'],
      inputPolicy: { mode: 'auto' },
      requireParamSelection: true,
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
      run(ctx) {
        try {
          return ctx.output.replaceActiveText(runCsv(ctx.input.text, ctx.params.mode))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
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
        const mode = ctx.params.mode
        try {
          return textOutput(runCsv(text, mode))
        } catch (e: any) {
          return textError(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default csvPlugin
