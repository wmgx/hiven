/**
 * First-party JSON ↔ YAML plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'
import jsYaml from 'js-yaml'

function runYaml(text: string, mode: unknown): string {
  if (mode === 'json2yaml') {
    const obj = JSON.parse(text)
    return jsYaml.dump(obj)
  }
  const obj = jsYaml.load(text)
  return JSON.stringify(obj, null, 2)
}

export const yamlPlugin = definePlugin({
  tools: [
    {
      id: 'yaml.run',
      title: 'command.run.title',
      icon: 'FileJson',
      aliases: ['json-yaml', 'yaml-json'],
      inputPolicy: { mode: 'auto' },
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.json2yaml.label', value: 'json2yaml' },
            { label: 'param.mode.option.yaml2json.label', value: 'yaml2json' },
          ],
          default: 'json2yaml',
        },
      ],
      run(ctx) {
        try {
          return ctx.output.replaceActiveText(runYaml(ctx.input.text, ctx.params.mode))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
  commands: [
    {
      id: 'yaml.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'FileJson',
      aliases: ['json-yaml', 'yaml-json'],
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.json2yaml.label', value: 'json2yaml' },
            { label: 'param.mode.option.yaml2json.label', value: 'yaml2json' },
          ],
          default: 'json2yaml',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        try {
          return textOutput(runYaml(text, ctx.params.mode))
        } catch (e: any) {
          return textError(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default yamlPlugin
