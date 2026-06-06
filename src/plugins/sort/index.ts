/**
 * First-party Sort Lines plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'

export const sortPlugin = definePlugin({
  commands: [
    {
      id: 'sort.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'ArrowUpDown',
      aliases: ['order'],
      optionalParams: true,
      params: [
        {
          key: 'direction',
          label: 'param.direction.label',
          type: 'single-select',
          options: [
            { label: 'param.direction.option.asc.label', value: 'asc' },
            { label: 'param.direction.option.desc.label', value: 'desc' },
          ],
          default: 'asc',
        },
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
        lines.sort((a, b) => {
          const x = ctx.params.ignoreCase ? a.toLowerCase() : a
          const y = ctx.params.ignoreCase ? b.toLowerCase() : b
          return ctx.params.direction === 'desc' ? y.localeCompare(x) : x.localeCompare(y)
        })
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

export default sortPlugin
