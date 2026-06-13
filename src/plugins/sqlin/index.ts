/**
 * First-party Lines to SQL IN plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

function runSqlIn(text: string, mode: unknown): string {
  const lines = text.split('\n').filter(l => l.trim() !== '')
  if (mode === 'number') {
    const values = lines.map(l => l.trim())
    return '(' + values.join(',') + ')'
  }
  const values = lines.map(l => "'" + l.trim().replace(/'/g, "''") + "'")
  return '(' + values.join(',') + ')'
}

export const sqlinPlugin = definePlugin({
  tools: [
    {
      id: 'sqlin.run',
      title: 'command.run.title',
      subtitle: 'command.run.description',
      icon: 'Database',
      aliases: ['sql-in', 'lines-to-sql'],
      inputPolicy: { mode: 'auto' },
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.string.label', value: 'string' },
            { label: 'param.mode.option.number.label', value: 'number' },
          ],
          default: 'string',
        },
      ],
      run(ctx) {
        return ctx.output.replaceActiveText(runSqlIn(ctx.input.text, ctx.params.mode))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
  commands: [
    {
      id: 'sqlin.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Database',
      aliases: ['sql-in', 'lines-to-sql'],
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.string.label', value: 'string' },
            { label: 'param.mode.option.number.label', value: 'number' },
          ],
          default: 'string',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        return textOutput(runSqlIn(text, ctx.params.mode))
      },
    },
  ],
})

export default sqlinPlugin
