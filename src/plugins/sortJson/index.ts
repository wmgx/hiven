/**
 * First-party Sort JSON Keys plugin.
 *
 * Single tool — recursively sorts JSON object keys alphabetically.
 */

import { definePlugin } from '@hiven/plugin'

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
      aliases: ['json sort', 'sort json keys', 'json key排序', 'json排序'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try {
          return ctx.output.text(runSortJson(ctx.input.text))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
})

export default sortJsonPlugin
