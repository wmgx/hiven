/**
 * First-party Number Base Convert plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'

export const hexPlugin = definePlugin({
  id: 'hex',
  title: 'Number Base Convert',
  version: '1.0.0',

  commands: [
    {
      id: 'hex.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Calculator',
      aliases: ['decimal', 'binary', 'octal', 'hex-convert'],
      tags: ['number', 'convert'],
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.dec2hex.label', value: 'dec2hex' },
            { label: 'param.mode.option.hex2dec.label', value: 'hex2dec' },
            { label: 'param.mode.option.dec2bin.label', value: 'dec2bin' },
            { label: 'param.mode.option.bin2dec.label', value: 'bin2dec' },
          ],
          default: 'dec2hex',
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
        try {
          const lines = text.trim().split('\n')
          const result = lines.map(line => {
            const v = line.trim()
            switch (ctx.params.mode) {
              case 'dec2hex': return parseInt(v, 10).toString(16).toUpperCase()
              case 'hex2dec': return parseInt(v, 16).toString(10)
              case 'dec2bin': return parseInt(v, 10).toString(2)
              case 'bin2dec': return parseInt(v, 2).toString(10)
              default: return v
            }
          })
          return reply(result.join('\n'))
        } catch (e: any) {
          return reply(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default hexPlugin
