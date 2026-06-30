/**
 * First-party Text Statistics plugin.
 *
 * Single tool — counts lines, words, characters.
 */

import { definePlugin } from '@hiven/plugin'

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
      aliases: ['stats', 'wc', '文本统计', '字数统计'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(runCount(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default countPlugin
