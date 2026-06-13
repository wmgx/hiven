/**
 * First-party Add/Remove Slashes plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

function runSlashes(text: string, mode: unknown): string {
  if (mode === 'escape') {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
  }
  return text
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
}

export const slashesPlugin = definePlugin({
  tools: [
    {
      id: 'slashes.run',
      title: 'command.run.title',
      subtitle: 'command.run.description',
      icon: 'Quote',
      aliases: ['escape', 'unescape', 'addslashes', 'stripslashes'],
      inputPolicy: { mode: 'auto' },
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.escape.label', value: 'escape' },
            { label: 'param.mode.option.unescape.label', value: 'unescape' },
          ],
          default: 'escape',
        },
      ],
      run(ctx) {
        return ctx.output.replaceActiveText(runSlashes(ctx.input.text, ctx.params.mode))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
  commands: [
    {
      id: 'slashes.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Quote',
      aliases: ['escape', 'unescape', 'addslashes', 'stripslashes'],
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.escape.label', value: 'escape' },
            { label: 'param.mode.option.unescape.label', value: 'unescape' },
          ],
          default: 'escape',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        return textOutput(runSlashes(text, ctx.params.mode))
      },
    },
  ],
})

export default slashesPlugin
