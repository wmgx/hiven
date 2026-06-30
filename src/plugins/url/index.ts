/**
 * First-party URL Encode/Decode plugin.
 *
 * Exposes two independent tools (encode + decode) — no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'

function urlEncode(text: string): string {
  return encodeURIComponent(text)
}

function urlDecode(text: string): string {
  return decodeURIComponent(text.trim())
}

export const urlPlugin = definePlugin({
  tools: [
    {
      id: 'url.encode',
      title: 'command.encode.title',
      subtitle: 'command.encode.description',
      icon: 'Link',
      aliases: ['urlencode', 'url编码', 'percent encode'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try {
          return ctx.output.text(urlEncode(ctx.input.text))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'url.decode',
      title: 'command.decode.title',
      subtitle: 'command.decode.description',
      icon: 'Link',
      aliases: ['urldecode', 'url解码', 'percent decode'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try {
          return ctx.output.text(urlDecode(ctx.input.text))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default urlPlugin
