/**
 * First-party Sum plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'
import BigNumber from 'bignumber.js'

export const sumPlugin = definePlugin({
  commands: [
    {
      id: 'sum.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Calculator',
      aliases: ['add', 'total'],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        const reply = (t: string) => ({ effects: [{ type: 'text.replace' as const, target: input?.paneId ? { paneId: input.paneId } : 'active-input' as const, text: t }] })
        const re = /[\s,]+/
        const nums = text.split('\n')
          .flatMap((line: string) => line.trim().split(re).filter(Boolean))
          .filter((t: string) => !new BigNumber(t).isNaN())
        if (nums.length === 0) return reply('0')
        const total = nums.reduce((acc: any, n: string) => acc.plus(n), new BigNumber(0))
        return reply(total.toFixed())
      },
    },
  ],
})

export default sumPlugin
