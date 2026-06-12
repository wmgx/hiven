/**
 * First-party line tools plugin.
 * Groups line-level transforms that reorder, filter, normalize, or join lines.
 */

import { definePlugin, textOutput, type TextInput } from '@hiven/plugin'

function inputText(input: TextInput | undefined): string {
  return input?.kind === 'text' ? input.text : ''
}

export const lineToolsPlugin = definePlugin({
  commands: [
    {
      id: 'line-tools.sort',
      title: 'command.sort.title',
      description: 'command.sort.description',
      icon: 'ArrowUpDown',
      aliases: ['order', 'sort-lines'],
      optionalParams: true,
      params: [
        {
          key: 'direction',
          label: 'param.direction.label',
          type: 'single-select',
          options: [
            { label: 'param.direction.option.asc.label', value: 'asc' },
            { label: 'param.direction.option.desc.label', value: 'desc' },
          ],
          default: 'asc',
        },
        {
          key: 'ignoreCase',
          label: 'param.ignoreCase.label',
          type: 'boolean',
          default: false,
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const lines = inputText(input).split('\n')
        lines.sort((a, b) => {
          const x = ctx.params.ignoreCase ? a.toLowerCase() : a
          const y = ctx.params.ignoreCase ? b.toLowerCase() : b
          return ctx.params.direction === 'desc' ? y.localeCompare(x) : x.localeCompare(y)
        })
        return textOutput(lines.join('\n'))
      },
    },
    {
      id: 'line-tools.dedup',
      title: 'command.dedup.title',
      description: 'command.dedup.description',
      icon: 'Copy',
      aliases: ['unique', 'distinct'],
      optionalParams: true,
      params: [
        {
          key: 'ignoreCase',
          label: 'param.ignoreCase.label',
          type: 'boolean',
          default: false,
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const seen = new Set<string>()
        const result: string[] = []
        for (const line of inputText(input).split('\n')) {
          const key = ctx.params.ignoreCase ? line.toLowerCase() : line
          if (!seen.has(key)) {
            seen.add(key)
            result.push(line)
          }
        }
        return textOutput(result.join('\n'))
      },
    },
    {
      id: 'line-tools.reverse',
      title: 'command.reverse.title',
      description: 'command.reverse.description',
      icon: 'ArrowDownUp',
      aliases: ['flip-lines'],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        return textOutput(inputText(input).split('\n').reverse().join('\n'))
      },
    },
    {
      id: 'line-tools.remove-blank-lines',
      title: 'command.removeBlankLines.title',
      description: 'command.removeBlankLines.description',
      icon: 'RemoveFormatting',
      aliases: ['remove-empty-lines'],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        return textOutput(inputText(input).split('\n').filter((line) => line.trim() !== '').join('\n'))
      },
    },
    {
      id: 'line-tools.trim-whitespace',
      title: 'command.trimWhitespace.title',
      description: 'command.trimWhitespace.description',
      icon: 'Type',
      aliases: ['strip', 'clean'],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        return textOutput(inputText(input).split('\n').map((line) => line.trim()).join('\n'))
      },
    },
    {
      id: 'line-tools.join',
      title: 'command.join.title',
      description: 'command.join.description',
      icon: 'Merge',
      aliases: ['merge-lines', 'concat-lines'],
      params: [
        {
          key: 'separator',
          label: 'param.separator.label',
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
        const sep = ((ctx.params.separator ?? ',') as string)
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
        return textOutput(inputText(input).split('\n').join(sep))
      },
    },
  ],
})

export default lineToolsPlugin
