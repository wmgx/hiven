/**
 * First-party Extract Patterns plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

export const extractPlugin = definePlugin({
  commands: [
    {
      id: 'extract.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Regex',
      aliases: ['grep', 'filter'],
      params: [
        {
          key: 'pattern',
          label: 'param.pattern.label',
          type: 'text',
          default: '',
          required: true,
        },
        {
          key: 'matchOnly',
          label: 'param.matchOnly.label',
          type: 'boolean',
          default: false,
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        const { pattern, matchOnly } = ctx.params
        if (!pattern) return textOutput(text)
        try {
          const re = new RegExp(pattern as string, 'gim')
          if (matchOnly) {
            const matches = text.match(re) || []
            return textOutput(matches.join('\n'))
          }
          const lines = text.split('\n').filter(l => re.test(l))
          return textOutput(lines.join('\n'))
        } catch (e: any) {
          return textError(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default extractPlugin
