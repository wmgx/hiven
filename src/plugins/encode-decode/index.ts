/**
 * First-party Encode/Decode plugin.
 *
 * Groups: Base64, URL, HTML entities, Slashes (escape), JWT decode.
 * Direct tools plus a shared conversion workspace.
 */

import { definePlugin, type PluginToolSurfaces } from '@hiven/plugin'
import { EncodeDecodeSurface } from './EncodeDecodeSurface'
import {
  base64Decode,
  base64Encode,
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
import './style.css'

const LEARNABLE_PURE = { effect: 'pure', learnable: true } as const
const EDITOR_TOOL_SURFACES: PluginToolSurfaces = {
  launcher: { surfaces: ['editor-command-bar', 'quick-editor-command'] },
  panel: true,
}
const WORKSPACE_SHELL = {
  defaultWidth: 860,
  defaultHeight: 640,
  minWidth: 640,
  minHeight: 420,
  closeOnBlur: false,
  resizable: true,
}
const OPERATION_ROUTES = [
  { id: 'base64-encode', title: 'base64.encode.title', aliases: ['base64 encode', 'encode base64', 'b64 encode', 'base64编码', 'base64 编码'] },
  { id: 'base64-decode', title: 'base64.decode.title', aliases: ['base64 decode', 'decode base64', 'b64 decode', 'base64解码', 'base64 解码'] },
  { id: 'url-encode', title: 'url.encode.title', aliases: ['url encode', 'encode url', 'urlencode', 'url编码', 'url 编码'] },
  { id: 'url-decode', title: 'url.decode.title', aliases: ['url decode', 'decode url', 'urldecode', 'url解码', 'url 解码'] },
  { id: 'html-encode', title: 'html.encode.title', aliases: ['html encode', 'encode html', 'html escape', 'html编码', 'html 编码'] },
  { id: 'html-decode', title: 'html.decode.title', aliases: ['html decode', 'decode html', 'html unescape', 'html解码', 'html 解码'] },
  { id: 'slashes-encode', title: 'slashes.escape.title', aliases: ['escape text', 'add slashes', 'text escape', '文本转义', '添加转义'] },
  { id: 'slashes-decode', title: 'slashes.unescape.title', aliases: ['unescape text', 'remove slashes', 'text unescape', '文本反转义', '去除转义'] },
  { id: 'jwt-decode', title: 'jwt.decode.title', aliases: ['jwt decode', 'decode jwt', 'jwt-decode', 'jwt解码', 'jwt 解码'] },
] as const

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const encodeDecodePlugin = definePlugin({
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'Encode / Decode',
        titleI18n: { zh: '编解码' },
        icon: 'Binary',
        aliases: ['encode', 'decode', 'encode decode', 'encoder', 'decoder', '编码', '解码', '编解码', 'bianma', 'jiema'],
        textMatch: (text) => isBase64(text) || isUrlEncoded(text) || hasHtmlEntities(text) || hasEscapeSequences(text) || isJwt(text),
        component: EncodeDecodeSurface,
        entry: {
          launcher: { surfaces: ['global-launcher', 'editor-command-bar', 'quick-editor-command'] },
          shortcutBindable: true,
        },
        shell: WORKSPACE_SHELL,
      },
      ...OPERATION_ROUTES.map((route) => ({
        id: route.id,
        kind: 'custom-view' as const,
        title: 'Encode / Decode',
        titleI18n: { zh: '编解码' },
        component: EncodeDecodeSurface,
        entry: { launcher: false },
        shell: WORKSPACE_SHELL,
      })),
    ],
  },
  launcher: {
    items: OPERATION_ROUTES.map((route) => ({
      id: `open-${route.id}`,
      display: {
        title: route.title,
        subtitle: 'route.open',
        icon: 'Binary',
        aliases: [...route.aliases],
      },
      behavior: { type: 'perform' as const },
      surfaces: ['global-launcher' as const],
      execute(execution) {
        execution.api.openSurface(route.id, { initialText: execution.input?.text })
        return { ok: true as const, keepOpen: true }
      },
    })),
  },
  tools: [
    {
      id: 'base64.encode',
      title: 'base64.encode.title',
      subtitle: 'base64.encode.description',
      icon: 'Binary',
      aliases: ['base64 encode', 'base64编码', 'b64 encode', 'btoa', 'encode base64', '编码'],
      inputPolicy: { mode: 'auto' },
      policy: LEARNABLE_PURE,
      textMatch: (text) => !isBase64(text), // text is NOT base64 → offer to encode
      run(ctx) {
        try { return ctx.output.text(base64Encode(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(ctx.t('error.convert', { message: e.message })) }
      },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'base64.decode',
      title: 'base64.decode.title',
      subtitle: 'base64.decode.description',
      icon: 'Binary',
      aliases: ['b64', 'base64', 'base64 decode', 'base64解码', 'b64 decode', 'atob', 'decode base64', '解码'],
      inputPolicy: { mode: 'auto' },
      policy: LEARNABLE_PURE,
      accepts: { kinds: ['base64'], aliases: ['b64', 'base64', 'base64 decode', 'base64解码'] },
      textMatch: isBase64,
      run(ctx) {
        try { return ctx.output.text(base64Decode(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(ctx.t('error.convert', { message: e.message })) }
      },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'url.encode',
      title: 'url.encode.title',
      subtitle: 'url.encode.description',
      icon: 'Link',
      aliases: ['urlencode', 'url编码', 'percent encode', 'url encode', 'encode url', '编码'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try { return ctx.output.text(urlEncode(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(ctx.t('error.convert', { message: e.message })) }
      },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'url.decode',
      title: 'url.decode.title',
      subtitle: 'url.decode.description',
      icon: 'Link',
      aliases: ['urldecode', 'url解码', 'percent decode', 'url decode', 'decode url', '解码'],
      inputPolicy: { mode: 'auto' },
      accepts: { kinds: ['url-encoded'] },
      textMatch: isUrlEncoded,
      run(ctx) {
        try { return ctx.output.text(urlDecode(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(ctx.t('error.convert', { message: e.message })) }
      },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'html.encode',
      title: 'html.encode.title',
      subtitle: 'html.encode.description',
      icon: 'FileCode',
      aliases: ['html-entities encode', 'html-escape', 'html编码', 'html encode', 'encode html', 'html escape', '编码'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(htmlEncode(ctx.input.text)) },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'html.decode',
      title: 'html.decode.title',
      subtitle: 'html.decode.description',
      icon: 'FileCode',
      aliases: ['html-entities decode', 'html-unescape', 'html解码', 'html decode', 'decode html', 'html unescape', '解码'],
      inputPolicy: { mode: 'auto' },
      textMatch: hasHtmlEntities,
      run(ctx) { return ctx.output.text(htmlDecode(ctx.input.text)) },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'slashes.escape',
      title: 'slashes.escape.title',
      subtitle: 'slashes.escape.description',
      icon: 'Quote',
      aliases: ['escape', 'addslashes', '转义', 'add slashes', '添加转义'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(escapeSlashes(ctx.input.text)) },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'slashes.unescape',
      title: 'slashes.unescape.title',
      subtitle: 'slashes.unescape.description',
      icon: 'Quote',
      aliases: ['unescape', 'stripslashes', '反转义', 'remove slashes', '去除转义'],
      inputPolicy: { mode: 'auto' },
      textMatch: hasEscapeSequences,
      run(ctx) { return ctx.output.text(unescapeSlashes(ctx.input.text)) },
      surfaces: EDITOR_TOOL_SURFACES,
    },
    {
      id: 'jwt.decode',
      title: 'jwt.decode.title',
      subtitle: 'jwt.decode.description',
      icon: 'Key',
      aliases: ['jwt', '解jwt', 'decode jwt', 'jwt-decode', 'json-web-token', 'jwt解码', '解码'],
      inputPolicy: { mode: 'auto' },
      accepts: { kinds: ['jwt'], aliases: ['jwt', '解jwt', 'decode jwt', 'jwt-decode', 'jwt解码'] },
      textMatch: isJwt,
      run(ctx) {
        try { return ctx.output.text(decodeJwt(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(ctx.t('error.convert', { message: e.message })) }
      },
      surfaces: EDITOR_TOOL_SURFACES,
    },
  ],
})

export default encodeDecodePlugin
