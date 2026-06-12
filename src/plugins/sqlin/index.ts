/**
 * First-party Lines to SQL IN plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

export const sqlinPlugin = definePlugin({
  commands: [
    {
      id: 'sqlin.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Database',
      aliases: ['sql-in', 'lines-to-sql'],
      optionalParams: true,
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.string.label', value: 'string' },
            { label: 'param.mode.option.number.label', value: 'number' },
          ],
          default: 'string',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        const lines = text.split('\n').filter(l => l.trim() !== '')
        if (ctx.params.mode === 'number') {
          const values = lines.map(l => l.trim())
          return textOutput('(' + values.join(',') + ')')
        }
        const values = lines.map(l => "'" + l.trim().replace(/'/g, "''") + "'")
        return textOutput('(' + values.join(',') + ')')
      },
    },
  ],
})

export default sqlinPlugin
