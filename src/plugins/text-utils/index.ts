/**
 * First-party Text Utilities plugin.
 *
 * Groups: case conversion (5 modes) + text statistics.
 * Each operation is an independent tool.
 */

import { definePlugin } from '@hiven/plugin'

// ─── Text Statistics ──────────────────────────────────────────────────────────

function textStats(text: string): string {
  const lines = text.split('\n').length
  const words = text.split(/\s+/).filter((w) => w.length > 0).length
  const chars = text.length
  const charsNoSpace = text.replace(/\s/g, '').length
  return `Lines: ${lines}\nWords: ${words}\nCharacters: ${chars}\nCharacters (no spaces): ${charsNoSpace}`
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const textUtilsPlugin = definePlugin({
  tools: [
    {
      id: 'case.upper',
      title: 'case.upper.title',
      subtitle: 'case.upper.description',
      icon: 'CaseSensitive',
      aliases: ['uppercase', 'UPPER', '转大写'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(ctx.input.text.toUpperCase()) },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'case.lower',
      title: 'case.lower.title',
      subtitle: 'case.lower.description',
      icon: 'CaseSensitive',
      aliases: ['lowercase', '转小写'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(ctx.input.text.toLowerCase()) },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'case.title',
      title: 'case.title.title',
      subtitle: 'case.title.description',
      icon: 'CaseSensitive',
      aliases: ['titlecase', 'capitalize', '转标题'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(ctx.input.text.replace(/\b\w/g, c => c.toUpperCase())) },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'case.camel',
      title: 'case.camel.title',
      subtitle: 'case.camel.description',
      icon: 'CaseSensitive',
      aliases: ['camelCase', 'camelcase', '转驼峰'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(ctx.input.text.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '')) },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'case.snake',
      title: 'case.snake.title',
      subtitle: 'case.snake.description',
      icon: 'CaseSensitive',
      aliases: ['snake_case', 'snakecase', '转下划线'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(ctx.input.text.replace(/[\s-]+/g, '_').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()) },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'count.run',
      title: 'count.title',
      subtitle: 'count.description',
      icon: 'ChartBar',
      aliases: ['stats', 'wc', '文本统计', '字数统计'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(textStats(ctx.input.text)) },
      surfaces: { launcher: true, panel: true },
    },
  ],
})

export default textUtilsPlugin
