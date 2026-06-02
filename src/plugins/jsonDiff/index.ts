/**
 * First-party JSON Diff plugin.
 */

import { pluginRegistry } from '../../workspace/pluginRegistry'
import { definePlugin } from '../../workspace/definePlugin'
import { JsonDiffRenderer } from './JsonDiffRenderer'

const jsonDiffPlugin = definePlugin({
  id: 'json-diff',
  title: 'JSON Diff',
  version: '1.0.0',

  commands: [],

  renderers: [
    {
      id: 'json-diff.renderer',
      title: 'JSON Diff Renderer',
      titleI18n: { zh: 'JSON 对比渲染器' },
      surface: 'workspace',
      inputKinds: ['pane', 'pane'],
      component: JsonDiffRenderer,
    },
  ],
})

pluginRegistry.registerProductionPlugin(
  'json-diff',
  jsonDiffPlugin.commands ?? [],
  jsonDiffPlugin.renderers ?? [],
  jsonDiffPlugin.panels ?? [],
)

export { jsonDiffPlugin }
