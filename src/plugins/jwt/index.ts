/**
 * First-party JWT Decode plugin.
 *
 * Single tool — decodes JWT token header and payload.
 */

import { definePlugin } from '@hiven/plugin'

function decodeJwt(text: string): string {
  const parts = text.trim().split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT (expected 3 parts)')
  const decode = (s: string) => {
    const pad = s + '='.repeat((4 - s.length % 4) % 4)
    return JSON.parse(decodeURIComponent(escape(atob(pad.replace(/-/g, '+').replace(/_/g, '/')))))
  }
  const header = decode(parts[0])
  const payload = decode(parts[1])
  return `// Header\n${JSON.stringify(header, null, 2)}\n\n// Payload\n${JSON.stringify(payload, null, 2)}`
}

export const jwtPlugin = definePlugin({
  tools: [
    {
      id: 'jwt.decode',
      title: 'command.decode.title',
      subtitle: 'command.decode.description',
      icon: 'Key',
      aliases: ['jwt-decode', 'json-web-token', 'jwt解码'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try {
          return ctx.output.text(decodeJwt(ctx.input.text))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default jwtPlugin
