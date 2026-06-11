/**
 * First-party CSS Formatter plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@hiven/plugin'

export const cssPlugin = definePlugin({
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
        const reply = (t: string) => ({ effects: [{ type: 'text.replace' as const, target: input?.paneId ? { paneId: input.paneId } : 'active-input' as const, text: t }] })
        if (ctx.params.mode === 'compact') {
          return reply(text
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\s+/g, ' ')
            .replace(/\s*([{}:;,])\s*/g, '$1')
            .replace(/;}/g, '}')
            .trim())
        }
        const result = text
          .replace(/\s*\{\s*/g, ' {\n  ')
          .replace(/\s*\}\s*/g, '\n}\n')
          .replace(/\s*;\s*/g, ';\n  ')
          .replace(/ {2}\n\}/g, '\n}')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
        return reply(result)
      },
    },
  ],
})

export default cssPlugin
