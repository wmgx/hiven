/**
 * First-party SQL Formatter plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'
import { format } from 'sql-formatter'

export const sqlPlugin = definePlugin({
  commands: [
    {
      id: 'sql.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Database',
      aliases: ['sql-format', 'sql-minify'],
      optionalParams: true,
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
        const reply = (t: string) => ({ effects: [{ type: 'text.replace' as const, target: input?.paneId ? { paneId: input.paneId } : 'active-input' as const, text: t }] })
        if (ctx.params.mode === 'compact') {
          return reply(text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim())
        }
        return reply(format(text))
      },
    },
  ],
})

export default sqlPlugin
