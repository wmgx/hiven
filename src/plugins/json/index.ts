/**
 * First-party JSON Formatter plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

function runJson(text: string, mode: unknown): string {
  const obj = JSON.parse(text)
  if (mode === 'compact') {
    return JSON.stringify(obj)
  }
  return JSON.stringify(obj, null, 2)
}

export const jsonPlugin = definePlugin({
  tools: [
    {
      id: 'json.run',
      title: 'command.run.title',
      icon: 'Braces',
      aliases: ['json-format', 'pretty-json'],
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
        try {
          return ctx.output.replaceActiveText(runJson(ctx.input.text, ctx.params.mode))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
  commands: [
    {
      id: 'json.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Braces',
      aliases: ['json-format', 'pretty-json'],
      live: { live: { enabled: true, trigger: 'on-input', sideEffects: 'none', debounceMs: 250 } },
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
        try {
          return textOutput(runJson(text, ctx.params.mode))
        } catch (e: any) {
          return textError(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default jsonPlugin
