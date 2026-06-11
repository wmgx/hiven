/**
 * First-party Markdown Quote plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@hiven/plugin'

export const mdquotePlugin = definePlugin({
  commands: [
    {
      id: 'mdquote.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'MessageSquareQuote',
      aliases: ['blockquote', 'quote'],
      optionalParams: true,
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.add.label', value: 'add' },
            { label: 'param.mode.option.remove.label', value: 'remove' },
          ],
          default: 'add',
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
        const lines = text.split('\n')
        if (ctx.params.mode === 'remove') {
          return reply(lines.map(l => l.replace(/^>\s?/, '')).join('\n'))
        }
        return reply(lines.map(l => '> ' + l).join('\n'))
      },
    },
  ],
})

export default mdquotePlugin
