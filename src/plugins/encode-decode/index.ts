/**
 * First-party Encode/Decode plugin.
 *
 * Groups: Base64, URL, HTML entities, Slashes (escape), JWT decode.
 * Each operation is an independent tool — no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'

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
      run(ctx) {
        try { return ctx.output.text(base64Encode(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(`Error: ${e.message}`) }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'base64.decode',
      title: 'base64.decode.title',
      subtitle: 'base64.decode.description',
      icon: 'Binary',
      aliases: ['base64 decode', 'base64解码', 'b64 decode', 'atob'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try { return ctx.output.text(base64Decode(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(`Error: ${e.message}`) }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
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
        catch (e: any) { return ctx.output.error(`Error: ${e.message}`) }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'url.decode',
      title: 'url.decode.title',
      subtitle: 'url.decode.description',
      icon: 'Link',
      aliases: ['urldecode', 'url解码', 'percent decode'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try { return ctx.output.text(urlDecode(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(`Error: ${e.message}`) }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'html.encode',
      title: 'html.encode.title',
      subtitle: 'html.encode.description',
      icon: 'FileCode',
      aliases: ['html-entities encode', 'html-escape', 'html编码'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(htmlEncode(ctx.input.text)) },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'html.decode',
      title: 'html.decode.title',
      subtitle: 'html.decode.description',
      icon: 'FileCode',
      aliases: ['html-entities decode', 'html-unescape', 'html解码'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(htmlDecode(ctx.input.text)) },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'slashes.escape',
      title: 'slashes.escape.title',
      subtitle: 'slashes.escape.description',
      icon: 'Quote',
      aliases: ['escape', 'addslashes', '转义', 'add slashes'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(escapeSlashes(ctx.input.text)) },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'slashes.unescape',
      title: 'slashes.unescape.title',
      subtitle: 'slashes.unescape.description',
      icon: 'Quote',
      aliases: ['unescape', 'stripslashes', '反转义', 'remove slashes'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(unescapeSlashes(ctx.input.text)) },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'jwt.decode',
      title: 'jwt.decode.title',
      subtitle: 'jwt.decode.description',
      icon: 'Key',
      aliases: ['jwt-decode', 'json-web-token', 'jwt解码'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try { return ctx.output.text(decodeJwt(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(`Error: ${e.message}`) }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default encodeDecodePlugin
