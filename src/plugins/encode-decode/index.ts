/**
 * First-party Encode/Decode plugin.
 *
 * Groups: Base64, URL, HTML entities, Slashes (escape), JWT decode.
 * Each operation is an independent tool — no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'

const LEARNABLE_PURE = { effect: 'pure', learnable: true } as const

// ─── Base64 ───────────────────────────────────────────────────────────────────

function base64Encode(text: string): string {
  return btoa(unescape(encodeURIComponent(text)))
}

function base64Decode(text: string): string {
  return decodeURIComponent(escape(atob(text.trim())))
}

// ─── URL ──────────────────────────────────────────────────────────────────────

function urlEncode(text: string): string {
  return encodeURIComponent(text)
}

function urlDecode(text: string): string {
  return decodeURIComponent(text.trim())
}

// ─── HTML Entities ────────────────────────────────────────────────────────────

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

// ─── Slashes ──────────────────────────────────────────────────────────────────

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

// ─── JWT ──────────────────────────────────────────────────────────────────────

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

// ─── Content Matchers ─────────────────────────────────────────────────────────

function isBase64(text: string): boolean {
  const t = text.trim()
  if (t.length < 4) return false
  return /^[A-Za-z0-9+/\n\r]+=*$/.test(t) && t.length % 4 <= 1
}

function isUrlEncoded(text: string): boolean {
  return /%[0-9A-Fa-f]{2}/.test(text)
}

function hasHtmlEntities(text: string): boolean {
  return /&(?:amp|lt|gt|quot|#39|#\d+|#x[0-9a-f]+);/i.test(text)
}

function hasEscapeSequences(text: string): boolean {
  return /\\[nrt"'\\]/.test(text)
}

function isJwt(text: string): boolean {
  const t = text.trim()
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t)) return false
  // Strong check: header must decode to JSON with `alg` (reject `ipb.xxx.yyy`).
  try {
    const headerSeg = t.split('.')[0] ?? ''
    if (headerSeg.length < 4) return false
    const padded = headerSeg + '='.repeat((4 - (headerSeg.length % 4)) % 4)
    const b64 = padded.replace(/-/g, '+').replace(/_/g, '/')
    const json =
      typeof Buffer !== 'undefined'
        ? Buffer.from(b64, 'base64').toString('utf8')
        : typeof atob === 'function'
          ? atob(b64)
          : ''
    const header = JSON.parse(json) as { alg?: unknown }
    return Boolean(header && typeof header === 'object' && typeof header.alg === 'string' && header.alg)
  } catch {
    return false
  }
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const encodeDecodePlugin = definePlugin({
  tools: [
    {
      id: 'base64.encode',
      title: 'base64.encode.title',
      subtitle: 'base64.encode.description',
      icon: 'Binary',
      aliases: ['base64 encode', 'base64编码', 'b64 encode', 'btoa'],
      inputPolicy: { mode: 'auto' },
      policy: LEARNABLE_PURE,
      textMatch: (text) => !isBase64(text), // text is NOT base64 → offer to encode
      run(ctx) {
        try { return ctx.output.text(base64Encode(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(ctx.t('error.convert', { message: e.message })) }
      },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'base64.decode',
      title: 'base64.decode.title',
      subtitle: 'base64.decode.description',
      icon: 'Binary',
      aliases: ['b64', 'base64', 'base64 decode', 'base64解码', 'b64 decode', 'atob'],
      inputPolicy: { mode: 'auto' },
      policy: LEARNABLE_PURE,
      accepts: { kinds: ['base64'], aliases: ['b64', 'base64', 'base64 decode', 'base64解码'] },
      textMatch: isBase64,
      run(ctx) {
        try { return ctx.output.text(base64Decode(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(ctx.t('error.convert', { message: e.message })) }
      },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'url.encode',
      title: 'url.encode.title',
      subtitle: 'url.encode.description',
      icon: 'Link',
      aliases: ['urlencode', 'url编码', 'percent encode'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try { return ctx.output.text(urlEncode(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(ctx.t('error.convert', { message: e.message })) }
      },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'url.decode',
      title: 'url.decode.title',
      subtitle: 'url.decode.description',
      icon: 'Link',
      aliases: ['urldecode', 'url解码', 'percent decode'],
      inputPolicy: { mode: 'auto' },
      accepts: { kinds: ['url-encoded'] },
      textMatch: isUrlEncoded,
      run(ctx) {
        try { return ctx.output.text(urlDecode(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(ctx.t('error.convert', { message: e.message })) }
      },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'html.encode',
      title: 'html.encode.title',
      subtitle: 'html.encode.description',
      icon: 'FileCode',
      aliases: ['html-entities encode', 'html-escape', 'html编码'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(htmlEncode(ctx.input.text)) },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'html.decode',
      title: 'html.decode.title',
      subtitle: 'html.decode.description',
      icon: 'FileCode',
      aliases: ['html-entities decode', 'html-unescape', 'html解码'],
      inputPolicy: { mode: 'auto' },
      textMatch: hasHtmlEntities,
      run(ctx) { return ctx.output.text(htmlDecode(ctx.input.text)) },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'slashes.escape',
      title: 'slashes.escape.title',
      subtitle: 'slashes.escape.description',
      icon: 'Quote',
      aliases: ['escape', 'addslashes', '转义', 'add slashes'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(escapeSlashes(ctx.input.text)) },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'slashes.unescape',
      title: 'slashes.unescape.title',
      subtitle: 'slashes.unescape.description',
      icon: 'Quote',
      aliases: ['unescape', 'stripslashes', '反转义', 'remove slashes'],
      inputPolicy: { mode: 'auto' },
      textMatch: hasEscapeSequences,
      run(ctx) { return ctx.output.text(unescapeSlashes(ctx.input.text)) },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'jwt.decode',
      title: 'jwt.decode.title',
      subtitle: 'jwt.decode.description',
      icon: 'Key',
      aliases: ['jwt', '解jwt', 'decode jwt', 'jwt-decode', 'json-web-token', 'jwt解码'],
      inputPolicy: { mode: 'auto' },
      accepts: { kinds: ['jwt'], aliases: ['jwt', '解jwt', 'decode jwt', 'jwt-decode', 'jwt解码'] },
      textMatch: isJwt,
      run(ctx) {
        try { return ctx.output.text(decodeJwt(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(ctx.t('error.convert', { message: e.message })) }
      },
      surfaces: { launcher: true, panel: true },
    },
  ],
})

export default encodeDecodePlugin
