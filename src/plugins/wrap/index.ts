/**
 * First-party Wrap Lines plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'

export const wrapPlugin = definePlugin({
  commands: [
    {
      id: 'wrap.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'WrapText',
      aliases: ['wrap-lines', 'surround'],
      optionalParams: true,
      params: [
        {
          key: 'left',
          label: 'param.left.label',
          type: 'text',
          default: '"',
        },
        {
          key: 'right',
          label: 'param.right.label',
          type: 'text',
          default: '"',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        const left = (ctx.params.left ?? '"') as string
        const right = (ctx.params.right ?? '"') as string
        const lines = text.split('\n').map(l => left + l + right)
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

export default wrapPlugin
