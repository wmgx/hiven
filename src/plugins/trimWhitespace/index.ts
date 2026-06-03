/**
 * First-party Trim Whitespace plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'

export const trimWhitespacePlugin = definePlugin({
  id: 'trim-whitespace',
  title: 'Trim Whitespace',
  version: '1.0.0',

  commands: [
    {
      id: 'trim-whitespace.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Type',
      aliases: ['strip', 'clean'],
      tags: ['text', 'cleanup'],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        const trimmed = text.split('\n').map((line) => line.trim()).join('\n')
        return {
          effects: [{
            type: 'text.replace' as const,
            target: input?.paneId ? { paneId: input.paneId } : 'active-input',
            text: trimmed,
          }],
        }
      },
    },
  ],
})

export default trimWhitespacePlugin
