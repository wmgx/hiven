/**
 * First-party line affix plugin.
 * Groups prefix, suffix, and wrap transforms for line-oriented text editing.
 */

import { definePlugin, textOutput, type TextInput } from '@hiven/plugin'

function inputText(input: TextInput | undefined): string {
  return input?.kind === 'text' ? input.text : ''
}

function prependLines(text: string, prefix: string): string {
  return text.split('\n').map((line) => prefix + line).join('\n')
}

function appendLines(text: string, suffix: string): string {
  return text.split('\n').map((line) => line + suffix).join('\n')
}

function wrapLines(text: string, left: string, right: string): string {
  return text.split('\n').map((line) => left + line + right).join('\n')
}

export const lineAffixPlugin = definePlugin({
  tools: [
    {
      id: 'line-affix.prepend',
      title: 'command.prepend.title',
      subtitle: 'command.prepend.description',
      icon: 'ArrowLeftToLine',
      aliases: ['prepend-lines', 'prefix'],
      inputPolicy: { mode: 'auto' },
      params: [
        {
          key: 'prefix',
          label: 'param.prefix.label',
          type: 'text',
          default: '- ',
        },
      ],
      run(ctx) {
        return ctx.output.replaceActiveText(prependLines(ctx.input.text, (ctx.params.prefix ?? '- ') as string))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-affix.append',
      title: 'command.append.title',
      subtitle: 'command.append.description',
      icon: 'ArrowRightToLine',
      aliases: ['append-lines', 'suffix'],
      inputPolicy: { mode: 'auto' },
      params: [
        {
          key: 'suffix',
          label: 'param.suffix.label',
          type: 'text',
          default: ',',
        },
      ],
      run(ctx) {
        return ctx.output.replaceActiveText(appendLines(ctx.input.text, (ctx.params.suffix ?? ',') as string))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-affix.wrap',
      title: 'command.wrap.title',
      subtitle: 'command.wrap.description',
      icon: 'WrapText',
      aliases: ['wrap-lines', 'surround'],
      inputPolicy: { mode: 'auto' },
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
      run(ctx) {
        return ctx.output.replaceActiveText(wrapLines(
          ctx.input.text,
          (ctx.params.left ?? '"') as string,
          (ctx.params.right ?? '"') as string,
        ))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
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
        return textOutput(prependLines(inputText(input), prefix))
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
        return textOutput(appendLines(inputText(input), suffix))
      },
    },
    {
      id: 'line-affix.wrap',
      title: 'command.wrap.title',
      description: 'command.wrap.description',
      icon: 'WrapText',
      aliases: ['wrap-lines', 'surround'],
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
        return textOutput(wrapLines(inputText(input), left, right))
      },
    },
  ],
})

export default lineAffixPlugin
