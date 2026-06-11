/**
 * First-party Hash plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@hiven/plugin'

export const hashPlugin = definePlugin({
  commands: [
    {
      id: 'hash.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Hash',
      aliases: ['md5', 'sha1', 'sha256', 'sha512'],
      live: { live: { enabled: true, trigger: 'on-input', sideEffects: 'none', debounceMs: 250 } },
      optionalParams: true,
      params: [
        {
          key: 'algorithm',
          label: 'param.algorithm.label',
          type: 'single-select',
          options: [
            { label: 'param.algorithm.option.SHA-256.label', value: 'SHA-256' },
            { label: 'param.algorithm.option.SHA-1.label', value: 'SHA-1' },
            { label: 'param.algorithm.option.SHA-512.label', value: 'SHA-512' },
          ],
          default: 'SHA-256',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      async run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        const reply = (t: string) => ({ effects: [{ type: 'text.replace' as const, target: input?.paneId ? { paneId: input.paneId } : 'active-input' as const, text: t }] })
        try {
          const data = new TextEncoder().encode(text)
          const hashBuffer = await crypto.subtle.digest(ctx.params.algorithm as string, data)
          const hashArray = Array.from(new Uint8Array(hashBuffer))
          return reply(hashArray.map(b => b.toString(16).padStart(2, '0')).join(''))
        } catch (e: any) {
          return reply(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default hashPlugin
