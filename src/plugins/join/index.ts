/**
 * First-party Join Lines plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'

export const joinPlugin = definePlugin({
  commands: [
    {
      id: 'join.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Merge',
      aliases: ['merge-lines', 'concat-lines'],
      params: [
        {
          key: 'separator',
          label: 'param.separator.label',
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
        const sep = ((ctx.params.separator ?? ',') as string)
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
        return {
          effects: [{
            type: 'text.replace' as const,
            target: input?.paneId ? { paneId: input.paneId } : 'active-input',
            text: text.split('\n').join(sep),
          }],
        }
      },
    },
  ],
})

export default joinPlugin
