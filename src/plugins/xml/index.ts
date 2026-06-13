/**
 * First-party XML Formatter plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

function runXml(text: string, mode: unknown): string {
  if (mode === 'compact') {
    return text.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim()
  }
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

export const xmlPlugin = definePlugin({
  tools: [
    {
      id: 'xml.run',
      title: 'command.run.title',
      icon: 'Code',
      aliases: ['xml-format', 'xml-minify', 'html-format'],
      inputPolicy: { mode: 'auto' },
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
      run(ctx) {
        return ctx.output.replaceActiveText(runXml(ctx.input.text, ctx.params.mode))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
  commands: [
    {
      id: 'xml.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Code',
      aliases: ['xml-format', 'xml-minify', 'html-format'],
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
        return textOutput(runXml(text, ctx.params.mode))
      },
    },
  ],
})

export default xmlPlugin
