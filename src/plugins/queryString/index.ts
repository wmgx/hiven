/**
 * First-party JSON ↔ Query String plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

export const queryStringPlugin = definePlugin({
  commands: [
    {
      id: 'query-string.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Search',
      aliases: ['query-json', 'json-query', 'qs'],
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.json2qs.label', value: 'json2qs' },
            { label: 'param.mode.option.qs2json.label', value: 'qs2json' },
          ],
          default: 'json2qs',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        try {
          if (ctx.params.mode === 'json2qs') {
            const obj = JSON.parse(text)
            const params = new URLSearchParams()
            for (const [k, v] of Object.entries(obj)) {
              params.set(k, String(v))
            }
            return textOutput(params.toString())
          }
          let qs = text.trim()
          if (qs.startsWith('?')) qs = qs.slice(1)
          const params = new URLSearchParams(qs)
          const obj: Record<string, string> = {}
          params.forEach((v, k) => { obj[k] = v })
          return textOutput(JSON.stringify(obj, null, 2))
        } catch (e: any) {
          return textError(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default queryStringPlugin
