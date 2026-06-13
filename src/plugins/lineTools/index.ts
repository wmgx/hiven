/**
 * First-party line tools plugin.
 * Groups line-level transforms that reorder, filter, normalize, or join lines.
 */

import { definePlugin, textOutput, type TextInput } from '@hiven/plugin'

function inputText(input: TextInput | undefined): string {
  return input?.kind === 'text' ? input.text : ''
}

/** Pure function: reverse the order of lines in text. */
export function reverseLines(text: string): string {
  return text.split('\n').reverse().join('\n')
}

function sortLines(text: string, params: Record<string, unknown>): string {
  const lines = text.split('\n')
  lines.sort((a, b) => {
    const x = params.ignoreCase ? a.toLowerCase() : a
    const y = params.ignoreCase ? b.toLowerCase() : b
    return params.direction === 'desc' ? y.localeCompare(x) : x.localeCompare(y)
  })
  return lines.join('\n')
}

function dedupLines(text: string, ignoreCase: unknown): string {
  const seen = new Set<string>()
  const result: string[] = []
  for (const line of text.split('\n')) {
    const key = ignoreCase ? line.toLowerCase() : line
    if (!seen.has(key)) {
      seen.add(key)
      result.push(line)
    }
  }
  return result.join('\n')
}

function removeBlankLines(text: string): string {
  return text.split('\n').filter((line) => line.trim() !== '').join('\n')
}

function trimLineWhitespace(text: string): string {
  return text.split('\n').map((line) => line.trim()).join('\n')
}

function joinLines(text: string, separator: unknown): string {
  const sep = ((separator ?? ',') as string)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
  return text.split('\n').join(sep)
}

export const lineToolsPlugin = definePlugin({
  tools: [
    {
      id: 'line-tools.sort',
      title: 'command.sort.title',
      icon: 'ArrowUpDown',
      aliases: ['order', 'sort-lines'],
      inputPolicy: { mode: 'auto' },
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
      run(ctx) {
        return ctx.output.replaceActiveText(sortLines(ctx.input.text, ctx.params))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-tools.dedup',
      title: 'command.dedup.title',
      icon: 'Copy',
      aliases: ['unique', 'distinct'],
      inputPolicy: { mode: 'auto' },
      params: [
        {
          key: 'ignoreCase',
          label: 'param.ignoreCase.label',
          type: 'boolean',
          default: false,
        },
      ],
      run(ctx) {
        return ctx.output.replaceActiveText(dedupLines(ctx.input.text, ctx.params.ignoreCase))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-tools.reverse',
      title: 'command.reverse.title',
      titleI18n: { zh: '反转行' },
      icon: 'ArrowDownUp',
      aliases: ['flip-lines', 'reverse-lines'],
      inputPolicy: { mode: 'auto' },
      async run(ctx) {
        return ctx.output.replaceActiveText(reverseLines(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-tools.remove-blank-lines',
      title: 'command.removeBlankLines.title',
      icon: 'RemoveFormatting',
      aliases: ['remove-empty-lines'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.replaceActiveText(removeBlankLines(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-tools.trim-whitespace',
      title: 'command.trimWhitespace.title',
      icon: 'Type',
      aliases: ['strip', 'clean'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.replaceActiveText(trimLineWhitespace(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-tools.join',
      title: 'command.join.title',
      icon: 'Merge',
      aliases: ['merge-lines', 'concat-lines'],
      inputPolicy: { mode: 'auto' },
      params: [
        {
          key: 'separator',
          label: 'param.separator.label',
          type: 'text',
          default: ',',
        },
      ],
      run(ctx) {
        return ctx.output.replaceActiveText(joinLines(ctx.input.text, ctx.params.separator))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
  commands: [
    {
      id: 'line-tools.sort',
      title: 'command.sort.title',
      description: 'command.sort.description',
      icon: 'ArrowUpDown',
      aliases: ['order', 'sort-lines'],
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
        return textOutput(sortLines(inputText(input), ctx.params))
      },
    },
    {
      id: 'line-tools.dedup',
      title: 'command.dedup.title',
      description: 'command.dedup.description',
      icon: 'Copy',
      aliases: ['unique', 'distinct'],
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
        return textOutput(dedupLines(inputText(input), ctx.params.ignoreCase))
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
        return textOutput(reverseLines(inputText(input)))
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
        return textOutput(removeBlankLines(inputText(input)))
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
        return textOutput(trimLineWhitespace(inputText(input)))
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
        return textOutput(joinLines(inputText(input), ctx.params.separator))
      },
    },
  ],
})

export default lineToolsPlugin
