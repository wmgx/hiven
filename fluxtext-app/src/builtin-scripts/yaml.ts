import { defineAction } from 'fluxtext'
// @deps yaml https://esm.sh/js-yaml@4?bundle

export default defineAction({
  name: 'yaml',
  title: 'JSON ↔ YAML',
  titleI18n: { zh: 'JSON ↔ YAML' },
  icon: 'FileJson',
  aliases: ['json-yaml', 'yaml-json'],
  description: 'Convert between JSON and YAML',
  descriptionI18n: { zh: 'JSON 与 YAML 互转' },
  tags: ['json', 'yaml', 'convert'],

  params: [
    {
      key: 'mode',
      label: 'Mode',
      labelI18n: { zh: '模式' },
      type: 'single-select',
      options: [
        { label: 'JSON → YAML', value: 'json2yaml', labelI18n: { zh: 'JSON → YAML' } },
        { label: 'YAML → JSON', value: 'yaml2json', labelI18n: { zh: 'YAML → JSON' } },
      ],
      default: 'json2yaml',
    },
  ],

  async run(ctx) {
    const jsYaml = ctx.deps.yaml
    if (ctx.params.mode === 'json2yaml') {
      const obj = JSON.parse(ctx.input.text)
      return { text: jsYaml.dump(obj) }
    }
    const obj = jsYaml.load(ctx.input.text)
    return { text: JSON.stringify(obj, null, 2) }
  },
})
