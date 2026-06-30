/**
 * First-party CSS Formatter plugin.
 *
 * Exposes two independent tools (prettify + compact) — no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'

function cssPrettify(text: string): string {
  return text
    .replace(/\s*\{\s*/g, ' {\n  ')
    .replace(/\s*\}\s*/g, '\n}\n')
    .replace(/\s*;\s*/g, ';\n  ')
    .replace(/ {2}\n\}/g, '\n}')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function cssCompact(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim()
}

export const cssPlugin = definePlugin({
  tools: [
    {
      id: 'css.prettify',
      title: 'command.prettify.title',
      subtitle: 'command.prettify.description',
      icon: 'Paintbrush',
      aliases: ['css format', 'css格式化', 'css beautify'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(cssPrettify(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'css.compact',
      title: 'command.compact.title',
      subtitle: 'command.compact.description',
      icon: 'Paintbrush',
      aliases: ['css minify', 'css压缩', 'css compress'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(cssCompact(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default cssPlugin
