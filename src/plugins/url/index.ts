/**
 * First-party URL Encode/Decode plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@hiven/plugin'

export const urlPlugin = definePlugin({
  commands: [
    {
      id: 'url.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Link',
      aliases: ['urlencode', 'urldecode'],
      live: { live: { enabled: true, trigger: 'on-input', sideEffects: 'none', debounceMs: 250 } },
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
        try {
          if (ctx.params.mode === 'encode') {
            return reply(encodeURIComponent(text))
          }
          return reply(decodeURIComponent(text.trim()))
        } catch (e: any) {
          return reply(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default urlPlugin
