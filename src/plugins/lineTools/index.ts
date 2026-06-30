/**
 * First-party line tools plugin.
 * Groups line-level transforms that reorder, filter, normalize, or join lines.
 * Each operation is an independent tool — no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'

/** Reverse the order of lines in text. */
export function reverseLines(text: string): string {
  return text.split('\n').reverse().join('\n')
}

function reverseText(text: string): string {
  return Array.from(text).reverse().join('')
}

function sortLines(text: string, direction: string, ignoreCase: boolean): string {
  const lines = text.split('\n')
  lines.sort((a, b) => {
    const x = ignoreCase ? a.toLowerCase() : a
    const y = ignoreCase ? b.toLowerCase() : b
    return direction === 'desc' ? y.localeCompare(x) : x.localeCompare(y)
  })
  return lines.join('\n')
}

function dedupLines(text: string, ignoreCase: boolean): string {
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

function joinLines(text: string, separator: string): string {
  const sep = separator
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
  return text.split('\n').join(sep)
}

export const lineToolsPlugin = definePlugin({
  tools: [
    {
      id: 'line-tools.sort',
      title: 'command.sort.title',
      subtitle: 'command.sort.description',
      icon: 'ArrowUpDown',
      aliases: ['sort lines', 'order', '行排序'],
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
        return ctx.output.text(sortLines(
          ctx.input.text,
          ctx.params.direction as string,
          ctx.params.ignoreCase as boolean,
        ))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-tools.dedup',
      title: 'command.dedup.title',
      subtitle: 'command.dedup.description',
      icon: 'Copy',
      aliases: ['unique', 'distinct', '行去重'],
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
        return ctx.output.text(dedupLines(ctx.input.text, ctx.params.ignoreCase as boolean))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-tools.reverse',
      title: 'command.reverse.title',
      subtitle: 'command.reverse.description',
      icon: 'ArrowDownUp',
      aliases: ['flip lines', 'reverse lines', '行反转'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(reverseLines(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-tools.reverse-text',
      title: 'command.reverseText.title',
      subtitle: 'command.reverseText.description',
      icon: 'ArrowDownUp',
      aliases: ['reverse text', 'flip text', '文本反转'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(reverseText(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-tools.remove-blank-lines',
      title: 'command.removeBlankLines.title',
      subtitle: 'command.removeBlankLines.description',
      icon: 'RemoveFormatting',
      aliases: ['remove empty lines', '删除空行'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(removeBlankLines(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-tools.trim-whitespace',
      title: 'command.trimWhitespace.title',
      subtitle: 'command.trimWhitespace.description',
      icon: 'Type',
      aliases: ['strip', 'clean', '去空白'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(trimLineWhitespace(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-tools.join',
      title: 'command.join.title',
      subtitle: 'command.join.description',
      icon: 'Merge',
      aliases: ['merge lines', 'concat lines', '合并行'],
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
        return ctx.output.text(joinLines(ctx.input.text, (ctx.params.separator ?? ',') as string))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default lineToolsPlugin
