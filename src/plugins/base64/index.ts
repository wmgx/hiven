/**
 * First-party Base64 Encode/Decode plugin.
 *
 * Exposes two independent tools (encode + decode) — no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'

function base64Encode(text: string): string {
  return btoa(unescape(encodeURIComponent(text)))
}

function base64Decode(text: string): string {
  return decodeURIComponent(escape(atob(text.trim())))
}

export const base64Plugin = definePlugin({
  tools: [
    {
      id: 'base64.encode',
      title: 'command.encode.title',
      subtitle: 'command.encode.description',
      icon: 'Binary',
      aliases: ['base64 encode', 'base64编码', 'b64 encode', 'btoa'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try {
          return ctx.output.text(base64Encode(ctx.input.text))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'base64.decode',
      title: 'command.decode.title',
      subtitle: 'command.decode.description',
      icon: 'Binary',
      aliases: ['base64 decode', 'base64解码', 'b64 decode', 'atob'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try {
          return ctx.output.text(base64Decode(ctx.input.text))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default base64Plugin
