/**
 * First-party Reverse Lines plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'

export const reversePlugin = definePlugin({
  commands: [
    {
      id: 'reverse.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'ArrowDownUp',
      aliases: ['flip-lines'],
      params: [],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        return {
          effects: [{
            type: 'text.replace' as const,
            target: input?.paneId ? { paneId: input.paneId } : 'active-input',
            text: text.split('\n').reverse().join('\n'),
          }],
        }
      },
    },
  ],
})

export default reversePlugin
