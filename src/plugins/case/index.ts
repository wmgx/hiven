/**
 * First-party Case Convert plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

function runCase(text: string, mode: unknown): string {
  switch (mode) {
    case 'upper': return text.toUpperCase()
    case 'lower': return text.toLowerCase()
    case 'title': return text.replace(/\b\w/g, c => c.toUpperCase())
    case 'camel': return text.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '')
    case 'snake': return text.replace(/[\s-]+/g, '_').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
    default: return text
  }
}

export const casePlugin = definePlugin({
  tools: [
    {
      id: 'case.run',
      title: 'command.run.title',
      subtitle: 'command.run.description',
      icon: 'CaseSensitive',
      aliases: ['uppercase', 'lowercase', 'titlecase'],
      inputPolicy: { mode: 'auto' },
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
      run(ctx) {
        return ctx.output.replaceActiveText(runCase(ctx.input.text, ctx.params.mode))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
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
        return textOutput(runCase(text, ctx.params.mode))
      },
    },
  ],
})

export default casePlugin
