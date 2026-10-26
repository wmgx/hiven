/**
 * First-party Hash plugin.
 *
 * One independent tool per algorithm (MD5, SHA-1, SHA-256, SHA-384, SHA-512), no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'
import { md5Hex } from './md5'

type Algorithm = { key: string; webCrypto?: string; aliases: string[] }

const ALGORITHMS: Algorithm[] = [
  { key: 'md5', aliases: ['md5'] },
  { key: 'sha1', webCrypto: 'SHA-1', aliases: ['sha1', 'sha-1'] },
  { key: 'sha256', webCrypto: 'SHA-256', aliases: ['sha256', 'sha-256'] },
  { key: 'sha384', webCrypto: 'SHA-384', aliases: ['sha384', 'sha-384'] },
  { key: 'sha512', webCrypto: 'SHA-512', aliases: ['sha512', 'sha-512'] },
]

async function computeHash(text: string, algorithm: Algorithm): Promise<string> {
  const data = new TextEncoder().encode(text)
  if (!algorithm.webCrypto) return md5Hex(data)
  const hashBuffer = await crypto.subtle.digest(algorithm.webCrypto, data)
  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, '0')).join('')
}

export const hashPlugin = definePlugin({
  tools: ALGORITHMS.map((algorithm) => ({
    id: `hash.${algorithm.key}`,
    title: `command.${algorithm.key}.title`,
    subtitle: `command.${algorithm.key}.description`,
    icon: 'Hash',
    aliases: algorithm.aliases,
    inputPolicy: { mode: 'auto' as const },
    async run(ctx) {
      try {
        return ctx.output.text(await computeHash(ctx.input.text, algorithm))
      } catch (e) {
        return ctx.output.error(ctx.t('error.hash', { message: e instanceof Error ? e.message : String(e) }))
      }
    },
    surfaces: { launcher: { surfaces: ['global-launcher', 'quick-editor-command'] as Array<'global-launcher' | 'quick-editor-command'> }, panel: true },
  })),
})

export default hashPlugin
