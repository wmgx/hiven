/**
 * First-party SQL Formatter plugin.
 *
 * Exposes two independent tools (prettify + compact) — no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'
import { format } from 'sql-formatter'

function sqlPrettify(text: string): string {
  return format(text)
}

function sqlCompact(text: string): string {
  return text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()
}

export const sqlPlugin = definePlugin({
  tools: [
    {
      id: 'sql.prettify',
      title: 'command.prettify.title',
      subtitle: 'command.prettify.description',
      icon: 'Database',
      aliases: ['sql format', 'sql格式化', 'sql beautify'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try {
          return ctx.output.text(sqlPrettify(ctx.input.text))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'sql.compact',
      title: 'command.compact.title',
      subtitle: 'command.compact.description',
      icon: 'Database',
      aliases: ['sql minify', 'sql压缩', 'sql compress'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(sqlCompact(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default sqlPlugin
