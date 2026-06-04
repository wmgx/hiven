/**
 * First-party JSON ↔ YAML plugin (migrated from legacy builtin action).
 */

import { definePlugin, type TextInput } from '@fluxtext/plugin'
import jsYaml from 'js-yaml'

export const yamlPlugin = definePlugin({
  id: 'yaml',
  title: 'JSON ↔ YAML',
  version: '1.0.0',

  commands: [
    {
      id: 'yaml.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'FileJson',
      aliases: ['json-yaml', 'yaml-json'],
      tags: ['json', 'yaml', 'convert'],
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
        const reply = (t: string) => ({ effects: [{ type: 'text.replace' as const, target: input?.paneId ? { paneId: input.paneId } : 'active-input' as const, text: t }] })
        if (ctx.params.mode === 'json2yaml') {
          const obj = JSON.parse(text)
          return reply(jsYaml.dump(obj))
        }
        const obj = jsYaml.load(text)
        return reply(JSON.stringify(obj, null, 2))
      },
    },
  ],
})

export default yamlPlugin
