/**
 * First-party Formatter plugin.
 *
 * Groups: CSS, SQL, XML prettify/compact.
 * Each operation is an independent tool — no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'
import { format as sqlFormat } from 'sql-formatter'

// ─── CSS ──────────────────────────────────────────────────────────────────────

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

// ─── SQL ──────────────────────────────────────────────────────────────────────

function sqlPrettify(text: string): string {
  return sqlFormat(text)
}

function sqlCompact(text: string): string {
  return text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()
}

// ─── XML ──────────────────────────────────────────────────────────────────────

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

// ─── Plugin Definition ────────────────────────────────────────────────────────

export const formatterPlugin = definePlugin({
  tools: [
    {
      id: 'css.prettify',
      title: 'css.prettify.title',
      subtitle: 'css.prettify.description',
      icon: 'Paintbrush',
      aliases: ['css format', 'css格式化', 'css beautify'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(cssPrettify(ctx.input.text)) },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'css.compact',
      title: 'css.compact.title',
      subtitle: 'css.compact.description',
      icon: 'Paintbrush',
      aliases: ['css minify', 'css压缩', 'css compress'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(cssCompact(ctx.input.text)) },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'sql.prettify',
      title: 'sql.prettify.title',
      subtitle: 'sql.prettify.description',
      icon: 'Database',
      aliases: ['sql format', 'sql格式化', 'sql beautify'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try { return ctx.output.text(sqlPrettify(ctx.input.text)) }
        catch (e: any) { return ctx.output.error(`Error: ${e.message}`) }
      },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'sql.compact',
      title: 'sql.compact.title',
      subtitle: 'sql.compact.description',
      icon: 'Database',
      aliases: ['sql minify', 'sql压缩', 'sql compress'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(sqlCompact(ctx.input.text)) },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'xml.prettify',
      title: 'xml.prettify.title',
      subtitle: 'xml.prettify.description',
      icon: 'Code',
      aliases: ['xml format', 'xml格式化', 'xml beautify'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(xmlPrettify(ctx.input.text)) },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'xml.compact',
      title: 'xml.compact.title',
      subtitle: 'xml.compact.description',
      icon: 'Code',
      aliases: ['xml minify', 'xml压缩', 'xml compress'],
      inputPolicy: { mode: 'auto' },
      run(ctx) { return ctx.output.text(xmlCompact(ctx.input.text)) },
      surfaces: { launcher: true, panel: true },
    },
  ],
})

export default formatterPlugin
