/**
 * First-party URL Encode/Decode plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

function runUrl(text: string, mode: unknown): string {
  if (mode === 'encode') {
    return encodeURIComponent(text)
  }
  return decodeURIComponent(text.trim())
}

export const urlPlugin = definePlugin({
  tools: [
    {
      id: 'url.run',
      title: 'command.run.title',
      subtitle: 'command.run.description',
      icon: 'Link',
      aliases: ['urlencode', 'urldecode'],
      inputPolicy: { mode: 'auto' },
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
      run(ctx) {
        try {
          return ctx.output.replaceActiveText(runUrl(ctx.input.text, ctx.params.mode))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
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
        try {
          return textOutput(runUrl(text, ctx.params.mode))
        } catch (e: any) {
          return textError(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default urlPlugin
