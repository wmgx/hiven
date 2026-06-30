/**
 * First-party Lines to SQL IN plugin.
 *
 * Exposes two independent tools (string + number) — no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'

function sqlInString(text: string): string {
  const lines = text.split('\n').filter(l => l.trim() !== '')
  const values = lines.map(l => "'" + l.trim().replace(/'/g, "''") + "'")
  return '(' + values.join(',') + ')'
}

function sqlInNumber(text: string): string {
  const lines = text.split('\n').filter(l => l.trim() !== '')
  const values = lines.map(l => l.trim())
  return '(' + values.join(',') + ')'
}

export const sqlinPlugin = definePlugin({
  tools: [
    {
      id: 'sqlin.string',
      title: 'command.string.title',
      subtitle: 'command.string.description',
      icon: 'Database',
      aliases: ['sql in string', 'sql-in', 'lines to sql', '生成IN字符串'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(sqlInString(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'sqlin.number',
      title: 'command.number.title',
      subtitle: 'command.number.description',
      icon: 'Database',
      aliases: ['sql in number', 'sql-in-num', '生成IN数字'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(sqlInNumber(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default sqlinPlugin
