/**
 * First-party SQL Formatter plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'
import { format } from 'sql-formatter'

function runSql(text: string, mode: unknown): string {
  if (mode === 'compact') {
    return text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()
  }
  return format(text)
}

export const sqlPlugin = definePlugin({
  tools: [
    {
      id: 'sql.run',
      title: 'command.run.title',
      subtitle: 'command.run.description',
      icon: 'Database',
      aliases: ['sql-format', 'sql-minify'],
      inputPolicy: { mode: 'auto' },
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.pretty.label', value: 'pretty' },
            { label: 'param.mode.option.compact.label', value: 'compact' },
          ],
          default: 'pretty',
        },
      ],
      run(ctx) {
        return ctx.output.replaceActiveText(runSql(ctx.input.text, ctx.params.mode))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
  commands: [
    {
      id: 'sql.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Database',
      aliases: ['sql-format', 'sql-minify'],
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.pretty.label', value: 'pretty' },
            { label: 'param.mode.option.compact.label', value: 'compact' },
          ],
          default: 'pretty',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        return textOutput(runSql(text, ctx.params.mode))
      },
    },
  ],
})

export default sqlPlugin
