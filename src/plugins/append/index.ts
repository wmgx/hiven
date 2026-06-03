/**
 * First-party Append to Lines plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'

export const appendPlugin = definePlugin({
  id: 'append',
  title: 'Append to Lines',
  version: '1.0.0',

  commands: [
    {
      id: 'append.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'ArrowRightToLine',
      aliases: ['append-lines', 'suffix'],
      tags: ['text', 'lines'],
      params: [
        {
          key: 'suffix',
          label: 'param.suffix.label',
          type: 'text',
          default: ',',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        const suffix = (ctx.params.suffix ?? ',') as string
        const lines = text.split('\n').map(l => l + suffix)
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

export default appendPlugin
