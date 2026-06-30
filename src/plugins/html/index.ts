/**
 * First-party HTML Entity Encode/Decode plugin.
 *
 * Exposes two independent tools (encode + decode) — no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'

function htmlEncode(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function htmlDecode(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

export const htmlPlugin = definePlugin({
  tools: [
    {
      id: 'html.encode',
      title: 'command.encode.title',
      subtitle: 'command.encode.description',
      icon: 'FileCode',
      aliases: ['html-entities encode', 'html-escape', 'html编码'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(htmlEncode(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'html.decode',
      title: 'command.decode.title',
      subtitle: 'command.decode.description',
      icon: 'FileCode',
      aliases: ['html-entities decode', 'html-unescape', 'html解码'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(htmlDecode(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default htmlPlugin
