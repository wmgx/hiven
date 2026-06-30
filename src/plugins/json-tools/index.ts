/**
 * First-party JSON Tools plugin.
 *
 * Groups: JSON prettify/compact, Sort JSON Keys, Query String ↔ JSON.
 * Each operation is an independent tool — no sub-selection needed.
 * Surface UI preserved as Cmd+Enter target for JSON editing.
 */

import { definePlugin } from '@hiven/plugin'
import { JsonSurface } from './JsonSurface'

// ─── JSON ─────────────────────────────────────────────────────────────────────

function jsonPrettify(text: string): string {
  return JSON.stringify(JSON.parse(text), null, 2)
}

function jsonCompact(text: string): string {
  return JSON.stringify(JSON.parse(text))
}

// ─── Sort JSON Keys ───────────────────────────────────────────────────────────

function sortKeys(obj: any): any {
  if (Array.isArray(obj)) return obj.map(sortKeys)
  if (obj && typeof obj === 'object') {
    return Object.keys(obj).sort().reduce((acc: any, key: string) => {
      acc[key] = sortKeys(obj[key])
      return acc
    }, {})
  }
  return obj
}

function sortJsonKeys(text: string): string {
  return JSON.stringify(sortKeys(JSON.parse(text)), null, 2)
}

// ─── Query String ─────────────────────────────────────────────────────────────

function queryStringToJson(text: string): string {
  let qs = text.trim()
  if (qs.startsWith('?')) qs = qs.slice(1)
  const params = new URLSearchParams(qs)
  const obj: Record<string, string> = {}
  params.forEach((v, k) => { obj[k] = v })
  return JSON.stringify(obj, null, 2)
}

function jsonToQueryString(text: string): string {
  const obj = JSON.parse(text)
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) {
    params.set(k, String(v))
  }
  return params.toString()
}

// ─── Content Matchers ─────────────────────────────────────────────────────────

function isJson(text: string): boolean {
  const t = text.trim()
  if (!(t.startsWith('{') || t.startsWith('['))) return false
  try { JSON.parse(t); return true } catch { return false }
}

function isQueryString(text: string): boolean {
  const t = text.trim().startsWith('?') ? text.trim().slice(1) : text.trim()
  return /^[\w%+.-]+=[\w%+.*-]*(?:&[\w%+.-]+=[\w%+.*-]*)+$/.test(t)
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const jsonToolsPlugin = definePlugin({
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'JSON',
        titleI18n: { zh: 'JSON' },
        icon: 'Braces',
        aliases: ['json', 'json-format', 'pretty-json'],
        component: JsonSurface,
        entry: { launcher: true, shortcutBindable: true },
        shell: {
          defaultWidth: 860,
          defaultHeight: 620,
          minWidth: 640,
          minHeight: 420,
          closeOnBlur: false,
          resizable: true,
        },
      },
    ],
  },
  tools: [
    {
      id: 'json.prettify',
      title: 'json.prettify.title',
      subtitle: 'json.prettify.description',
      icon: 'Braces',
      aliases: ['json format', 'json格式化', 'pretty json', 'json beautify'],
      inputPolicy: { mode: 'auto' },
      textMatch: isJson,
      run(ctx) {
        try { return ctx.output.text(jsonPrettify(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(`Error: ${e.message}`) }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'json.compact',
      title: 'json.compact.title',
      subtitle: 'json.compact.description',
      icon: 'Braces',
      aliases: ['json minify', 'json压缩', 'compact json', 'json compress'],
      inputPolicy: { mode: 'auto' },
      textMatch: isJson,
      run(ctx) {
        try { return ctx.output.text(jsonCompact(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(`Error: ${e.message}`) }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'sort-json.run',
      title: 'sortJson.title',
      subtitle: 'sortJson.description',
      icon: 'ArrowUpNarrowWide',
      aliases: ['json sort', 'sort json keys', 'json key排序', 'json排序'],
      inputPolicy: { mode: 'auto' },
      textMatch: isJson,
      run(ctx) {
        try { return ctx.output.text(sortJsonKeys(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(`Error: ${e.message}`) }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'query-string.toJson',
      title: 'queryString.toJson.title',
      subtitle: 'queryString.toJson.description',
      icon: 'Search',
      aliases: ['qs2json', 'query to json', 'querystring to json', 'qs转json'],
      inputPolicy: { mode: 'auto' },
      textMatch: isQueryString,
      run(ctx) {
        try { return ctx.output.text(queryStringToJson(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(`Error: ${e.message}`) }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'query-string.fromJson',
      title: 'queryString.fromJson.title',
      subtitle: 'queryString.fromJson.description',
      icon: 'Search',
      aliases: ['json2qs', 'json to query', 'json to querystring', 'json转qs'],
      inputPolicy: { mode: 'auto' },
      textMatch: isJson,
      run(ctx) {
        try { return ctx.output.text(jsonToQueryString(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(`Error: ${e.message}`) }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default jsonToolsPlugin
