/**
 * First-party Sort JSON Keys plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'

export const sortJsonPlugin = definePlugin({
  id: 'sort-json',
  title: 'Sort JSON Keys',
  version: '1.0.0',

  commands: [
    {
      id: 'sort-json.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'ArrowUpNarrowWide',
      aliases: ['json-sort', 'sort-json-keys'],
      tags: ['json', 'sort'],
      params: [],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        const reply = (t: string) => ({ effects: [{ type: 'text.replace' as const, target: input?.paneId ? { paneId: input.paneId } : 'active-input' as const, text: t }] })
        try {
          const sortKeys = (obj: any): any => {
            if (Array.isArray(obj)) return obj.map(sortKeys)
            if (obj && typeof obj === 'object') {
              return Object.keys(obj).sort().reduce((acc: any, key: string) => {
                acc[key] = sortKeys(obj[key])
                return acc
              }, {})
            }
            return obj
          }
          return reply(JSON.stringify(sortKeys(JSON.parse(text)), null, 2))
        } catch (e: any) {
          return reply(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default sortJsonPlugin
