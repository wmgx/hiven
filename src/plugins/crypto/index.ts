/**
 * First-party Hash plugin.
 *
 * Exposes three independent tools (SHA-256, SHA-1, SHA-512) — no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'

async function computeHash(text: string, algorithm: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hashBuffer = await crypto.subtle.digest(algorithm, data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export const hashPlugin = definePlugin({
  tools: [
    {
      id: 'hash.sha256',
      title: 'command.sha256.title',
      subtitle: 'command.sha256.description',
      icon: 'Hash',
      aliases: ['sha256', 'sha-256'],
      inputPolicy: { mode: 'auto' },
      async run(ctx) {
        try {
          return ctx.output.text(await computeHash(ctx.input.text, 'SHA-256'))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'hash.sha1',
      title: 'command.sha1.title',
      subtitle: 'command.sha1.description',
      icon: 'Hash',
      aliases: ['sha1', 'sha-1'],
      inputPolicy: { mode: 'auto' },
      async run(ctx) {
        try {
          return ctx.output.text(await computeHash(ctx.input.text, 'SHA-1'))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'hash.sha512',
      title: 'command.sha512.title',
      subtitle: 'command.sha512.description',
      icon: 'Hash',
      aliases: ['sha512', 'sha-512'],
      inputPolicy: { mode: 'auto' },
      async run(ctx) {
        try {
          return ctx.output.text(await computeHash(ctx.input.text, 'SHA-512'))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true },
    },
  ],
})

export default hashPlugin
