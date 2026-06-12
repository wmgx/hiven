/**
 * First-party JSON Formatter plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

export const jsonPlugin = definePlugin({
  commands: [
    {
      id: 'json.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Braces',
      aliases: ['json-format', 'pretty-json'],
      live: { live: { enabled: true, trigger: 'on-input', sideEffects: 'none', debounceMs: 250 } },
      optionalParams: true,
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
          const obj = JSON.parse(text)
          if (ctx.params.mode === 'compact') {
            return textOutput(JSON.stringify(obj))
          }
          return textOutput(JSON.stringify(obj, null, 2))
        } catch (e: any) {
          return textError(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default jsonPlugin
