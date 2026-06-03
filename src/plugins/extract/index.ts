/**
 * First-party Extract Patterns plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'

export const extractPlugin = definePlugin({
  id: 'extract',
  title: 'Extract Patterns',
  version: '1.0.0',

  commands: [
    {
      id: 'extract.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Regex',
      aliases: ['grep', 'filter'],
      tags: ['text', 'extract'],
      params: [
        {
          key: 'pattern',
          label: 'param.pattern.label',
          type: 'text',
          default: '',
          required: true,
        },
        {
          key: 'matchOnly',
          label: 'param.matchOnly.label',
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
        const text = input?.kind === 'text' ? input.text : ''
        const reply = (t: string) => ({ effects: [{ type: 'text.replace' as const, target: input?.paneId ? { paneId: input.paneId } : 'active-input' as const, text: t }] })
        const { pattern, matchOnly } = ctx.params
        if (!pattern) return reply(text)
        try {
          const re = new RegExp(pattern as string, 'gim')
          if (matchOnly) {
            const matches = text.match(re) || []
            return reply(matches.join('\n'))
          }
          const lines = text.split('\n').filter(l => re.test(l))
          return reply(lines.join('\n'))
        } catch (e: any) {
          return reply(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default extractPlugin
