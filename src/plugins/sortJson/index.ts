/**
 * First-party Sort JSON Keys plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

export const sortJsonPlugin = definePlugin({
  commands: [
    {
      id: 'sort-json.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'ArrowUpNarrowWide',
      aliases: ['json-sort', 'sort-json-keys'],
      params: [],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
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
          return textOutput(JSON.stringify(sortKeys(JSON.parse(text)), null, 2))
        } catch (e: any) {
          return textError(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default sortJsonPlugin
