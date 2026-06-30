/**
 * First-party Case Convert plugin.
 *
 * Exposes five independent tools — no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'

export const casePlugin = definePlugin({
  tools: [
    {
      id: 'case.upper',
      title: 'command.upper.title',
      subtitle: 'command.upper.description',
      icon: 'CaseSensitive',
      aliases: ['uppercase', 'UPPER', '转大写'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(ctx.input.text.toUpperCase())
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'case.lower',
      title: 'command.lower.title',
      subtitle: 'command.lower.description',
      icon: 'CaseSensitive',
      aliases: ['lowercase', '转小写'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(ctx.input.text.toLowerCase())
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'case.title',
      title: 'command.title.title',
      subtitle: 'command.title.description',
      icon: 'CaseSensitive',
      aliases: ['titlecase', 'capitalize', '转标题'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(ctx.input.text.replace(/\b\w/g, c => c.toUpperCase()))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'case.camel',
      title: 'command.camel.title',
      subtitle: 'command.camel.description',
      icon: 'CaseSensitive',
      aliases: ['camelCase', 'camelcase', '转驼峰'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(
          ctx.input.text.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : ''),
        )
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'case.snake',
      title: 'command.snake.title',
      subtitle: 'command.snake.description',
      icon: 'CaseSensitive',
      aliases: ['snake_case', 'snakecase', '转下划线'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(
          ctx.input.text.replace(/[\s-]+/g, '_').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase(),
        )
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default casePlugin
