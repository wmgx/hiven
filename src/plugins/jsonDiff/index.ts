/**
 * First-party JSON Diff plugin.
 */

import { pluginRegistry } from '../../workspace/pluginRegistry'
import { definePlugin } from '../../workspace/definePlugin'
import type { PaneInput } from '../../workspace/pluginTypes'
import { JsonDiffRenderer } from './JsonDiffRenderer'

const jsonDiffPlugin = definePlugin({
  id: 'json-diff',
  title: 'JSON Diff',
  version: '1.0.0',

  commands: [
    {
      id: 'json-diff.compare',
      title: 'JSON Diff',
      titleI18n: { zh: 'JSON 对比' },
      description: 'Compare two JSON panes with semantic options',
      descriptionI18n: { zh: '用语义选项对比两个 JSON 面板' },
      tags: ['diff', 'json', 'compare'],
      icon: 'braces',
      inputs: [
        { key: 'original', label: 'Pane A', labelI18n: { zh: '面板 A' }, kind: 'pane', required: true },
        { key: 'modified', label: 'Pane B', labelI18n: { zh: '面板 B' }, kind: 'pane', required: true },
      ],
      inputResolution: { strategy: 'auto-fill', fallback: 'prompt' },
      run(ctx) {
        const originalPaneId = (ctx.inputs.original as PaneInput).paneId
        const modifiedPaneId = (ctx.inputs.modified as PaneInput).paneId
        return {
          effects: [{
            type: 'pane.setRenderer' as const,
            paneId: originalPaneId,
            renderer: 'json-diff.renderer',
            inputs: {
              original: { kind: 'pane' as const, paneId: originalPaneId },
              modified: { kind: 'pane' as const, paneId: modifiedPaneId },
            },
            ownerPluginId: 'json-diff',
            ownerContributionId: 'json-diff.compare',
          }],
        }
      },
    },
  ],

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
