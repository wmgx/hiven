/**
 * First-party Line Tools plugin.
 *
 * Groups: sort, dedup, reverse, remove blank, trim, join, prepend, append, wrap, SQL IN.
 * Each operation is an independent tool.
 */

import { definePlugin } from '@hiven/plugin'

// ─── Line reorder / filter ────────────────────────────────────────────────────

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
    if (!seen.has(key)) { seen.add(key); result.push(line) }
  }
  return result.join('\n')
}

function removeBlankLines(text: string): string {
  return text.split('\n').filter((l) => l.trim() !== '').join('\n')
}

function trimLineWhitespace(text: string): string {
  return text.split('\n').map((l) => l.trim()).join('\n')
}

function joinLines(text: string, sep: string): string {
  return text.split('\n').join(sep.replace(/\\n/g, '\n').replace(/\\t/g, '\t'))
}

// ─── Line affix ───────────────────────────────────────────────────────────────

function prependLines(text: string, prefix: string): string {
  return text.split('\n').map((l) => prefix + l).join('\n')
}

function appendLines(text: string, suffix: string): string {
  return text.split('\n').map((l) => l + suffix).join('\n')
}

function wrapLines(text: string, left: string, right: string): string {
  return text.split('\n').map((l) => left + l + right).join('\n')
}

// ─── SQL IN ───────────────────────────────────────────────────────────────────

function sqlInString(text: string): string {
  const lines = text.split('\n').filter(l => l.trim() !== '')
  return '(' + lines.map(l => "'" + l.trim().replace(/'/g, "''") + "'").join(',') + ')'
}

function sqlInNumber(text: string): string {
  const lines = text.split('\n').filter(l => l.trim() !== '')
  return '(' + lines.map(l => l.trim()).join(',') + ')'
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const lineToolsPlugin = definePlugin({
  tools: [
    {
      id: 'line-tools.sort',
      title: 'sort.title',
      subtitle: 'sort.description',
      icon: 'ArrowUpDown',
      aliases: ['sort lines', 'order', '行排序'],
      inputPolicy: { mode: 'auto' },
      params: [
        { key: 'direction', label: 'param.direction.label', type: 'single-select', options: [{ label: 'param.direction.asc', value: 'asc' }, { label: 'param.direction.desc', value: 'desc' }], default: 'asc' },
        { key: 'ignoreCase', label: 'param.ignoreCase', type: 'boolean', default: false },
      ],
      run(ctx) { return ctx.output.text(sortLines(ctx.input.text, ctx.params.direction as string, ctx.params.ignoreCase as boolean)) },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-tools.dedup',
      title: 'dedup.title',
      subtitle: 'dedup.description',
      icon: 'Copy',
      aliases: ['unique', 'distinct', '行去重'],
      inputPolicy: { mode: 'auto' },
      params: [{ key: 'ignoreCase', label: 'param.ignoreCase', type: 'boolean', default: false }],
      run(ctx) { return ctx.output.text(dedupLines(ctx.input.text, ctx.params.ignoreCase as boolean)) },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-tools.reverse',
      title: 'reverse.title',
      subtitle: 'reverse.description',
      icon: 'ArrowDownUp',
      aliases: ['flip lines', 'reverse lines', '行反转'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(reverseLines(ctx.input.text)) },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-tools.reverse-text',
      title: 'reverseText.title',
      subtitle: 'reverseText.description',
      icon: 'ArrowDownUp',
      aliases: ['reverse text', 'flip text', '文本反转'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(reverseText(ctx.input.text)) },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-tools.remove-blank-lines',
      title: 'removeBlankLines.title',
      subtitle: 'removeBlankLines.description',
      icon: 'RemoveFormatting',
      aliases: ['remove empty lines', '删除空行'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(removeBlankLines(ctx.input.text)) },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-tools.trim-whitespace',
      title: 'trimWhitespace.title',
      subtitle: 'trimWhitespace.description',
      icon: 'Type',
      aliases: ['strip', 'clean', '去空白'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(trimLineWhitespace(ctx.input.text)) },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-tools.join',
      title: 'join.title',
      subtitle: 'join.description',
      icon: 'Merge',
      aliases: ['merge lines', 'concat lines', '合并行'],
      inputPolicy: { mode: 'auto' },
      params: [{ key: 'separator', label: 'param.separator', type: 'text', default: ',' }],
      run(ctx) { return ctx.output.text(joinLines(ctx.input.text, (ctx.params.separator ?? ',') as string)) },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-affix.prepend',
      title: 'prepend.title',
      subtitle: 'prepend.description',
      icon: 'ArrowLeftToLine',
      aliases: ['prepend lines', 'prefix', '添加行前缀'],
      inputPolicy: { mode: 'auto' },
      params: [{ key: 'prefix', label: 'param.prefix', type: 'text', default: '- ' }],
      run(ctx) { return ctx.output.text(prependLines(ctx.input.text, (ctx.params.prefix ?? '- ') as string)) },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-affix.append',
      title: 'append.title',
      subtitle: 'append.description',
      icon: 'ArrowRightToLine',
      aliases: ['append lines', 'suffix', '添加行后缀'],
      inputPolicy: { mode: 'auto' },
      params: [{ key: 'suffix', label: 'param.suffix', type: 'text', default: ',' }],
      run(ctx) { return ctx.output.text(appendLines(ctx.input.text, (ctx.params.suffix ?? ',') as string)) },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'line-affix.wrap',
      title: 'wrap.title',
      subtitle: 'wrap.description',
      icon: 'WrapText',
      aliases: ['wrap lines', 'surround', '行包裹'],
      inputPolicy: { mode: 'auto' },
      params: [
        { key: 'left', label: 'param.left', type: 'text', default: '"' },
        { key: 'right', label: 'param.right', type: 'text', default: '"' },
      ],
      run(ctx) { return ctx.output.text(wrapLines(ctx.input.text, (ctx.params.left ?? '"') as string, (ctx.params.right ?? '"') as string)) },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'sqlin.string',
      title: 'sqlin.string.title',
      subtitle: 'sqlin.string.description',
      icon: 'Database',
      aliases: ['sql in string', 'sql-in', 'lines to sql', '生成IN字符串'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(sqlInString(ctx.input.text)) },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'sqlin.number',
      title: 'sqlin.number.title',
      subtitle: 'sqlin.number.description',
      icon: 'Database',
      aliases: ['sql in number', 'sql-in-num', '生成IN数字'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(sqlInNumber(ctx.input.text)) },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default lineToolsPlugin
