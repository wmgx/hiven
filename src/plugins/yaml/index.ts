/**
 * First-party JSON ↔ YAML plugin.
 *
 * Exposes two independent tools (toJson + fromJson) — no sub-selection needed.
 */

import { definePlugin } from '@hiven/plugin'
import jsYaml from 'js-yaml'

function yamlToJson(text: string): string {
  const obj = jsYaml.load(text)
  return JSON.stringify(obj, null, 2)
}

function jsonToYaml(text: string): string {
  const obj = JSON.parse(text)
  return jsYaml.dump(obj)
}

export const yamlPlugin = definePlugin({
  tools: [
    {
      id: 'yaml.toJson',
      title: 'command.toJson.title',
      subtitle: 'command.toJson.description',
      icon: 'FileCode',
      aliases: ['yaml to json', 'yaml2json', 'yaml转json'],
      inputPolicy: { mode: 'auto' },
      accepts: { kinds: ['yaml'], aliases: ['yaml', '转json'] },
      run(ctx) {
        try {
          return ctx.output.text(yamlToJson(ctx.input.text))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true },
    },
    {
      id: 'yaml.fromJson',
      title: 'command.fromJson.title',
      subtitle: 'command.fromJson.description',
      icon: 'FileCode',
      aliases: ['转yaml', 'json to yaml', 'json2yaml', 'json转yaml'],
      inputPolicy: { mode: 'auto' },
      accepts: { kinds: ['json'], aliases: ['转yaml', 'json to yaml', 'json2yaml'] },
      run(ctx) {
        try {
          return ctx.output.text(jsonToYaml(ctx.input.text))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true },
    },
  ],
})

export default yamlPlugin
