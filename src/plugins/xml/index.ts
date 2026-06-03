/**
 * First-party XML Formatter plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'

export const xmlPlugin = definePlugin({
  id: 'xml',
  title: 'XML Formatter',
  version: '1.0.0',

  commands: [
    {
      id: 'xml.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Code',
      aliases: ['xml-format', 'xml-minify', 'html-format'],
      tags: ['xml', 'html', 'format'],
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.pretty.label', value: 'pretty' },
            { label: 'param.mode.option.compact.label', value: 'compact' },
          ],
          default: 'pretty',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        const reply = (t: string) => ({ effects: [{ type: 'text.replace' as const, target: input?.paneId ? { paneId: input.paneId } : 'active-input' as const, text: t }] })
        if (ctx.params.mode === 'compact') {
          return reply(text.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim())
        }
        let formatted = ''
        let indent = 0
        const nodes = text.replace(/>\s+</g, '><').trim().split(/(<[^>]+>)/g).filter(Boolean)
        for (const node of nodes) {
          if (node.match(/^<\/\w/)) indent--
          formatted += '  '.repeat(Math.max(indent, 0)) + node.trim() + '\n'
          if (node.match(/^<\w[^>]*[^/]>$/)) indent++
        }
        return reply(formatted.trim())
      },
    },
  ],
})

export default xmlPlugin
