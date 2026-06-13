/**
 * First-party Extract Patterns plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

function runExtract(text: string, params: Record<string, unknown>): string {
  const { pattern, matchOnly } = params
  if (!pattern) return text
  const re = new RegExp(pattern as string, 'gim')
  if (matchOnly) {
    const matches = text.match(re) || []
    return matches.join('\n')
  }
  const lines = text.split('\n').filter(l => re.test(l))
  return lines.join('\n')
}

export const extractPlugin = definePlugin({
  tools: [
    {
      id: 'extract.run',
      title: 'command.run.title',
      subtitle: 'command.run.description',
      icon: 'Regex',
      aliases: ['grep', 'filter'],
      inputPolicy: { mode: 'auto' },
      params: [
        {
          key: 'pattern',
          label: 'param.pattern.label',
          type: 'text',
          default: '',
          required: true,
        },
        {
          key: 'matchOnly',
          label: 'param.matchOnly.label',
          type: 'boolean',
          default: false,
        },
      ],
      run(ctx) {
        try {
          return ctx.output.replaceActiveText(runExtract(ctx.input.text, ctx.params))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
  commands: [
    {
      id: 'extract.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Regex',
      aliases: ['grep', 'filter'],
      params: [
        {
          key: 'pattern',
          label: 'param.pattern.label',
          type: 'text',
          default: '',
          required: true,
        },
        {
          key: 'matchOnly',
          label: 'param.matchOnly.label',
          type: 'boolean',
          default: false,
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        try {
          return textOutput(runExtract(text, ctx.params))
        } catch (e: any) {
          return textError(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default extractPlugin
