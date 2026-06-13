/**
 * First-party CSS Formatter plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

function runCss(text: string, mode: unknown): string {
  if (mode === 'compact') {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s*([{}:;,])\s*/g, '$1')
      .replace(/;}/g, '}')
      .trim()
  }
  return text
    .replace(/\s*\{\s*/g, ' {\n  ')
    .replace(/\s*\}\s*/g, '\n}\n')
    .replace(/\s*;\s*/g, ';\n  ')
    .replace(/ {2}\n\}/g, '\n}')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const cssPlugin = definePlugin({
  tools: [
    {
      id: 'css.run',
      title: 'command.run.title',
      subtitle: 'command.run.description',
      icon: 'Paintbrush',
      aliases: ['css-format', 'css-minify'],
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
        return ctx.output.replaceActiveText(runCss(ctx.input.text, ctx.params.mode))
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
  commands: [
    {
      id: 'css.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Paintbrush',
      aliases: ['css-format', 'css-minify'],
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
        return textOutput(runCss(text, ctx.params.mode))
      },
    },
  ],
})

export default cssPlugin
