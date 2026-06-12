/**
 * First-party Case Convert plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

export const casePlugin = definePlugin({
  commands: [
    {
      id: 'case.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'CaseSensitive',
      aliases: ['uppercase', 'lowercase', 'titlecase'],
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.upper.label', value: 'upper' },
            { label: 'param.mode.option.lower.label', value: 'lower' },
            { label: 'param.mode.option.title.label', value: 'title' },
            { label: 'param.mode.option.camel.label', value: 'camel' },
            { label: 'param.mode.option.snake.label', value: 'snake' },
          ],
          default: 'upper',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        switch (ctx.params.mode) {
          case 'upper': return textOutput(text.toUpperCase())
          case 'lower': return textOutput(text.toLowerCase())
          case 'title': return textOutput(text.replace(/\b\w/g, c => c.toUpperCase()))
          case 'camel': return textOutput(text.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : ''))
          case 'snake': return textOutput(text.replace(/[\s-]+/g, '_').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase())
          default: return textOutput(text)
        }
      },
    },
  ],
})

export default casePlugin
