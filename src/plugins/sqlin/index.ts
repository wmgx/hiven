/**
 * First-party Lines to SQL IN plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'

export const sqlinPlugin = definePlugin({
  id: 'sqlin',
  title: 'Lines to SQL IN',
  version: '1.0.0',

  commands: [
    {
      id: 'sqlin.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Database',
      aliases: ['sql-in', 'lines-to-sql'],
      tags: ['sql', 'convert'],
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
        const reply = (t: string) => ({ effects: [{ type: 'text.replace' as const, target: input?.paneId ? { paneId: input.paneId } : 'active-input' as const, text: t }] })
        const lines = text.split('\n').filter(l => l.trim() !== '')
        if (ctx.params.mode === 'number') {
          const values = lines.map(l => l.trim())
          return reply('(' + values.join(',') + ')')
        }
        const values = lines.map(l => "'" + l.trim().replace(/'/g, "''") + "'")
        return reply('(' + values.join(',') + ')')
      },
    },
  ],
})

export default sqlinPlugin
