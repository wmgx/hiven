/**
 * First-party Remove Blank Lines plugin.
 * Reference command-only plugin package: declares only i18n keys, runs a pure
 * text transform, and writes the result back to the active input.
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'

export const removeBlankLinesPlugin = definePlugin({
  id: 'remove-blank-lines',
  title: 'Remove Blank Lines',
  version: '1.0.0',

  commands: [
    {
      id: 'remove-blank-lines.run',
      title: 'command.run.title',
      description: 'command.run.description',
      tags: ['text', 'cleanup'],
      icon: 'RemoveFormatting',
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        const cleaned = text.split('\n').filter((line) => line.trim() !== '').join('\n')
        return {
          effects: [{
            type: 'text.replace' as const,
            target: input?.paneId ? { paneId: input.paneId } : 'active-input',
            text: cleaned,
          }],
        }
      },
    },
  ],
})

export default removeBlankLinesPlugin
