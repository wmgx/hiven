/**
 * First-party Text Statistics plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

function runCount(text: string): string {
  const lines = text.split('\n').length
  const words = text.split(/\s+/).filter((w) => w.length > 0).length
  const chars = text.length
  const charsNoSpace = text.replace(/\s/g, '').length
  return `Lines: ${lines}\nWords: ${words}\nCharacters: ${chars}\nCharacters (no spaces): ${charsNoSpace}`
}

export const countPlugin = definePlugin({
  tools: [
    {
      id: 'count.run',
      title: 'command.run.title',
      subtitle: 'command.run.description',
      icon: 'BarChart',
      aliases: ['stats', 'wc'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(runCount(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
  commands: [
    {
      id: 'count.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'BarChart',
      aliases: ['stats', 'wc'],
      live: { live: { enabled: true, trigger: 'on-input', sideEffects: 'none', debounceMs: 250 } },
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        return textOutput(runCount(text))
      },
    },
  ],
})

export default countPlugin
