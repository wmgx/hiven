/**
 * First-party XML Formatter plugin.
 *
 * Exposes two independent tools (prettify + compact) — no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'

function xmlPrettify(text: string): string {
  let formatted = ''
  let indent = 0
  const nodes = text.replace(/>\s+</g, '><').trim().split(/(<[^>]+>)/g).filter(Boolean)
  for (const node of nodes) {
    if (node.match(/^<\/\w/)) indent--
    formatted += '  '.repeat(Math.max(indent, 0)) + node.trim() + '\n'
    if (node.match(/^<\w[^>]*[^/]>$/)) indent++
  }
  return formatted.trim()
}

function xmlCompact(text: string): string {
  return text.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim()
}

export const xmlPlugin = definePlugin({
  tools: [
    {
      id: 'xml.prettify',
      title: 'command.prettify.title',
      subtitle: 'command.prettify.description',
      icon: 'Code',
      aliases: ['xml format', 'xml格式化', 'xml beautify'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(xmlPrettify(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
    {
      id: 'xml.compact',
      title: 'command.compact.title',
      subtitle: 'command.compact.description',
      icon: 'Code',
      aliases: ['xml minify', 'xml压缩', 'xml compress'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        return ctx.output.text(xmlCompact(ctx.input.text))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default xmlPlugin
