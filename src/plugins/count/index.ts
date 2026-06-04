/**
 * First-party Text Statistics plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'

export const countPlugin = definePlugin({
  id: 'count',
  title: 'Text Statistics',
  version: '1.0.0',

  commands: [
    {
      id: 'count.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'BarChart',
      aliases: ['stats', 'wc'],
      tags: ['text', 'stats'],
      live: { live: { enabled: true, trigger: 'on-input', sideEffects: 'none', debounceMs: 250 } },
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        const reply = (t: string) => ({ effects: [{ type: 'text.replace' as const, target: input?.paneId ? { paneId: input.paneId } : 'active-input' as const, text: t }] })
        const lines = text.split('\n').length
        const words = text.split(/\s+/).filter((w) => w.length > 0).length
        const chars = text.length
        const charsNoSpace = text.replace(/\s/g, '').length
        return reply(`Lines: ${lines}\nWords: ${words}\nCharacters: ${chars}\nCharacters (no spaces): ${charsNoSpace}`)
      },
    },
  ],
})

export default countPlugin
