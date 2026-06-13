/**
 * First-party HTML Encode/Decode plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

function runHtml(text: string, mode: unknown): string {
  if (mode === 'encode') {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

export const htmlPlugin = definePlugin({
  tools: [
    {
      id: 'html.run',
      title: 'command.run.title',
      icon: 'FileCode',
      aliases: ['html-entities', 'html-escape'],
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
        return ctx.output.replaceActiveText(runHtml(ctx.input.text, ctx.params.mode))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
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
        return textOutput(runHtml(text, ctx.params.mode))
      },
    },
  ],
})

export default htmlPlugin
