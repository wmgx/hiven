/**
 * First-party Sort JSON Keys plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

function sortKeys(obj: any): any {
  if (Array.isArray(obj)) return obj.map(sortKeys)
  if (obj && typeof obj === 'object') {
    return Object.keys(obj).sort().reduce((acc: any, key: string) => {
      acc[key] = sortKeys(obj[key])
      return acc
    }, {})
  }
  return obj
}

function runSortJson(text: string): string {
  return JSON.stringify(sortKeys(JSON.parse(text)), null, 2)
}

export const sortJsonPlugin = definePlugin({
  tools: [
    {
      id: 'sort-json.run',
      title: 'command.run.title',
      subtitle: 'command.run.description',
      icon: 'ArrowUpNarrowWide',
      aliases: ['json-sort', 'sort-json-keys'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try {
          return ctx.output.replaceActiveText(runSortJson(ctx.input.text))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
  commands: [
    {
      id: 'sort-json.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'ArrowUpNarrowWide',
      aliases: ['json-sort', 'sort-json-keys'],
      params: [],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        try {
          return textOutput(runSortJson(text))
        } catch (e: any) {
          return textError(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default sortJsonPlugin
