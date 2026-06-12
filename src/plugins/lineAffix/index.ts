/**
 * First-party line affix plugin.
 * Groups prefix, suffix, and wrap transforms for line-oriented text editing.
 */

import { definePlugin, textOutput, type TextInput } from '@hiven/plugin'

function inputText(input: TextInput | undefined): string {
  return input?.kind === 'text' ? input.text : ''
}

export const lineAffixPlugin = definePlugin({
  commands: [
    {
      id: 'line-affix.prepend',
      title: 'command.prepend.title',
      description: 'command.prepend.description',
      icon: 'ArrowLeftToLine',
      aliases: ['prepend-lines', 'prefix'],
      params: [
        {
          key: 'prefix',
          label: 'param.prefix.label',
          type: 'text',
          default: '- ',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const prefix = (ctx.params.prefix ?? '- ') as string
        return textOutput(inputText(input).split('\n').map((line) => prefix + line).join('\n'))
      },
    },
    {
      id: 'line-affix.append',
      title: 'command.append.title',
      description: 'command.append.description',
      icon: 'ArrowRightToLine',
      aliases: ['append-lines', 'suffix'],
      params: [
        {
          key: 'suffix',
          label: 'param.suffix.label',
          type: 'text',
          default: ',',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const suffix = (ctx.params.suffix ?? ',') as string
        return textOutput(inputText(input).split('\n').map((line) => line + suffix).join('\n'))
      },
    },
    {
      id: 'line-affix.wrap',
      title: 'command.wrap.title',
      description: 'command.wrap.description',
      icon: 'WrapText',
      aliases: ['wrap-lines', 'surround'],
      optionalParams: true,
      params: [
        {
          key: 'left',
          label: 'param.left.label',
          type: 'text',
          default: '"',
        },
        {
          key: 'right',
          label: 'param.right.label',
          type: 'text',
          default: '"',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const left = (ctx.params.left ?? '"') as string
        const right = (ctx.params.right ?? '"') as string
        return textOutput(inputText(input).split('\n').map((line) => left + line + right).join('\n'))
      },
    },
  ],
})

export default lineAffixPlugin
