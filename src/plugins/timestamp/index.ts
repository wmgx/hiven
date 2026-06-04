/**
 * First-party Timestamp Convert plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'

export const timestampPlugin = definePlugin({
  id: 'timestamp',
  title: 'Timestamp Convert',
  version: '1.0.0',

  commands: [
    {
      id: 'timestamp.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Clock',
      aliases: ['unix-time', 'epoch', 'date-convert'],
      tags: ['time', 'convert'],
      live: { live: { enabled: true, trigger: 'on-input', sideEffects: 'none', debounceMs: 250 } },
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.to-date.label', value: 'to-date' },
            { label: 'param.mode.option.to-ts.label', value: 'to-ts' },
            { label: 'param.mode.option.now.label', value: 'now' },
          ],
          default: 'to-date',
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
          if (ctx.params.mode === 'now') {
            const now = Date.now()
            return reply(`${Math.floor(now / 1000)} (seconds)\n${now} (milliseconds)\n${new Date(now).toISOString()}`)
          }
          if (ctx.params.mode === 'to-date') {
            let ts = Number(text.trim())
            if (ts < 1e12) ts *= 1000
            return reply(new Date(ts).toISOString())
          }
          const d = new Date(text.trim())
          if (isNaN(d.getTime())) return reply('Error: Invalid date')
          return reply(`${Math.floor(d.getTime() / 1000)} (seconds)\n${d.getTime()} (milliseconds)`)
        } catch (e: any) {
          return reply(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default timestampPlugin
