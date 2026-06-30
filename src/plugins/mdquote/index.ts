/**
 * First-party Markdown Quote plugin.
 *
 * Exposes two independent tools (add + remove) — no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'

function addQuote(text: string): string {
  return text.split('\n').map(l => '> ' + l).join('\n')
}

function removeQuote(text: string): string {
  return text.split('\n').map(l => l.replace(/^>\s?/, '')).join('\n')
}

export const mdquotePlugin = definePlugin({
  tools: [
    {
      id: 'mdquote.add',
      title: 'command.add.title',
      subtitle: 'command.add.description',
      icon: 'MessageSquareQuote',
      aliases: ['blockquote', 'add quote', '添加引用'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(addQuote(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'mdquote.remove',
      title: 'command.remove.title',
      subtitle: 'command.remove.description',
      icon: 'MessageSquareQuote',
      aliases: ['remove quote', 'unquote', '移除引用'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(removeQuote(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default mdquotePlugin
