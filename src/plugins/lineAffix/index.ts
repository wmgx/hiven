/**
 * First-party line affix plugin.
 * Groups prefix, suffix, and wrap transforms for line-oriented text editing.
 * Each operation is an independent tool (still requires parameter input for the affix text).
 */

import { definePlugin } from '@hiven/plugin'

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
      aliases: ['prepend lines', 'prefix', '添加行前缀'],
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
        return ctx.output.text(prependLines(ctx.input.text, (ctx.params.prefix ?? '- ') as string))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-affix.append',
      title: 'command.append.title',
      subtitle: 'command.append.description',
      icon: 'ArrowRightToLine',
      aliases: ['append lines', 'suffix', '添加行后缀'],
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
        return ctx.output.text(appendLines(ctx.input.text, (ctx.params.suffix ?? ',') as string))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-affix.wrap',
      title: 'command.wrap.title',
      subtitle: 'command.wrap.description',
      icon: 'WrapText',
      aliases: ['wrap lines', 'surround', '行包裹'],
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
        return ctx.output.text(wrapLines(
          ctx.input.text,
          (ctx.params.left ?? '"') as string,
          (ctx.params.right ?? '"') as string,
        ))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default lineAffixPlugin
