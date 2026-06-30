/**
 * First-party JSON ↔ Query String plugin.
 *
 * Exposes two independent tools (toJson + fromJson) — no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'

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

export const queryStringPlugin = definePlugin({
  tools: [
    {
      id: 'query-string.toJson',
      title: 'command.toJson.title',
      subtitle: 'command.toJson.description',
      icon: 'Search',
      aliases: ['qs2json', 'query to json', 'querystring to json', 'qs转json'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try {
          return ctx.output.text(queryStringToJson(ctx.input.text))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'query-string.fromJson',
      title: 'command.fromJson.title',
      subtitle: 'command.fromJson.description',
      icon: 'Search',
      aliases: ['json2qs', 'json to query', 'json to querystring', 'json转qs'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try {
          return ctx.output.text(jsonToQueryString(ctx.input.text))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default queryStringPlugin
