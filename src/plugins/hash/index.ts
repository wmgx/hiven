/**
 * First-party Hash plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

async function runHash(text: string, algorithm: unknown): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hashBuffer = await crypto.subtle.digest(algorithm as string, data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export const hashPlugin = definePlugin({
  tools: [
    {
      id: 'hash.run',
      title: 'command.run.title',
      subtitle: 'command.run.description',
      icon: 'Hash',
      aliases: ['md5', 'sha1', 'sha256', 'sha512'],
      inputPolicy: { mode: 'auto' },
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
      async run(ctx) {
        try {
          return ctx.output.replaceActiveText(await runHash(ctx.input.text, ctx.params.algorithm))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
  commands: [
    {
      id: 'hash.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Hash',
      aliases: ['md5', 'sha1', 'sha256', 'sha512'],
      live: { live: { enabled: true, trigger: 'on-input', sideEffects: 'none', debounceMs: 250 } },
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
        try {
          return textOutput(await runHash(text, ctx.params.algorithm))
        } catch (e: any) {
          return textError(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default hashPlugin
