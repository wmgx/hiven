/**
 * First-party Prepend to Lines plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'

export const prependPlugin = definePlugin({
  commands: [
    {
      id: 'prepend.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'ArrowLeftToLine',
      aliases: ['prepend-lines', 'prefix'],
      params: [
        {
          key: 'prefix',
          label: 'param.prefix.label',
          type: 'text',
          default: '- ',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        const prefix = (ctx.params.prefix ?? '- ') as string
        const lines = text.split('\n').map(l => prefix + l)
        return {
          effects: [{
            type: 'text.replace' as const,
            target: input?.paneId ? { paneId: input.paneId } : 'active-input',
            text: lines.join('\n'),
          }],
        }
      },
    },
  ],
})

export default prependPlugin
