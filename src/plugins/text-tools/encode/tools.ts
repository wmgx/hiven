import { type PluginToolContribution, type PluginToolContext, type PluginToolSurfaces } from '@hiven/plugin'
import {
  base64Decode,
  base64Encode,
  conversionErrorKey,
  decodeJwt,
  escapeSlashes,
  hasEscapeSequences,
  hasHtmlEntities,
  htmlDecode,
  htmlEncode,
  isBase64,
  isJwt,
  isUrlEncoded,
  unescapeSlashes,
  urlDecode,
  urlEncode,
} from './core'

const PURE_ACTION_POLICY = { effect: 'pure' } as const
const TEXT_TOOL_SURFACES: PluginToolSurfaces = {
  launcher: { surfaces: ['global-launcher', 'quick-editor-command'] },
  panel: true,
}

type TextResult = { ok: true; text: string } | { ok: false; message: string }

function decodeBase64Text(ctx: PluginToolContext): TextResult {
  try { return { ok: true, text: base64Decode(ctx.input.text) } }
  catch (error) { return { ok: false, message: ctx.t(conversionErrorKey(error)) } }
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const encodeTools: PluginToolContribution[] = [
    {
      id: 'base64.encode',
      title: 'base64.encode.title',
      icon: 'Binary',
      aliases: ['base64 encode', 'base64编码', 'b64 encode', 'btoa', 'encode base64', '编码'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      textMatch: (text) => !isBase64(text), // text is NOT base64 → offer to encode
      run(ctx) {
        try { return ctx.output.text(base64Encode(ctx.input.text)) }
        catch (e) { return ctx.output.error(ctx.t(conversionErrorKey(e))) }
      },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'base64.decode',
      title: 'base64.decode.title',
      icon: 'Binary',
      aliases: ['b64', 'base64', 'base64 decode', 'base64解码', 'b64 decode', 'atob', 'decode base64', '解码'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      accepts: { kinds: ['base64'], aliases: ['b64', 'base64', 'base64 decode', 'base64解码'] },
      textMatch: isBase64,
      run(ctx) {
        const result = decodeBase64Text(ctx)
        return result.ok ? ctx.output.text(result.text) : ctx.output.error(result.message)
      },
      surfaces: { launcher: { surfaces: ['global-launcher', 'quick-editor-command'] }, panel: true },
    },
    {
      id: 'url.encode',
      title: 'url.encode.title',
      icon: 'Link',
      aliases: ['urlencode', 'url编码', 'percent encode', 'url encode', 'encode url', '编码'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      run(ctx) {
        try { return ctx.output.text(urlEncode(ctx.input.text)) }
        catch (e) { return ctx.output.error(ctx.t(conversionErrorKey(e))) }
      },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'url.decode',
      title: 'url.decode.title',
      icon: 'Link',
      aliases: ['urldecode', 'url解码', 'percent decode', 'url decode', 'decode url', '解码'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      accepts: { kinds: ['url-encoded'] },
      textMatch: isUrlEncoded,
      run(ctx) {
        try { return ctx.output.text(urlDecode(ctx.input.text)) }
        catch (e) { return ctx.output.error(ctx.t(conversionErrorKey(e))) }
      },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'html.encode',
      title: 'html.encode.title',
      icon: 'FileCode',
      aliases: ['html-entities encode', 'html-escape', 'html编码', 'html encode', 'encode html', 'html escape', '编码'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      run(ctx) { return ctx.output.text(htmlEncode(ctx.input.text)) },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'html.decode',
      title: 'html.decode.title',
      icon: 'FileCode',
      aliases: ['html-entities decode', 'html-unescape', 'html解码', 'html decode', 'decode html', 'html unescape', '解码'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      textMatch: hasHtmlEntities,
      run(ctx) { return ctx.output.text(htmlDecode(ctx.input.text)) },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'slashes.escape',
      title: 'slashes.escape.title',
      icon: 'Quote',
      aliases: ['escape', 'addslashes', '转义', 'add slashes', '添加转义'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      run(ctx) { return ctx.output.text(escapeSlashes(ctx.input.text)) },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'slashes.unescape',
      title: 'slashes.unescape.title',
      icon: 'Quote',
      aliases: ['unescape', 'stripslashes', '反转义', 'remove slashes', '去除转义'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      textMatch: hasEscapeSequences,
      run(ctx) { return ctx.output.text(unescapeSlashes(ctx.input.text)) },
      surfaces: TEXT_TOOL_SURFACES,
    },
    {
      id: 'jwt.decode',
      title: 'jwt.decode.title',
      icon: 'Key',
      aliases: ['jwt', '解jwt', 'decode jwt', 'jwt-decode', 'json-web-token', 'jwt解码', '解码'],
      inputPolicy: { mode: 'auto' },
      policy: PURE_ACTION_POLICY,
      accepts: { kinds: ['jwt'], aliases: ['jwt', '解jwt', 'decode jwt', 'jwt-decode', 'jwt解码'] },
      textMatch: isJwt,
      run(ctx) {
        try { return ctx.output.text(decodeJwt(ctx.input.text)) }
        catch (e) { return ctx.output.error(ctx.t(conversionErrorKey(e))) }
      },
      surfaces: TEXT_TOOL_SURFACES,
    },
  ]
