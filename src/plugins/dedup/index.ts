/**
 * First-party Remove Duplicate Lines plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'

export const dedupPlugin = definePlugin({
  id: 'dedup',
  title: 'Remove Duplicate Lines',
  version: '1.0.0',

  commands: [
    {
      id: 'dedup.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Copy',
      aliases: ['unique', 'distinct'],
      tags: ['text', 'cleanup'],
      optionalParams: true,
      params: [
        {
          key: 'ignoreCase',
          label: 'param.ignoreCase.label',
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
        const lines = text.split('\n')
        const seen = new Set<string>()
        const result: string[] = []
        for (const line of lines) {
          const key = ctx.params.ignoreCase ? line.toLowerCase() : line
          if (!seen.has(key)) {
            seen.add(key)
            result.push(line)
          }
        }
        return {
          effects: [{
            type: 'text.replace' as const,
            target: input?.paneId ? { paneId: input.paneId } : 'active-input',
            text: result.join('\n'),
          }],
        }
      },
    },
  ],
})

export default dedupPlugin
