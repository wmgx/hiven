/**
 * First-party HTML Encode/Decode plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@hiven/plugin'

export const htmlPlugin = definePlugin({
  commands: [
    {
      id: 'html.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'FileCode',
      aliases: ['html-entities', 'html-escape'],
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.encode.label', value: 'encode' },
            { label: 'param.mode.option.decode.label', value: 'decode' },
          ],
          default: 'encode',
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
        if (ctx.params.mode === 'encode') {
          return reply(text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;'))
        }
        return reply(text
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&gt;/g, '>')
          .replace(/&lt;/g, '<')
          .replace(/&amp;/g, '&'))
      },
    },
  ],
})

export default htmlPlugin
