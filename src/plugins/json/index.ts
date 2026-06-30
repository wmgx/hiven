/**
 * First-party JSON Formatter plugin.
 *
 * Exposes two independent tools (prettify + compact) — no sub-selection needed.
 * Surface UI preserved as Cmd+Enter target.
 */

import { definePlugin } from '@hiven/plugin'
import { JsonSurface } from './JsonSurface'

function jsonPrettify(text: string): string {
  return JSON.stringify(JSON.parse(text), null, 2)
}

function jsonCompact(text: string): string {
  return JSON.stringify(JSON.parse(text))
}

export const jsonPlugin = definePlugin({
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
      title: 'command.prettify.title',
      subtitle: 'command.prettify.description',
      icon: 'Braces',
      aliases: ['json format', 'json格式化', 'pretty json', 'json beautify'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try {
          return ctx.output.text(jsonPrettify(ctx.input.text))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'json.compact',
      title: 'command.compact.title',
      subtitle: 'command.compact.description',
      icon: 'Braces',
      aliases: ['json minify', 'json压缩', 'compact json', 'json compress'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try {
          return ctx.output.text(jsonCompact(ctx.input.text))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default jsonPlugin
