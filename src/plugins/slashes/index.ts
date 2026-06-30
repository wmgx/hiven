/**
 * First-party Escape/Unescape Slashes plugin.
 *
 * Exposes two independent tools (escape + unescape) — no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'

function escapeSlashes(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

function unescapeSlashes(text: string): string {
  return text
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
}

export const slashesPlugin = definePlugin({
  tools: [
    {
      id: 'slashes.escape',
      title: 'command.escape.title',
      subtitle: 'command.escape.description',
      icon: 'Quote',
      aliases: ['escape', 'addslashes', '转义', 'add slashes'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(escapeSlashes(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'slashes.unescape',
      title: 'command.unescape.title',
      subtitle: 'command.unescape.description',
      icon: 'Quote',
      aliases: ['unescape', 'stripslashes', '反转义', 'remove slashes'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(unescapeSlashes(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default slashesPlugin
