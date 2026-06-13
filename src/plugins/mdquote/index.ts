/**
 * First-party Markdown Quote plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

function runMdquote(text: string, mode: unknown): string {
  const lines = text.split('\n')
  if (mode === 'remove') {
    return lines.map(l => l.replace(/^>\s?/, '')).join('\n')
  }
  return lines.map(l => '> ' + l).join('\n')
}

export const mdquotePlugin = definePlugin({
  tools: [
    {
      id: 'mdquote.run',
      title: 'command.run.title',
      subtitle: 'command.run.description',
      icon: 'MessageSquareQuote',
      aliases: ['blockquote', 'quote'],
      inputPolicy: { mode: 'auto' },
      requireParamSelection: true,
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
      run(ctx) {
        return ctx.output.replaceActiveText(runMdquote(ctx.input.text, ctx.params.mode))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
  commands: [
    {
      id: 'mdquote.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'MessageSquareQuote',
      aliases: ['blockquote', 'quote'],
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
        return textOutput(runMdquote(text, ctx.params.mode))
      },
    },
  ],
})

export default mdquotePlugin
